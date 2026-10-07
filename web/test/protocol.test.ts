import test from "node:test";
import assert from "node:assert/strict";
import { parseServerMessage } from "../src/lib/protocol.ts";

test("parses presence, ignores everything else", () => {
  assert.deepEqual(parseServerMessage('{"type":"presence","count":2}'), { type: "presence", count: 2 });
  assert.equal(parseServerMessage("pong"), null);
  assert.equal(parseServerMessage("hello"), null);
  assert.equal(parseServerMessage('{"type":"presence","count":-1}'), null);
  assert.equal(parseServerMessage('{"type":"presence","count":"2"}'), null);
  assert.equal(parseServerMessage('{"type":"other"}'), null);
  assert.equal(parseServerMessage(new ArrayBuffer(4)), null);
});
