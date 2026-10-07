import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LISTED, TIMEOUT_MESSAGE, reduceTransfers, type Transfer, type TransferEvent,
} from "../src/lib/transfer-state.ts";

const run = (events: TransferEvent[], from: Transfer[] = []) => events.reduce(reduceTransfers, from);
const add = (id: string): TransferEvent => ({ type: "add", id, name: `${id}.pdf`, size: 100 });
const state = (list: Transfer[], id: string) => list.find((t) => t.id === id)?.state;

test("happy path: queued -> sending -> waiting -> delivered", () => {
  const l = run([add("a"), { type: "start", id: "a" }, { type: "progress", id: "a", pct: 40 }]);
  assert.equal(l[0].pct, 40);
  const done = run([{ type: "sent", id: "a" }, { type: "ack", id: "a", ok: true }], l);
  assert.equal(state(done, "a"), "delivered");
  assert.equal(done[0].pct, 100);
});

test("new transfers go to the top and the list is capped", () => {
  const l = run(Array.from({ length: MAX_LISTED + 3 }, (_, i) => add(`f${i}`)));
  assert.equal(l.length, MAX_LISTED);
  assert.equal(l[0].id, `f${MAX_LISTED + 2}`);
});

test("cancelled stays cancelled: a late failure or refusal cannot overwrite it", () => {
  let l = run([add("a"), { type: "start", id: "a" }, { type: "cancel", id: "a" }]);
  l = run([{ type: "fail", id: "a", error: "Cancelled." }, { type: "ack", id: "a", ok: false, reason: "no" }], l);
  assert.equal(state(l, "a"), "cancelled");
});

test("a late ok ack does not resurrect a cancelled or connection-lost transfer", () => {
  const cancelled = run([add("a"), { type: "start", id: "a" }, { type: "cancel", id: "a" }, { type: "ack", id: "a", ok: true }]);
  assert.equal(state(cancelled, "a"), "cancelled");
  const lost = run([add("b"), { type: "start", id: "b" }, { type: "connectionLost" }, { type: "ack", id: "b", ok: true }]);
  assert.equal(state(lost, "b"), "failed");
});

test("a failed transfer is never later shown as delivered by a stray ack", () => {
  const l = run([add("a"), { type: "start", id: "a" }, { type: "fail", id: "a", error: "boom" }, { type: "ack", id: "a", ok: true }]);
  assert.equal(state(l, "a"), "failed");
  assert.equal(l[0].error, "boom");
});

test("refusal from the computer fails queued, sending and waiting transfers", () => {
  const l = run([
    add("q"), add("s"), add("w"),
    { type: "start", id: "s" },
    { type: "start", id: "w" }, { type: "sent", id: "w" },
    { type: "ack", id: "q", ok: false, reason: "busy" },
    { type: "ack", id: "s", ok: false },
    { type: "ack", id: "w", ok: false, reason: "disk full" },
  ]);
  assert.deepEqual(["q", "s", "w"].map((id) => state(l, id)), ["failed", "failed", "failed"]);
  assert.equal(l.find((t) => t.id === "q")!.error, "busy");
  assert.equal(l.find((t) => t.id === "s")!.error, "The computer refused the file.");
});

test("ack timeout fails a waiting transfer, and a late ok ack still corrects it", () => {
  let l = run([add("a"), { type: "start", id: "a" }, { type: "sent", id: "a" }, { type: "ackTimeout", id: "a" }]);
  assert.equal(state(l, "a"), "failed");
  assert.equal(l[0].error, TIMEOUT_MESSAGE);
  l = run([{ type: "ack", id: "a", ok: true }], l);
  assert.equal(state(l, "a"), "delivered");
  assert.equal(l[0].error, undefined);
});

test("ack timeout does nothing once the transfer is delivered", () => {
  const l = run([add("a"), { type: "start", id: "a" }, { type: "sent", id: "a" }, { type: "ack", id: "a", ok: true }, { type: "ackTimeout", id: "a" }]);
  assert.equal(state(l, "a"), "delivered");
});

test("connectionLost fails queued and sending, but leaves waiting and delivered alone", () => {
  const l = run([
    add("q"), add("s"), add("w"), add("d"),
    { type: "start", id: "s" },
    { type: "start", id: "w" }, { type: "sent", id: "w" },
    { type: "start", id: "d" }, { type: "sent", id: "d" }, { type: "ack", id: "d", ok: true },
    { type: "connectionLost" },
  ]);
  assert.deepEqual(["q", "s", "w", "d"].map((id) => state(l, id)), ["failed", "failed", "waiting", "delivered"]);
});

test("progress is ignored unless sending; unknown ids and no-ops keep the same array", () => {
  const l = run([add("a")]);
  assert.equal(reduceTransfers(l, { type: "progress", id: "a", pct: 50 }), l); // still queued
  assert.equal(reduceTransfers(l, { type: "start", id: "nope" }), l);
  assert.equal(reduceTransfers(l, { type: "connectionLost" }).length, 1);
  const idle = run([add("x"), { type: "start", id: "x" }, { type: "sent", id: "x" }, { type: "ack", id: "x", ok: true }]);
  assert.equal(reduceTransfers(idle, { type: "connectionLost" }), idle);
});

test("dismiss removes only that transfer", () => {
  const l = run([add("a"), add("b"), { type: "dismiss", id: "a" }]);
  assert.deepEqual(l.map((t) => t.id), ["b"]);
});

test("arrived: tracks host progress, monotonic and clamped to the file size", () => {
  let l = run([add("a"), { type: "start", id: "a" }, { type: "sent", id: "a" }]); // size 100
  l = run([{ type: "arrived", id: "a", received: 40 }], l);
  assert.equal(l[0].arrived, 40);
  l = run([{ type: "arrived", id: "a", received: 20 }], l); // reordered report
  assert.equal(l[0].arrived, 40);
  l = run([{ type: "arrived", id: "a", received: 9999 }], l); // bogus
  assert.equal(l[0].arrived, 100);
});

test("arrived is ignored for queued and terminal transfers and does not change the array", () => {
  const queued = run([add("a")]);
  assert.equal(reduceTransfers(queued, { type: "arrived", id: "a", received: 10 }), queued);
  const done = run([add("b"), { type: "start", id: "b" }, { type: "sent", id: "b" }, { type: "ack", id: "b", ok: true }]);
  assert.equal(reduceTransfers(done, { type: "arrived", id: "b", received: 10 }), done);
  const same = run([add("c"), { type: "start", id: "c" }, { type: "arrived", id: "c", received: 10 }]);
  assert.equal(reduceTransfers(same, { type: "arrived", id: "c", received: 10 }), same);
});
