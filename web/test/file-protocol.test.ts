import test from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_BYTES, MAX_FILE_BYTES, bytesToId, chunkCount, decodeChunk, encodeChunk, idToBytes,
  parseFileMessage, sanitizeName,
} from "../src/lib/file-protocol.ts";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const start = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "file-start", id: ID, name: "a.pdf", mime: "application/pdf", size: 100, chunks: 1, ...over });

test("chunkCount", () => {
  assert.equal(chunkCount(1), 1);
  assert.equal(chunkCount(CHUNK_BYTES), 1);
  assert.equal(chunkCount(CHUNK_BYTES + 1), 2);
});

test("file-start: accepts valid, rejects bad fields", () => {
  assert.equal(parseFileMessage(start())?.type, "file-start");
  assert.equal(parseFileMessage(start({ id: "nope" })), null);
  assert.equal(parseFileMessage(start({ size: 0, chunks: 0 })), null);
  assert.equal(parseFileMessage(start({ size: MAX_FILE_BYTES + 1, chunks: chunkCount(MAX_FILE_BYTES + 1) })), null);
  assert.equal(parseFileMessage(start({ chunks: 2 })), null); // chunks must match size
  assert.equal(parseFileMessage(start({ name: "" })), null);
  assert.equal(parseFileMessage(start({ name: "x".repeat(256) })), null);
  assert.equal(parseFileMessage(start({ size: 1.5 })), null);
  assert.equal(parseFileMessage(start({ mime: 5 })), null);
});

test("file-start sanitizes the name", () => {
  const m = parseFileMessage(start({ name: "../../etc/pass\\wd\u0000.txt" }));
  assert.equal(m?.type === "file-start" && m.name, ".._.._etc_pass_wd_.txt");
  assert.equal(sanitizeName("   "), "file");
});

test("ack and abort parse; garbage does not", () => {
  assert.deepEqual(parseFileMessage(JSON.stringify({ type: "file-ack", id: ID, ok: false, reason: "no" })), {
    type: "file-ack", id: ID, ok: false, reason: "no",
  });
  assert.equal(parseFileMessage(JSON.stringify({ type: "file-ack", id: ID, ok: "yes" })), null);
  assert.deepEqual(parseFileMessage(JSON.stringify({ type: "file-abort", id: ID })), { type: "file-abort", id: ID });
  assert.equal(parseFileMessage("hello"), null);
  assert.equal(parseFileMessage(new ArrayBuffer(8)), null);
  assert.equal(parseFileMessage("{" + "x".repeat(3000)), null);
});

test("id <-> bytes round-trips", () => {
  const id = crypto.randomUUID();
  assert.equal(bytesToId(idToBytes(id)), id);
});

test("chunk encode/decode round-trips", () => {
  const payload = new Uint8Array([9, 8, 7, 6]);
  const frame = encodeChunk(ID, 70000, payload);
  const d = decodeChunk(frame.buffer as ArrayBuffer)!;
  assert.equal(d.id, ID);
  assert.equal(d.seq, 70000);
  assert.deepEqual([...d.payload], [9, 8, 7, 6]);
});

test("decodeChunk rejects too-short and oversized frames", () => {
  assert.equal(decodeChunk(new ArrayBuffer(20)), null); // header only
  assert.equal(decodeChunk(new ArrayBuffer(5)), null);
  assert.equal(decodeChunk(new ArrayBuffer(20 + CHUNK_BYTES + 1)), null);
  assert.notEqual(decodeChunk(new ArrayBuffer(20 + CHUNK_BYTES)), null);
});

import { MAX_NAME_CHARS, fitName } from "../src/lib/file-protocol.ts";

test("sanitizeName strips bidi overrides that can spoof extensions", () => {
  const spoof = "report" + String.fromCharCode(0x202e) + "gpj.exe";
  assert.equal(sanitizeName(spoof), "report_gpj.exe");
  assert.equal(sanitizeName("a" + String.fromCharCode(0x2066) + "b" + String.fromCharCode(0x200f)), "a_b_");
});

test("fitName leaves normal names alone and keeps the extension when shortening", () => {
  assert.equal(fitName("photo.jpg"), "photo.jpg");
  assert.equal(fitName(""), "file");
  const long = "x".repeat(400) + ".pdf";
  const fitted = fitName(long);
  assert.equal(fitted.length, MAX_NAME_CHARS);
  assert.ok(fitted.endsWith(".pdf"));
  const noExt = fitName("y".repeat(400));
  assert.equal(noExt.length, MAX_NAME_CHARS);
  // an absurdly long "extension" is not treated as one
  assert.equal(fitName("a." + "z".repeat(400)).length, MAX_NAME_CHARS);
});

test("a shortened name passes the host's file-start validation", () => {
  const name = fitName("n".repeat(1000) + ".docx");
  const m = parseFileMessage(JSON.stringify({ type: "file-start", id: ID, name, mime: "", size: 10, chunks: 1 }));
  assert.equal(m?.type, "file-start");
});

test("file-progress parses; negative, fractional or oversized values do not", () => {
  const p = (received: unknown) => parseFileMessage(JSON.stringify({ type: "file-progress", id: ID, received }));
  assert.deepEqual(p(1234), { type: "file-progress", id: ID, received: 1234 });
  assert.equal(p(0)?.type, "file-progress");
  assert.equal(p(-1), null);
  assert.equal(p(1.5), null);
  assert.equal(p("10"), null);
  assert.equal(p(MAX_FILE_BYTES + 1), null);
});
