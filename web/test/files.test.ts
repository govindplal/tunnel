import test from "node:test";
import assert from "node:assert/strict";
import { MAX_STASH_BYTES, MAX_STASH_FILES, formatBytes, pickEvictions, type FileMeta } from "../src/lib/files-core.ts";
import { FileStore } from "../src/lib/file-store.ts";
import { SerialQueue } from "../src/lib/serial-queue.ts";
import { FileReceiver, type ReceivedFile } from "../src/lib/file-transfer.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const meta = (id: string, ts: number, size = 10): FileMeta => ({ id, name: id, mime: "", size, ts });

test("pickEvictions: under the limits evicts nothing", () => {
  assert.deepEqual(pickEvictions([meta("a", 1), meta("b", 2)]), []);
});

test("pickEvictions: more than maxFiles drops the oldest", () => {
  const files = Array.from({ length: MAX_STASH_FILES + 3 }, (_, i) => meta(`f${i}`, i));
  assert.deepEqual(new Set(pickEvictions(files)), new Set(["f0", "f1", "f2"]));
});

test("pickEvictions: byte cap drops the oldest until it fits", () => {
  const mb = 1024 * 1024;
  const files = [meta("old", 1, 100 * mb), meta("mid", 2, 90 * mb), meta("new", 3, 20 * mb)];
  // new (20) + mid (90) = 110 fits; adding old (100) = 210 > 200
  assert.deepEqual(pickEvictions(files), ["old"]);
  assert.equal(MAX_STASH_BYTES, 200 * mb);
});

test("pickEvictions: once over a limit, everything older goes too", () => {
  const mb = 1024 * 1024;
  const files = [meta("tiny-old", 1, 1), meta("huge", 2, 150 * mb), meta("big", 3, 100 * mb)];
  // newest-first: big (100) ok, huge (250) over -> evict huge AND tiny-old
  assert.deepEqual(new Set(pickEvictions(files)), new Set(["huge", "tiny-old"]));
});

test("pickEvictions ignores input order and does not mutate it", () => {
  const files = [meta("b", 2), meta("a", 1), meta("c", 3)];
  assert.deepEqual(pickEvictions(files, 2), ["a"]);
  assert.deepEqual(files.map((f) => f.id), ["b", "a", "c"]);
});

test("formatBytes", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("SerialQueue runs in order and survives failures", async () => {
  const q = new SerialQueue();
  const order: number[] = [];
  await Promise.all([
    q.run(async () => { await sleep(15); order.push(1); }),
    q.run(async () => { throw new Error("boom"); }),
    q.run(async () => { order.push(3); }),
  ]);
  assert.deepEqual(order, [1, 3]);
});

function fakeFileDeps(opts: { failSave?: (id: string) => boolean } = {}) {
  let db: FileMeta[] = [];
  const changes: FileMeta[][] = [];
  return {
    get db() { return db; },
    changes,
    deps: {
      list: async () => { await sleep(Math.random() * 3); return [...db].sort((a, b) => b.ts - a.ts); },
      save: async (f: ReceivedFile, ts: number) => {
        await sleep(Math.random() * 3);
        if (opts.failSave?.(f.id)) throw new Error("quota");
        db = [...db.filter((x) => x.id !== f.id), { id: f.id, name: f.name, mime: f.mime, size: f.size, ts }];
      },
      setThumb: async (id: string, thumb: Blob) => { db = db.map((x) => (x.id === id ? { ...x, thumb } : x)); },
      remove: async (id: string) => { db = db.filter((x) => x.id !== id); },
      clear: async () => { db = []; },
      onChange: (l: FileMeta[]) => { changes.push(l); },
    },
  };
}
const rf = (id: string): ReceivedFile => ({ id, name: id, mime: "", size: 3, blob: new Blob(["abc"]) });

test("FileStore: concurrent adds are all kept, newest first", async () => {
  const f = fakeFileDeps();
  const store = new FileStore(f.deps);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.add(rf(`f${i}`), 100 + i)));
  assert.ok(results.every(Boolean));
  assert.equal(f.db.length, 10);
  assert.equal(f.changes.at(-1)![0].id, "f9");
});

test("FileStore: a failed save reports false and does not block the next add", async () => {
  const f = fakeFileDeps({ failSave: (id) => id === "bad" });
  const store = new FileStore(f.deps);
  assert.equal(await store.add(rf("bad")), false);
  assert.equal(await store.add(rf("good")), true);
  assert.deepEqual(f.db.map((x) => x.id), ["good"]);
});

test("FileStore: remove and clear apply in order after in-flight adds", async () => {
  const f = fakeFileDeps();
  const store = new FileStore(f.deps);
  const add = store.add(rf("a"), 1);
  const rem = store.remove("a");
  const add2 = store.add(rf("b"), 2);
  const clr = store.clear();
  await Promise.all([add, rem, add2, clr]);
  assert.deepEqual(f.db, []);
  assert.deepEqual(f.changes.at(-1), []);
});

test("FileReceiver.onAbort fires when the sender cancels", () => {
  const aborted: string[] = [];
  const rx = new FileReceiver({ onFile: () => {}, onReject: () => {}, onAbort: (id) => aborted.push(id), idleMs: 5000 });
  const id = "123e4567-e89b-42d3-a456-426614174000";
  rx.handleMessage({ type: "file-abort", id }); // unknown: no callback
  rx.handleMessage({ type: "file-start", id, name: "x", mime: "", size: 10, chunks: 1 });
  rx.handleMessage({ type: "file-abort", id });
  assert.deepEqual(aborted, [id]);
  assert.equal(rx.inFlight, 0);
});

test("FileStore.setThumb attaches a thumbnail in order, and is a no-op for a deleted file", async () => {
  const f = fakeFileDeps();
  const store = new FileStore(f.deps);
  const thumb = new Blob(["t"]);
  await Promise.all([store.add(rf("a"), 1), store.setThumb("a", thumb), store.remove("a"), store.setThumb("a", thumb)]);
  assert.deepEqual(f.db, []); // delete came after the first thumb; the late thumb didn't resurrect it
  await store.add(rf("b"), 2);
  await store.setThumb("b", thumb);
  assert.equal((f.db as FileMeta[])[0].thumb, thumb);
  assert.equal(f.changes.at(-1)![0].thumb, thumb);
});
