import test from "node:test";
import assert from "node:assert/strict";
import { CHUNK_BYTES, MAX_FILE_BYTES, encodeChunk, parseFileMessage } from "../src/lib/file-protocol.ts";
import { FileReceiver, sendFile, type ReceivedFile } from "../src/lib/file-transfer.ts";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const fileOf = (n: number, name = "f.bin", type = "application/octet-stream") => {
  const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) % 256);
  return { bytes, file: Object.assign(new Blob([bytes], { type }), { name }) };
};

/** Wires a sender straight into a receiver, optionally mangling the frame order. */
function pipe(rx: FileReceiver, mangle?: (frames: Uint8Array[]) => Uint8Array[]) {
  const frames: Uint8Array[] = [];
  const sent: unknown[] = [];
  const send = (d: string | Uint8Array) => {
    sent.push(d);
    if (typeof d === "string") {
      const m = parseFileMessage(d);
      if (m) rx.handleMessage(m);
    } else frames.push(d);
    return true;
  };
  const flush = () => {
    for (const f of mangle ? mangle(frames) : frames) rx.handleChunk(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  };
  return { send, flush, sent };
}

const collect = () => {
  const files: ReceivedFile[] = [];
  const rejects: Array<[string, string]> = [];
  const rx = new FileReceiver({ onFile: (f) => files.push(f), onReject: (id, r) => rejects.push([id, r]), idleMs: 40 });
  return { rx, files, rejects };
};

for (const size of [1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 3 * CHUNK_BYTES + 5]) {
  test(`round-trips a ${size}-byte file exactly`, async () => {
    const { rx, files } = collect();
    const { bytes, file } = fileOf(size, "doc.pdf", "application/pdf");
    const p = pipe(rx);
    const progress: number[] = [];
    await sendFile({ id: ID, file, send: p.send, buffered: () => 0, onProgress: (s) => progress.push(s) });
    p.flush();
    assert.equal(files.length, 1);
    assert.equal(files[0].name, "doc.pdf");
    assert.equal(files[0].mime, "application/pdf");
    assert.equal(files[0].size, size);
    assert.deepEqual(new Uint8Array(await files[0].blob.arrayBuffer()), bytes);
    assert.equal(progress.at(-1), size);
    assert.equal(rx.inFlight, 0);
  });
}

test("out-of-order and duplicate chunks still assemble correctly", async () => {
  const { rx, files } = collect();
  const { bytes, file } = fileOf(4 * CHUNK_BYTES + 100);
  const p = pipe(rx, (f) => [...f].reverse().concat(f[1], f[1])); // reversed, plus duplicates
  await sendFile({ id: ID, file, send: p.send, buffered: () => 0 });
  p.flush();
  assert.equal(files.length, 1);
  assert.deepEqual(new Uint8Array(await files[0].blob.arrayBuffer()), bytes);
});

test("rejects empty and oversized files before sending anything", async () => {
  const sent: unknown[] = [];
  const base = { id: ID, send: (d: string | Uint8Array) => (sent.push(d), true), buffered: () => 0 };
  await assert.rejects(sendFile({ ...base, file: fileOf(0).file }), /empty/);
  const huge = { name: "h", type: "", size: MAX_FILE_BYTES + 1, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  await assert.rejects(sendFile({ ...base, file: huge }), /Too large/);
  assert.equal(sent.length, 0);
});

test("fails cleanly when not connected or the link drops mid-send", async () => {
  await assert.rejects(sendFile({ id: ID, file: fileOf(10).file, send: () => false, buffered: () => 0 }), /Not connected/);
  let n = 0;
  const send = () => ++n <= 2; // start + first chunk ok, second chunk fails
  await assert.rejects(sendFile({ id: ID, file: fileOf(3 * CHUNK_BYTES).file, send, buffered: () => 0 }), /Connection lost/);
});

test("waits for backpressure to drain before sending more", async () => {
  const { rx } = collect();
  const p = pipe(rx);
  let buffered = 5_000_000;
  const sleeps: number[] = [];
  await sendFile({
    id: ID,
    file: fileOf(2 * CHUNK_BYTES).file,
    send: p.send,
    buffered: () => buffered,
    sleep: async (ms) => {
      sleeps.push(ms);
      buffered -= 2_000_000;
    },
  });
  assert.ok(sleeps.length >= 2, "should have slept while the buffer was full");
});

test("resolves only after the socket has fully drained, and progress counts transmitted bytes", async () => {
  const { rx } = collect();
  const p = pipe(rx);
  let queued = 0; // pretend the link transmits 100 KB per sleep tick
  const progress: number[] = [];
  let resolved = false;
  const done = sendFile({
    id: ID,
    file: fileOf(3 * CHUNK_BYTES).file,
    send: (d) => {
      if (typeof d !== "string") queued += d.length;
      return p.send(d);
    },
    buffered: () => queued,
    onProgress: (s) => progress.push(s),
    sleep: async () => {
      queued = Math.max(0, queued - 100_000);
    },
  }).then(() => (resolved = true));
  await done;
  assert.equal(resolved, true);
  assert.equal(queued, 0, "must not resolve while bytes are still queued");
  assert.ok(progress[0] < 3 * CHUNK_BYTES, "early progress must be less than the whole file");
  assert.equal(progress.at(-1), 3 * CHUNK_BYTES);
  assert.ok(progress.every((v, i) => i === 0 || v >= progress[i - 1] - CHUNK_BYTES));
});

test("a slow but moving link is never aborted as stalled", async () => {
  const { rx } = collect();
  const p = pipe(rx);
  let queued = 0;
  let ticks = 0;
  await sendFile({
    id: ID,
    file: fileOf(6 * CHUNK_BYTES).file,
    send: (d) => {
      if (typeof d !== "string") queued += d.length;
      return p.send(d);
    },
    buffered: () => queued,
    stallMs: 100, // 4 sleeps without progress would abort; steady progress must not
    sleep: async () => {
      ticks++;
      queued = Math.max(0, queued - 20_000); // always shrinking, just slowly
    },
  });
  assert.ok(ticks * 25 > 100, "total waiting exceeded stallMs yet it still finished");
});

test("a socket that never drains aborts as stalled", async () => {
  const sent: string[] = [];
  await assert.rejects(
    sendFile({
      id: ID,
      file: fileOf(CHUNK_BYTES).file,
      send: (d) => (typeof d === "string" && sent.push(d), true),
      buffered: () => 9e9,
      stallMs: 100,
      sleep: async () => {},
    }),
    /Cancelled/,
  );
  assert.ok(sent.some((s) => s.includes("file-abort")));
});

test("abort signal stops the send and tells the peer", async () => {
  const ctl = new AbortController();
  const sent: string[] = [];
  let chunks = 0;
  await assert.rejects(
    sendFile({
      id: ID,
      file: fileOf(10 * CHUNK_BYTES).file,
      send: (d) => {
        if (typeof d === "string") sent.push(d);
        else if (++chunks === 2) ctl.abort();
        return true;
      },
      buffered: () => 0,
      signal: ctl.signal,
    }),
    /Cancelled/,
  );
  assert.ok(chunks < 10);
  assert.ok(sent.some((s) => s.includes("file-abort")));
});

test("receiver: unknown ids and malformed frames are ignored", () => {
  const { rx, files, rejects } = collect();
  rx.handleChunk(encodeChunk(ID, 0, new Uint8Array(10)).buffer as ArrayBuffer); // never started
  rx.handleChunk(new ArrayBuffer(3));
  assert.equal(files.length + rejects.length, 0);
});

test("receiver: wrong-size chunk is rejected and the transfer dropped", () => {
  const { rx, files, rejects } = collect();
  rx.handleMessage({ type: "file-start", id: ID, name: "x", mime: "", size: 2 * CHUNK_BYTES, chunks: 2 });
  rx.handleChunk(encodeChunk(ID, 0, new Uint8Array(100)).buffer as ArrayBuffer); // should be CHUNK_BYTES
  assert.equal(rejects.length, 1);
  assert.match(rejects[0][1], /corrupted/);
  assert.equal(rx.inFlight, 0);
  assert.equal(files.length, 0);
});

test("receiver: out-of-range chunk index is rejected", () => {
  const { rx, rejects } = collect();
  rx.handleMessage({ type: "file-start", id: ID, name: "x", mime: "", size: 10, chunks: 1 });
  rx.handleChunk(encodeChunk(ID, 5, new Uint8Array(10)).buffer as ArrayBuffer);
  assert.equal(rejects.length, 1);
});

test("receiver: refuses transfers beyond maxConcurrent, ignores repeated starts", () => {
  const { rx, rejects } = collect();
  const id = (n: number) => `123e4567-e89b-42d3-a456-42661417400${n}`;
  const st = (n: number) => ({ type: "file-start" as const, id: id(n), name: "x", mime: "", size: 10, chunks: 1 });
  rx.handleMessage(st(1));
  rx.handleMessage(st(1)); // repeat: ignored
  rx.handleMessage(st(2));
  assert.equal(rx.inFlight, 2);
  rx.handleMessage(st(3));
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0][0], id(3));
  rx.abortAll();
});

