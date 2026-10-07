import test from "node:test";
import assert from "node:assert/strict";

test("parses presence, ignores everything else", () => {
  assert.deepEqual(parseServerMessage('{"type":"presence","count":2}'), { type: "presence", count: 2 });
  assert.equal(parseServerMessage("pong"), null);
  assert.equal(parseServerMessage("hello"), null);
  assert.equal(parseServerMessage('{"type":"presence","count":-1}'), null);
  assert.equal(parseServerMessage('{"type":"presence","count":"2"}'), null);
  assert.equal(parseServerMessage('{"type":"other"}'), null);
  assert.equal(parseServerMessage(new ArrayBuffer(4)), null);
});

import { MAX_FRAME_CHARS, MAX_TEXT_CHARS, parsePeerMessage, newMessageId } from "../src/lib/protocol.ts";

test("parsePeerMessage accepts text and ack", () => {
  assert.deepEqual(
    parsePeerMessage(JSON.stringify({ type: "text", id: "a", text: "hi", ts: 5 })),
    { type: "text", id: "a", text: "hi", ts: 5 },
  );
  assert.deepEqual(parsePeerMessage('{"type":"ack","id":"a","copied":true}'), { type: "ack", id: "a", copied: true });
});

test("parsePeerMessage rejects malformed, oversized, and wrong-typed input", () => {
  assert.equal(parsePeerMessage("plain text"), null);
  assert.equal(parsePeerMessage("{not json"), null);
  assert.equal(parsePeerMessage('{"type":"text","text":"x"}'), null); // no id
  assert.equal(parsePeerMessage(`{"type":"text","id":"${"i".repeat(65)}","text":"x"}`), null);
  assert.equal(parsePeerMessage('{"type":"text","id":"a","text":5}'), null);
  assert.equal(parsePeerMessage('{"type":"ack","id":"a","copied":"yes"}'), null);
  assert.equal(parsePeerMessage('{"type":"other","id":"a"}'), null);
  const big = JSON.stringify({ type: "text", id: "a", text: "x".repeat(MAX_TEXT_CHARS + 1) });
  assert.equal(parsePeerMessage(big), null);
  assert.equal(parsePeerMessage(42), null);
});

test("text is preserved exactly (unicode, newlines, quotes)", () => {
  const text = 'line1\nline2 "quoted" \u{1F600} \ done';
  const m = parsePeerMessage(JSON.stringify({ type: "text", id: "a", text, ts: 1 }));
  assert.equal(m?.type === "text" && m.text, text);
});

test("newMessageId is unique", () => {
  assert.notEqual(newMessageId(), newMessageId());
});

test("worst-case escaped text still fits the frame limit and parses", () => {
  const text = String.fromCharCode(1).repeat(MAX_TEXT_CHARS); // control chars escape to 6 chars each
  const frame = JSON.stringify({ type: "text", id: "a", text, ts: 1 });
  assert.ok(frame.length <= MAX_FRAME_CHARS);
  assert.equal(parsePeerMessage(frame)?.type, "text");
});

import { parseServerMessage } from "../src/lib/protocol.ts";

test("parseServerMessage understands queued, delivered and rejected notices", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "queued", id })), { type: "queued", id });
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "delivered", id })), { type: "delivered", id });
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "rejected", id, reason: "queue-full" })), {
    type: "rejected", id, reason: "queue-full",
  });
  assert.equal(parseServerMessage(JSON.stringify({ type: "rejected", id }))?.type, "rejected");
});

test("parseServerMessage rejects notices with bad ids and never mistakes peer messages for notices", () => {
  assert.equal(parseServerMessage(JSON.stringify({ type: "queued", id: "x" })), null);
  assert.equal(parseServerMessage(JSON.stringify({ type: "queued" })), null);
  assert.equal(parseServerMessage(JSON.stringify({ type: "delivered", id: "bad id with spaces!" })), null);
  assert.equal(parseServerMessage(JSON.stringify({ type: "ack", id: "123e4567-e89b-42d3-a456-426614174000", copied: true })), null);
  assert.equal(parseServerMessage(JSON.stringify({ type: "msg", id: "123e4567-e89b-42d3-a456-426614174000", iv: "a", ct: "b" })), null);
  assert.equal(parseServerMessage("x".repeat(600)), null);
});

test("parseServerMessage rejects a non-string id even if its text would look valid", () => {
  assert.equal(parseServerMessage('{"type":"delivered","id":12345678}'), null);
  assert.equal(parseServerMessage('{"type":"queued","id":null}'), null);
  assert.equal(parseServerMessage('{"type":"queued","id":["abcdefgh"]}'), null);
});
