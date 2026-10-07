import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { RoomConnection, type ConnectionOptions, type SocketLike, type Status } from "../src/lib/connection.ts";

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
}

/** A socket that has opened AND been accepted by the relay (it answers a good hello with a presence frame). */
function up(s: FakeSocket, count = 1) {
  s.onopen!();
  s.onmessage!({ data: JSON.stringify({ type: "presence", count }) });
}

function setup(extra: Partial<ConnectionOptions> = {}, messages: Array<string | ArrayBuffer> = []) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const sockets: FakeSocket[] = [];
  const resumeCbs: Array<() => void> = [];
  const statuses: Status[] = [];
  const presence: number[] = [];
  const conn = new RoomConnection({
    url: "wss://relay/ws/x",
    role: "host",
    token: "test-token",
    onMessage: (d) => messages.push(d),
    random: () => 0.5, // jitter factor 1.0
    onResume: (cb) => { resumeCbs.push(cb); return () => { resumeCbs.length = 0; }; },
    onStatus: (s) => statuses.push(s),
    onPresence: (n) => presence.push(n),
    socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    pingMs: 1000,
    ...extra,
  });
  const resume = () => resumeCbs.forEach((cb) => cb());
  return { conn, sockets, statuses, presence, resume };
}

test("connects, reports status and presence", () => {
  const { conn, sockets, statuses, presence } = setup();
  conn.start();
  assert.deepEqual(statuses, ["connecting"]);
  up(sockets[0]);
  sockets[0].onmessage!({ data: JSON.stringify({ type: "presence", count: 2 }) });
  assert.equal(statuses.at(-1), "open");
  assert.equal(presence.at(-1), 2);
  conn.stop();
  mock.timers.reset();
});

test("reconnects with backoff after close, resets after open", () => {
  const { conn, sockets, statuses } = setup();
  conn.start();
  up(sockets[0]);
  sockets[0].onclose!();
  assert.equal(statuses.at(-1), "reconnecting");
  mock.timers.tick(499);
  assert.equal(sockets.length, 1);
  mock.timers.tick(1);
  assert.equal(sockets.length, 2);
  sockets[1].onclose!(); // fails before opening: backoff doubles to 1000ms
  mock.timers.tick(999);
  assert.equal(sockets.length, 2);
  mock.timers.tick(1);
  assert.equal(sockets.length, 3);
  up(sockets[2]);
  sockets[2].onclose!(); // attempts reset: back to 500ms
  mock.timers.tick(500);
  assert.equal(sockets.length, 4);
  conn.stop();
  mock.timers.reset();
});

test("duplicate error+close events cause one reconnect", () => {
  const { conn, sockets } = setup();
  conn.start();
  sockets[0].onerror!();
  sockets[0].onclose!();
  mock.timers.tick(500);
  assert.equal(sockets.length, 2);
  conn.stop();
  mock.timers.reset();
});

test("heartbeat pings; silent link is dropped and reconnected", () => {
  const { conn, sockets } = setup();
  conn.start();
  up(sockets[0]);
  mock.timers.tick(1000);
  assert.deepEqual(sockets[0].sent.slice(1), ["ping"]);
  sockets[0].onmessage!({ data: "pong" });
  mock.timers.tick(1000);
  assert.equal(sockets[0].sent.length, 3);
  mock.timers.tick(2001); // no pong for > 2 intervals
  assert.equal(sockets[0].closed, true);
  mock.timers.tick(500);
  assert.equal(sockets.length, 2);
  conn.stop();
  mock.timers.reset();
});

test("stop prevents reconnect and zeroes presence", () => {
  const { conn, sockets, statuses, presence } = setup();
  conn.start();
  up(sockets[0]);
  conn.stop();
  assert.equal(statuses.at(-1), "closed");
  assert.equal(presence.at(-1), 0);
  mock.timers.tick(60_000);
  assert.equal(sockets.length, 1);
  mock.timers.reset();
});

test("announces its role on every connect", () => {
  const { conn, sockets } = setup();
  conn.start();
  up(sockets[0]);
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), { type: "hello", role: "host", token: "test-token" });
  sockets[0].onclose!();
  mock.timers.tick(500);
  up(sockets[1]);
  assert.deepEqual(JSON.parse(sockets[1].sent[0]), { type: "hello", role: "host", token: "test-token" });
  conn.stop();
  mock.timers.reset();
});

test("resume: healthy link is kept, stale link reconnects immediately", () => {
  const { conn, sockets, resume } = setup();
  conn.start();
  up(sockets[0]);
  resume();
  assert.equal(sockets.length, 1); // seen just now: leave it alone
  mock.timers.tick(900); // timers were frozen; link may be dead
  mock.timers.tick(200); // > pingMs since lastSeen (heartbeat pings but gets no pong)
  const before = sockets.length;
  resume();
  assert.equal(sockets.length, before + 1); // no backoff wait
  assert.equal(sockets[0].closed, true);
  conn.stop();
  mock.timers.reset();
});

test("resume while reconnecting skips the backoff", () => {
  const { conn, sockets, resume } = setup();
  conn.start();
  sockets[0].onclose!(); // never opened; waiting 500ms
  resume();
  assert.equal(sockets.length, 2);
  conn.stop();
  mock.timers.reset();
});