test("receiver: abort message drops the transfer silently", () => {
  const { rx, rejects } = collect();
  rx.handleMessage({ type: "file-start", id: ID, name: "x", mime: "", size: 10, chunks: 1 });
  rx.handleMessage({ type: "file-abort", id: ID });
  assert.equal(rx.inFlight, 0);
  assert.equal(rejects.length, 0);
});

test("receiver: abortAll reports every in-flight transfer", () => {
  const { rx, rejects } = collect();
  rx.handleMessage({ type: "file-start", id: ID, name: "x", mime: "", size: 10, chunks: 1 });
  rx.abortAll("Connection lost.");
  assert.equal(rejects.length, 1);
  assert.equal(rx.inFlight, 0);
});

test("receiver: an idle transfer times out", async () => {
  const { rx, rejects } = collect(); // idleMs = 40
  rx.handleMessage({ type: "file-start", id: ID, name: "x", mime: "", size: 10, chunks: 1 });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(rejects.length, 1);
  assert.match(rejects[0][1], /timed out/);
  assert.equal(rx.inFlight, 0);
});

test("sendFile shortens an over-long name so the host accepts it", async () => {
  const { rx, files } = collect();
  const p = pipe(rx);
  const { file } = fileOf(50, "n".repeat(600) + ".pdf");
  await sendFile({ id: ID, file, send: p.send, buffered: () => 0 });
  p.flush();
  assert.equal(files.length, 1);
  assert.ok(files[0].name.endsWith(".pdf") && files[0].name.length <= 255);
});

test("receiver.dispose drops transfers and timers without any callbacks", async () => {
  const { rx, rejects } = collect(); // idleMs = 40
  rx.handleMessage({ type: "file-start", id: ID, name: "x", mime: "", size: 10, chunks: 1 });
  rx.dispose();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(rx.inFlight, 0);
  assert.equal(rejects.length, 0);
});
