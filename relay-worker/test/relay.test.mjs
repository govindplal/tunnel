// Smoke tests against a running relay (default `wrangler dev` on :8787, or RELAY_URL=wss://...).
// The expiry test needs a relay started with a short hold: wrangler dev --var HOLD_MS:2000
// and RELAY_HOLD_MS=2000 in the environment of this test run.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const BASE = process.env.RELAY_URL ?? "ws://localhost:8787";
const HOLD_MS = Number(process.env.RELAY_HOLD_MS || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b64url = (buf) => Buffer.from(buf).toString("base64url");
async function makeRoom() {
  const token = b64url(randomBytes(32));
  const room = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return { room, token };
}

/** Opens a socket that records every frame it receives. */
function open(room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/ws/${room}`);
    ws.binaryType = "arraybuffer";
    ws.frames = [];
    ws.closeCode = null;
    ws.onmessage = (e) => ws.frames.push(e.data);
    ws.onclose = (e) => (ws.closeCode = e.code);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("connect failed"));
  });
}
const json = (f) => (typeof f === "string" && f.startsWith("{") ? JSON.parse(f) : null);
const hasType = (ws, type, id) => ws.frames.some((f) => json(f)?.type === type && (id === undefined || json(f).id === id));
// The live relay over a real network can stall for several seconds (seen: 1-10 s), so waits are longer there.
const SLOW_NETWORK = !!process.env.RELAY_URL;
async function waitFor(fn, ms = 8000, what = "condition") {
  const end = Date.now() + (SLOW_NETWORK ? Math.max(ms, 25000) : ms);
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function join(r, role) {
  const ws = await open(r.room);
  ws.send(JSON.stringify({ type: "hello", role, token: r.token }));
  await waitFor(() => hasType(ws, "presence"), 8000, `${role} presence`);
  return ws;
}
const envelope = (id = crypto.randomUUID(), ct = "Y2lwaGVydGV4dA") => JSON.stringify({ type: "msg", id, iv: "aXY", ct });
const closeAll = (...s) => s.forEach((x) => x.close());

test("relays between members, not back to the sender", async () => {
  const r = await makeRoom();
  const host = await join(r, "host");
  const client = await join(r, "client");
  client.send("hello there");
  await waitFor(() => host.frames.includes("hello there"), 8000, "peer frame");
  await sleep(300);
  assert.equal(client.frames.includes("hello there"), false);
  closeAll(host, client);
});

test("binary frames are relayed intact", async () => {
  const r = await makeRoom();
  const host = await join(r, "host");
  const client = await join(r, "client");
  client.send(new Uint8Array([1, 2, 3, 250]));
  await waitFor(() => host.frames.some((f) => f instanceof ArrayBuffer), 8000, "binary frame");
  assert.deepEqual([...new Uint8Array(host.frames.find((f) => f instanceof ArrayBuffer))], [1, 2, 3, 250]);
  closeAll(host, client);
});

test("rooms are isolated", async () => {
  const a = await makeRoom();
  const b = await makeRoom();
  const a1 = await join(a, "host");
  const a2 = await join(a, "client");
  const b1 = await join(b, "host");
  const b2 = await join(b, "client");
  a2.send("for-a");
  b2.send("for-b");
  await waitFor(() => a1.frames.includes("for-a") && b1.frames.includes("for-b"), 8000, "both rooms");
  await sleep(300);
  assert.equal(a1.frames.includes("for-b"), false);
  assert.equal(b1.frames.includes("for-a"), false);
  closeAll(a1, a2, b1, b2);
});

test("a malformed room id is rejected", async () => {
  await assert.rejects(open("short"));
});

test("a socket with the wrong token is closed and never receives or sends anything", async () => {
  const r = await makeRoom();
  const host = await join(r, "host");
  const intruder = await open(r.room);
  intruder.send(JSON.stringify({ type: "hello", role: "client", token: b64url(randomBytes(32)) }));
  await waitFor(() => intruder.readyState >= 2, 8000, "intruder closed"); // closing or closed: the close handshake itself is flaky
  assert.ok(intruder.closeCode === null || intruder.closeCode === 1008);
  // knowing only the room id (what the URL shows) is not enough: no hello, no access
  const lurker = await open(r.room);
  lurker.send("let me in");
  host.send("secret-ish");
  await sleep(400);
  assert.equal(host.frames.includes("let me in"), false);
  assert.equal(lurker.frames.includes("secret-ish"), false);
  closeAll(host, lurker);
});

test("presence counts distinct roles, not sockets", async () => {
  const r = await makeRoom();
  const host = await join(r, "host");
  const ghost = await join(r, "host"); // second tab / stale socket with the same role
  await sleep(300);
  assert.equal(json(host.frames.filter((f) => json(f)?.type === "presence").at(-1)).count, 1);
  const client = await join(r, "client");
  await waitFor(() => json(host.frames.filter((f) => json(f)?.type === "presence").at(-1))?.count === 2, 8000, "count 2");
  closeAll(host, ghost, client);
});

test("clients cannot forge relay frames", async () => {
  const r = await makeRoom();
  const host = await join(r, "host");
  const client = await join(r, "client");
  for (const type of ["presence", "queued", "delivered", "rejected"]) client.send(JSON.stringify({ type, id: "abcdefgh1", count: 2 }));
  client.send("real");
  await waitFor(() => host.frames.includes("real"), 8000, "real frame");
  assert.equal(hasType(host, "queued"), false);
  assert.equal(hasType(host, "delivered"), false);
  assert.equal(hasType(host, "rejected"), false);
  closeAll(host, client);
});

test("a message sent while the host is away is held, then delivered when the host joins", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued notice");
  const host = await join(r, "host");
  await waitFor(() => hasType(host, "msg", id), 8000, "held message delivered");
  host.send(JSON.stringify({ type: "qack", id }));
  await waitFor(() => hasType(client, "delivered", id), 8000, "delivered notice");
  closeAll(client, host);
});

test("a held message is delivered even if the sender has gone", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued notice");
  client.close();
  await sleep(300);
  const host = await join(r, "host");
  await waitFor(() => hasType(host, "msg", id), 8000, "held message delivered");
  host.send(JSON.stringify({ type: "qack", id }));
  host.close();
});

test("an acknowledged message is deleted: a later host connection gets nothing", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued");
  const host1 = await join(r, "host");
  await waitFor(() => hasType(host1, "msg", id), 8000, "delivered");
  host1.send(JSON.stringify({ type: "qack", id }));
  await waitFor(() => hasType(client, "delivered", id), 8000, "ack processed");
  host1.close();
  await sleep(300);
  const host2 = await join(r, "host");
  await sleep(600);
  assert.equal(hasType(host2, "msg"), false);
  closeAll(client, host2);
});

test("an unacknowledged message is redelivered on the next host connection", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued");
  const host1 = await join(r, "host");
  await waitFor(() => hasType(host1, "msg", id), 8000, "first delivery");
  host1.close(); // dies without acknowledging
  await sleep(300);
  const host2 = await join(r, "host");
  await waitFor(() => hasType(host2, "msg", id), 8000, "redelivery");
  host2.send(JSON.stringify({ type: "qack", id }));
  closeAll(client, host2);
});

test("with the host online a message is delivered at once and the sender is not told 'queued'", async () => {
  const r = await makeRoom();
  const host = await join(r, "host");
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(host, "msg", id), 8000, "live delivery");
  await sleep(300);
  assert.equal(hasType(client, "queued"), false);
  host.send(JSON.stringify({ type: "qack", id }));
  await waitFor(() => hasType(client, "delivered", id), 8000, "delivered notice");
  closeAll(host, client);
});

test("only the receiving role can acknowledge (and so delete) a held message", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued");
  client.send(JSON.stringify({ type: "qack", id })); // sender tries to delete the host's copy
  await sleep(400);
  const host = await join(r, "host");
  await waitFor(() => hasType(host, "msg", id), 8000, "still delivered");
  host.send(JSON.stringify({ type: "qack", id }));
  closeAll(client, host);
});

test("a stranger who knows only the room id cannot collect held messages", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued");
  const stranger = await open(r.room);
  stranger.send(JSON.stringify({ type: "hello", role: "host", token: "not-the-token" }));
  await waitFor(() => stranger.readyState >= 2, 8000, "stranger closed");
  assert.equal(hasType(stranger, "msg"), false);
  const host = await join(r, "host"); // the real host still gets it: nothing was consumed
  await waitFor(() => hasType(host, "msg", id), 8000, "real host delivery");
  host.send(JSON.stringify({ type: "qack", id }));
  closeAll(client, host);
});

test("malformed envelopes are ignored and never queued", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  client.send(JSON.stringify({ type: "msg", id: "x", iv: "a", ct: "b" })); // id too short
  client.send(JSON.stringify({ type: "msg", id: crypto.randomUUID(), iv: 5, ct: "b" }));
  client.send('{"type":"msg"');
  await sleep(500);
  assert.equal(hasType(client, "queued"), false);
  const host = await join(r, "host");
  await sleep(500);
  assert.equal(hasType(host, "msg"), false);
  closeAll(client, host);
});

test("the queue is bounded: past the limit the sender is told 'rejected'", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const ids = Array.from({ length: 52 }, () => crypto.randomUUID());
  for (const id of ids) client.send(envelope(id));
  await waitFor(() => hasType(client, "rejected"), 15000, "rejected notice");
  assert.ok(hasType(client, "queued", ids[0]));
  assert.ok(!hasType(client, "queued", ids[51]));
  const host = await join(r, "host");
  await waitFor(() => host.frames.filter((f) => json(f)?.type === "msg").length === 50, 15000, "50 delivered");
  for (const id of ids.slice(0, 50)) host.send(JSON.stringify({ type: "qack", id }));
  closeAll(client, host);
});

test("held messages expire (needs a relay started with a short HOLD_MS)", { skip: !HOLD_MS }, async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued");
  await sleep(HOLD_MS + 2500);
  const host = await join(r, "host");
  await sleep(800);
  assert.equal(hasType(host, "msg"), false, "an expired message must not be delivered");
  closeAll(client, host);
});

test("when the queue is full the sender is told, even if the receiver looks connected", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const ids = Array.from({ length: 50 }, () => crypto.randomUUID());
  for (const id of ids) client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", ids[49]), 15000, "queue filled");
  const host = await join(r, "host"); // receives all 50, acknowledges none: the queue stays full
  await waitFor(() => host.frames.filter((f) => json(f)?.type === "msg").length === 50, 15000, "50 delivered");
  const late = crypto.randomUUID();
  client.send(envelope(late));
  await waitFor(() => hasType(client, "rejected", late), 8000, "rejected despite a live receiver");
  for (const id of ids) host.send(JSON.stringify({ type: "qack", id }));
  closeAll(client, host);
});

test("an unreadable message acknowledged with drop is reported as rejected, never as delivered", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", id), 8000, "queued");
  const host = await join(r, "host");
  await waitFor(() => hasType(host, "msg", id), 8000, "delivered");
  host.send(JSON.stringify({ type: "qack", id, drop: true }));
  await waitFor(() => hasType(client, "rejected", id), 8000, "rejected notice");
  assert.equal(json(client.frames.find((f) => json(f)?.type === "rejected")).reason, "unreadable");
  assert.equal(hasType(client, "delivered", id), false);
  closeAll(client, host);
});

test("acknowledging an id that is not waiting tells nobody", async () => {
  const r = await makeRoom();
  const host = await join(r, "host");
  const client = await join(r, "client");
  host.send(JSON.stringify({ type: "qack", id: crypto.randomUUID() }));
  await sleep(500);
  assert.equal(hasType(client, "delivered"), false);
  closeAll(host, client);
});

test("held messages arrive in the order they were sent", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
  for (const id of ids) client.send(envelope(id));
  await waitFor(() => hasType(client, "queued", ids[7]), 8000, "all queued");
  const host = await join(r, "host");
  await waitFor(() => host.frames.filter((f) => json(f)?.type === "msg").length === 8, 8000, "all delivered");
  assert.deepEqual(host.frames.filter((f) => json(f)?.type === "msg").map((f) => json(f).id), ids);
  for (const id of ids) host.send(JSON.stringify({ type: "qack", id }));
  closeAll(client, host);
});

test("re-sending an id keeps a single held copy", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id));
  client.send(envelope(id));
  await waitFor(() => client.frames.filter((f) => json(f)?.type === "queued").length === 2, 8000, "both acknowledged");
  const host = await join(r, "host");
  await sleep(700);
  assert.equal(host.frames.filter((f) => json(f)?.type === "msg" && json(f).id === id).length, 1);
  host.send(JSON.stringify({ type: "qack", id }));
  closeAll(client, host);
});

test("the same id in the two directions are separate held messages", async () => {
  const r = await makeRoom();
  const client = await join(r, "client");
  const id = crypto.randomUUID();
  client.send(envelope(id)); // held for the host
  await waitFor(() => hasType(client, "queued", id), 8000, "queued for host");
  client.close();
  const host = await join(r, "host");
  await waitFor(() => hasType(host, "msg", id), 8000, "host got it");
  host.send(envelope(id)); // the host's own message with the same id, for the (absent) client
  await waitFor(() => hasType(host, "queued", id), 8000, "queued for client");
  host.close(); // never acknowledged the first one
  await sleep(300);
  const client2 = await join(r, "client");
  await waitFor(() => hasType(client2, "msg", id), 8000, "client got the host's message");
  client2.send(JSON.stringify({ type: "qack", id })); // clears only the client's copy
  await sleep(300);
  const host2 = await join(r, "host");
  await waitFor(() => hasType(host2, "msg", id), 8000, "host's own pending message survived");
  host2.send(JSON.stringify({ type: "qack", id }));
  closeAll(client2, host2);
});

const HELLO_MS = Number(process.env.RELAY_HELLO_MS || 0);
test("a socket that never says hello is closed (needs HELLO_TIMEOUT_MS set small)", { skip: !HELLO_MS }, async () => {
  const r = await makeRoom();
  const lurker = await open(r.room);
  await sleep(HELLO_MS + 3000);
  // 2 = closing, 3 = closed (the close handshake itself is flaky, see CLAUDE.md, so don't wait for the event)
  assert.ok(lurker.readyState >= 2, `silent socket should have been closed, readyState=${lurker.readyState}`);
  const member = await join(r, "host"); // a member who does say hello is untouched
  await sleep(HELLO_MS + 2000);
  assert.equal(member.readyState, 1);
  member.close();
});
