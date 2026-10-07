import test from "node:test";
import assert from "node:assert/strict";
import { ClipStore } from "../src/lib/clip-store.ts";
import { addClip, type Clip } from "../src/lib/clips-core.ts";
import type { Envelope } from "../src/lib/crypto.ts";
import { TextInbox } from "../src/lib/text-inbox.ts";
import { pickSeenToPrune, SEEN_MAX, SEEN_MAX_AGE_MS } from "../src/lib/seen-core.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const env = (n: number): Envelope => ({ type: "msg", id: id(n), iv: "x", ct: "x" });

interface Opts {
  failSave?: boolean;
  failSeen?: boolean;
  focused?: boolean;
  decryptDelay?: (n: number) => number;
  copyDelay?: number;
}

function rig(o: Opts = {}) {
  let db: Clip[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const copies: string[] = [];
  const seen = new Set<string>();
  const log: string[] = [];
  const state = { focused: o.focused ?? true, failSave: o.failSave ?? false, failSeen: o.failSeen ?? false, pending: 0, alerts: 0, unsaved: 0 };
  let clock = 1000;
  const store = new ClipStore({
    load: async () => [...db],
    save: async (cur, clip) => {
      await sleep(1);
      if (state.failSave) throw new Error("quota");
      const next = addClip(cur, clip);
      db = next;
      return next;
    },
    clear: async () => {
      db = [];
    },
    onChange: () => {},
  });
  const inbox = new TextInbox({
    decrypt: async (e) => {
      const n = Number(e.id.slice(-12));
      await sleep(o.decryptDelay?.(n) ?? 0);
      const text = (e as Envelope & { text?: string }).text;
      return text === undefined && n !== 0 ? JSON.stringify({ type: "text", id: e.id, text: `text-${n}`, ts: 1 }) : text ?? null;
    },
    hasSeen: async (i) => seen.has(i),
    addSeen: async (i) => {
      if (state.failSeen) return false;
      seen.add(i);
      return true;
    },
    store,
    copy: async (text) => {
      if (o.copyDelay) await sleep(o.copyDelay);
      if (!state.focused) return false;
      copies.push(text);
      log.push("copy:" + text);
      return true;
    },
    send: (f) => sent.push(JSON.parse(f)),
    now: () => ++clock,
    onPending: (c) => (state.pending = c),
    onArrivedUncopied: () => state.alerts++,
    onUnsaved: () => state.unsaved++,
  });
  return { inbox, store, sent, copies, seen, state, log, getDb: () => db };
}
const types = (sent: Array<Record<string, unknown>>, type: string) => sent.filter((s) => s.type === type);

test("a normal text is stored, copied, remembered, then acknowledged (qack only after the writes)", async () => {
  const r = rig();
  await r.inbox.handle(env(1));
  assert.deepEqual(r.copies, ["text-1"]);
  assert.equal(r.store.items.length, 1);
  assert.ok(r.seen.has(id(1)));
  assert.equal(types(r.sent, "qack").length, 1);
  assert.deepEqual(types(r.sent, "ack")[0], { type: "ack", id: id(1), copied: true });
  assert.equal(r.state.pending, 0);
});

test("a burst is handled strictly in arrival order, so the last text sent is the one on the clipboard", async () => {
  const r = rig({ decryptDelay: (n) => (n === 1 ? 30 : n === 2 ? 15 : 0) }); // earlier ones take longer to decrypt
  await Promise.all([r.inbox.handle(env(1)), r.inbox.handle(env(2)), r.inbox.handle(env(3))]);
  assert.deepEqual(r.copies, ["text-1", "text-2", "text-3"]);
  assert.deepEqual(r.store.items.map((c) => c.text), ["text-3", "text-2", "text-1"]);
});

test("a replay or redelivery of a seen id never touches the clipboard or the history, even after Clear", async () => {
  const r = rig();
  await r.inbox.handle(env(1));
  await r.store.clear();
  r.copies.length = 0;
  r.sent.length = 0;
  await r.inbox.handle(env(1)); // same ciphertext again
  assert.deepEqual(r.copies, []);
  assert.equal(r.store.items.length, 0);
  assert.deepEqual(r.sent, [{ type: "qack", id: id(1) }]); // just let the relay forget it
});

test("a replay beyond the newest 30 clips is also ignored", async () => {
  const r = rig();
  for (let i = 1; i <= 35; i++) await r.inbox.handle(env(i));
  assert.equal(r.store.items.length, 30);
  assert.ok(!r.store.items.some((c) => c.id === id(1))); // text 1 has been pushed out of the history
  r.copies.length = 0;
  await r.inbox.handle(env(1));
  assert.deepEqual(r.copies, []);
  assert.ok(!r.store.items.some((c) => c.id === id(1)));
});

test("unreadable messages are dropped explicitly (qack drop) and store nothing", async () => {
  const r = rig();
  await r.inbox.handle({ type: "msg", id: id(0), iv: "x", ct: "x" }); // decrypt gives null
  assert.deepEqual(r.sent, [{ type: "qack", id: id(0), drop: true }]);
  assert.equal(r.store.items.length, 0);
  assert.deepEqual(r.copies, []);
});

test("an envelope whose inner id differs, or that isn't a text message, is dropped", async () => {
  const r = rig();
  const e1 = { ...env(5), text: JSON.stringify({ type: "text", id: id(6), text: "relabelled", ts: 1 }) };
  const e2 = { ...env(7), text: JSON.stringify({ type: "ack", id: id(7), copied: true }) };
  await r.inbox.handle(e1 as Envelope);
  await r.inbox.handle(e2 as Envelope);
  assert.equal(types(r.sent, "qack").filter((q) => q.drop === true).length, 2);
  assert.equal(r.store.items.length, 0);
});

test("if the history can't be saved it is shown but NOT acknowledged, so the relay keeps holding it", async () => {
  const r = rig({ failSave: true });
  await r.inbox.handle(env(1));
  assert.equal(r.store.items.length, 1); // visible in memory
  assert.deepEqual(types(r.sent, "qack"), []);
  assert.deepEqual(types(r.sent, "ack"), []);
  assert.equal(r.state.unsaved, 1);
  assert.ok(!r.seen.has(id(1)));
});

test("if the id can't be remembered durably it is not acknowledged either", async () => {
  const r = rig({ failSeen: true });
  await r.inbox.handle(env(1));
  assert.deepEqual(types(r.sent, "qack"), []);
  assert.equal(r.state.unsaved, 1);
});

test("a redelivery of an unacknowledged text (still in memory) is acknowledged without copying again", async () => {
  const r = rig({ failSave: true });
  await r.inbox.handle(env(1)); // not durable: copied once, not acked
  r.copies.length = 0;
  r.state.failSave = false;
  await r.inbox.handle(env(1)); // relay redelivers
  assert.deepEqual(r.copies, [], "must not overwrite the clipboard a second time");
  assert.equal(r.store.items.filter((c) => c.id === id(1)).length, 1);
  assert.equal(types(r.sent, "qack").length, 1);
});

test("an unfocused tab stores the text uncopied, counts it as pending, and raises one alert", async () => {
  const r = rig({ focused: false });
  await r.inbox.handle(env(1));
  assert.deepEqual(r.copies, []);
  assert.equal(r.store.items[0].copied, false);
  assert.equal(r.inbox.pendingCount, 1);
  assert.equal(r.state.pending, 1);
  assert.equal(r.state.alerts, 1);
  assert.deepEqual(types(r.sent, "ack")[0], { type: "ack", id: id(1), copied: false });
});

test("returning to the tab copies the NEWEST pending text and clears the rest", async () => {
  const r = rig({ focused: false });
  await r.inbox.handle(env(1));
  await r.inbox.handle(env(2));
  assert.equal(r.inbox.pendingCount, 2);
  r.state.focused = true;
  await r.inbox.copyPending();
  assert.deepEqual(r.copies, ["text-2"]);
  assert.equal(r.inbox.pendingCount, 0);
  assert.equal(r.state.pending, 0);
  assert.equal(r.store.items.find((c) => c.id === id(2))!.copied, true);
  assert.equal(r.store.items.find((c) => c.id === id(1))!.copied, false); // superseded, not copied
  assert.deepEqual(types(r.sent, "ack").at(-1), { type: "ack", id: id(2), copied: true });
  await r.inbox.copyPending(); // nothing left to copy: the older one is NOT copied on the next focus
  assert.deepEqual(r.copies, ["text-2"]);
});

test("copyPending while still unfocused does nothing and keeps the text pending", async () => {
  const r = rig({ focused: false });
  await r.inbox.handle(env(1));
  await r.inbox.copyPending();
  assert.equal(r.inbox.pendingCount, 1);
  assert.deepEqual(r.copies, []);
});

test("an old uncopied clip from a previous visit is never auto-copied", async () => {
  const r = rig();
  await r.store.receive(async () => ({ id: id(99), text: "from last week", ts: 1, copied: false }));
  await r.inbox.copyPending();
  assert.deepEqual(r.copies, []);
});

test("a text arriving during a slow copyPending is not wiped from the pending set", async () => {
  const r = rig({ focused: false });
  await r.inbox.handle(env(1)); // pending {1}
  r.state.focused = true;
  const slowCopy = r.inbox.copyPending(); // starts first
  r.state.focused = false;
  const arrival = r.inbox.handle(env(2)); // arrives while that is running
  await Promise.all([slowCopy, arrival]);
  assert.ok(r.inbox.pendingCount >= 1, "the new arrival must still be waiting");
  assert.ok(r.store.items.some((c) => c.id === id(2) && !c.copied));
});

test("copyPending does not bring back a clip that was cleared meanwhile", async () => {
  const r = rig({ focused: false, copyDelay: 20 });
  await r.inbox.handle(env(1));
  r.state.focused = true;
  const cp = r.inbox.copyPending(); // copy is slow
  await sleep(5);
  await r.store.clear(); // user presses Clear during it
  await cp;
  assert.equal(r.store.items.length, 0, "must not resurrect the cleared clip");
});

test("markCopied (the user pressed Copy) removes it from pending and tells the phone", async () => {
  const r = rig({ focused: false });
  await r.inbox.handle(env(1));
  await r.inbox.markCopied(id(1));
  assert.equal(r.inbox.pendingCount, 0);
  assert.equal(r.store.items[0].copied, true);
  assert.deepEqual(types(r.sent, "ack").at(-1), { type: "ack", id: id(1), copied: true });
});

test("copying an old clip by hand marks it copied but does not message the phone", async () => {
  const r = rig();
  await r.store.receive(async () => ({ id: id(50), text: "old", ts: 1, copied: false }));
  await r.inbox.markCopied(id(50));
  assert.equal(r.store.items[0].copied, true);
  assert.deepEqual(types(r.sent, "ack"), []);
});

test("reset forgets everything waiting", async () => {
  const r = rig({ focused: false });
  await r.inbox.handle(env(1));
  r.inbox.reset();
  assert.equal(r.inbox.pendingCount, 0);
  assert.equal(r.state.pending, 0);
});

test("ClipStore.update changes a clip in place and reports false for a missing one", async () => {
  const r = rig();
  await r.store.receive(async () => ({ id: id(1), text: "a", ts: 5, copied: false }));
  assert.equal(await r.store.update(id(1), { copied: true }), true);
  assert.equal(r.store.items[0].copied, true);
  assert.equal(r.store.items[0].ts, 5);
  assert.equal(await r.store.update(id(2), { copied: true }), false);
  assert.equal(r.store.items.length, 1);
});

test("ClipStore reports non-durable saves to the caller", async () => {
  const r = rig({ failSave: true });
  let durable: boolean | null = null;
  await r.store.receive(async () => ({ id: id(1), text: "a", ts: 1, copied: true }), (_c, d) => (durable = d));
  assert.equal(durable, false);
  assert.equal(r.store.items.length, 1);
});

test("pickSeenToPrune keeps recent ids and drops old or excess ones", () => {
  const now = 10 * SEEN_MAX_AGE_MS;
  const rows = [
    { id: "fresh", ts: now - 1000 },
    { id: "old", ts: now - SEEN_MAX_AGE_MS - 1 },
    { id: "edge", ts: now - SEEN_MAX_AGE_MS },
  ];
  assert.deepEqual(pickSeenToPrune(rows, now), ["old"]);
  const many = Array.from({ length: SEEN_MAX + 5 }, (_, i) => ({ id: `i${i}`, ts: now - i }));
  const stale = pickSeenToPrune(many, now);
  assert.equal(stale.length, 5);
  assert.ok(stale.includes(`i${SEEN_MAX + 4}`) && !stale.includes("i0")); // the oldest go first
  assert.deepEqual(pickSeenToPrune([], now), []);
});

test("a stored-but-unacknowledged text that is redelivered still becomes pending and alerts, once", async () => {
  const r = rig({ focused: false, failSeen: true });
  await r.inbox.handle(env(1)); // stored uncopied, but its id could not be remembered: not acknowledged
  assert.equal(r.inbox.pendingCount, 0);
  assert.deepEqual(types(r.sent, "qack"), []);
  r.state.failSeen = false;
  await r.inbox.handle(env(1)); // the relay redelivers it
  assert.equal(r.inbox.pendingCount, 1);
  assert.equal(r.state.alerts, 1);
  assert.equal(types(r.sent, "qack").length, 1);
  await r.inbox.handle(env(1)); // a further redelivery is a replay now: no second alert
  assert.equal(r.state.alerts, 1);
  r.state.focused = true;
  await r.inbox.copyPending();
  assert.deepEqual(r.copies, ["text-1"]);
});

test("Clear is serialized with copies: it can't slip between 'pick the text' and 'write the clipboard'", async () => {
  const r = rig({ focused: false, copyDelay: 25 });
  await r.inbox.handle(env(1));
  r.state.focused = true;
  const cp = r.inbox.copyPending(); // picks text-1, then waits on a slow clipboard write
  const cl = r.inbox.clear(); // pressed meanwhile: must run AFTER the copy finished
  await Promise.all([cp, cl]);
  assert.deepEqual(r.copies, ["text-1"]); // the copy completed first, as the user's actions were ordered
  assert.equal(r.store.items.length, 0);
  assert.equal(r.inbox.pendingCount, 0);
  r.copies.length = 0;
  await r.inbox.copyPending();
  assert.deepEqual(r.copies, [], "nothing cleared can be copied afterwards");
});

test("Clear forgets what was waiting", async () => {
  const r = rig({ focused: false });
  await r.inbox.handle(env(1));
  await r.inbox.clear();
  assert.equal(r.inbox.pendingCount, 0);
  assert.equal(r.state.pending, 0);
  assert.equal(r.store.items.length, 0);
});

test("a failed on-disk clear leaves the list on screen intact instead of pretending", async () => {
  let cleared = false;
  const store = new ClipStore({
    load: async () => [{ id: id(1), text: "kept", ts: 1, copied: true }],
    save: async (cur, c) => addClip(cur, c),
    clear: async () => {
      cleared = true;
      throw new Error("blocked");
    },
    onChange: () => {},
  });
  await store.init();
  await store.clear();
  assert.equal(cleared, true);
  assert.equal(store.items.length, 1);
  await store.receive(async () => ({ id: id(2), text: "next", ts: 2, copied: true })); // the queue still works
  assert.equal(store.items.length, 2);
});
