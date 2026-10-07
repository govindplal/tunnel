// Smoke test against `wrangler dev` (run it first: npm run dev). Usage: npm test
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.RELAY_URL ?? "ws://localhost:8787";
const open = (room) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/ws/${room}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("connect failed"));
  });
const next = (ws) => new Promise((r) => (ws.onmessage = (e) => r(e.data)));

test("relays to peer, not sender", async () => {
  const a = await open("A".repeat(22));
  const b = await open("A".repeat(22));
  const got = next(b);
  a.send(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...new Uint8Array(await got)], [1, 2, 3]);
  a.close(); b.close();
});

test("rooms are isolated", async () => {
  const a1 = await open("A".repeat(22));
  const a2 = await open("A".repeat(22));
  const b1 = await open("B".repeat(22));
  const b2 = await open("B".repeat(22));
  const ga = next(a2), gb = next(b2);
  a1.send("x"); b1.send("y");
  assert.equal(await ga, "x");
  assert.equal(await gb, "y");
  [a1, a2, b1, b2].forEach((s) => s.close());
});

test("bad room id rejected", async () => {
  await assert.rejects(open("short"));
});