test("a factory that throws is retried, not fatal", () => {
  let calls = 0;
  const { conn, sockets, statuses } = setup({
    socketFactory: () => {
      if (calls++ === 0) throw new Error("SecurityError");
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  });
  assert.doesNotThrow(() => conn.start());
  assert.equal(statuses.at(-1), "reconnecting");
  mock.timers.tick(500);
  assert.equal(sockets.length, 1);
  conn.stop();
  mock.timers.reset();
});

test("late messages from a replaced socket are ignored", () => {
  const { conn, sockets, presence } = setup();
  conn.start();
  up(sockets[0]);
  const stale = sockets[0].onmessage!;
  sockets[0].onclose!();
  mock.timers.tick(500);
  stale({ data: JSON.stringify({ type: "presence", count: 2 }) });
  assert.notEqual(presence.at(-1), 2);
  conn.stop();
  mock.timers.reset();
});

test("stop during a pending retry cancels it", () => {
  const { conn, sockets } = setup();
  conn.start();
  sockets[0].onclose!();
  conn.stop();
  mock.timers.tick(60_000);
  assert.equal(sockets.length, 1);
  mock.timers.reset();
});

test("send: false until open, then writes to the socket", () => {
  const { conn, sockets } = setup();
  assert.equal(conn.send("x"), false); // not started
  conn.start();
  assert.equal(conn.send("x"), false); // connecting
  up(sockets[0]);
  assert.equal(conn.send("hello"), true);
  assert.equal(sockets[0].sent.at(-1), "hello");
  sockets[0].onclose!();
  assert.equal(conn.send("x"), false); // reconnecting
  conn.stop();
  mock.timers.reset();
});

test("send reports false if the socket throws", () => {
  const { conn, sockets } = setup();
  conn.start();
  up(sockets[0]);
  sockets[0].send = () => { throw new Error("closing"); };
  assert.equal(conn.send("x"), false);
  conn.stop();
  mock.timers.reset();
});

test("peer frames reach onMessage; presence and pong do not", () => {
  const messages: Array<string | ArrayBuffer> = [];
  const { conn, sockets } = setup({}, messages);
  conn.start();
  up(sockets[0]);
  sockets[0].onmessage!({ data: "pong" });
  sockets[0].onmessage!({ data: JSON.stringify({ type: "presence", count: 2 }) });
  sockets[0].onmessage!({ data: JSON.stringify({ type: "text", id: "a", text: "hi", ts: 1 }) });
  assert.equal(messages.length, 1);
  assert.match(String(messages[0]), /"text":"hi"/);
  conn.stop();
  mock.timers.reset();
});

test("relay notices (queued/delivered/rejected) go to onNotice, not onMessage or onPresence", () => {
  const notices: unknown[] = [];
  const messages: Array<string | ArrayBuffer> = [];
  const { conn, sockets, presence } = setup({ onNotice: (m) => notices.push(m) }, messages);
  conn.start();
  up(sockets[0]);
  const id = "123e4567-e89b-42d3-a456-426614174000";
  sockets[0].onmessage!({ data: JSON.stringify({ type: "queued", id }) });
  sockets[0].onmessage!({ data: JSON.stringify({ type: "delivered", id }) });
  sockets[0].onmessage!({ data: JSON.stringify({ type: "rejected", id, reason: "queue-full" }) });
  sockets[0].onmessage!({ data: JSON.stringify({ type: "presence", count: 2 }) });
  sockets[0].onmessage!({ data: JSON.stringify({ type: "ack", id, copied: true }) }); // a peer message
  assert.deepEqual(notices, [
    { type: "queued", id },
    { type: "delivered", id },
    { type: "rejected", id, reason: "queue-full" },
  ]);
  assert.equal(presence.at(-1), 2);
  assert.equal(messages.length, 1);
  assert.match(String(messages[0]), /"ack"/);
  conn.stop();
  mock.timers.reset();
});

test("the proof of membership is re-sent on every reconnect", () => {
  const { conn, sockets } = setup({ token: "proof-123" });
  conn.start();
  up(sockets[0]);
  sockets[0].onclose!();
  mock.timers.tick(500);
  up(sockets[1]);
  assert.equal(JSON.parse(sockets[1].sent[0]).token, "proof-123");
  conn.stop();
  mock.timers.reset();
});

test("not open until the relay accepts the hello; nothing can be sent before that", () => {
  const { conn, sockets, statuses } = setup();
  conn.start();
  sockets[0].onopen!(); // TCP/WebSocket is up, but the relay hasn't verified our proof yet
  assert.notEqual(statuses.at(-1), "open");
  assert.equal(JSON.parse(sockets[0].sent[0]).type, "hello");
  assert.equal(conn.send("too early"), false); // would be silently dropped by the relay
  assert.ok(!sockets[0].sent.includes("too early"));
  sockets[0].onmessage!({ data: JSON.stringify({ type: "presence", count: 1 }) });
  assert.equal(statuses.at(-1), "open");
  assert.equal(conn.send("now fine"), true);
  conn.stop();
  mock.timers.reset();
});

test("a socket the relay never accepts never becomes open (bad proof: relay closes it)", () => {
  const { conn, sockets, statuses } = setup();
  conn.start();
  sockets[0].onopen!();
  sockets[0].onclose!(); // relay closed with 1008
  assert.ok(!statuses.includes("open"));
  assert.equal(statuses.at(-1), "reconnecting");
  conn.stop();
  mock.timers.reset();
});

test("after a reconnect the new socket must be accepted again before sending", () => {
  const { conn, sockets } = setup();
  conn.start();
  up(sockets[0]);
  sockets[0].onclose!();
  mock.timers.tick(500);
  sockets[1].onopen!();
  assert.equal(conn.send("early"), false);
  sockets[1].onmessage!({ data: JSON.stringify({ type: "presence", count: 1 }) });
  assert.equal(conn.send("ok"), true);
  conn.stop();
  mock.timers.reset();
});
