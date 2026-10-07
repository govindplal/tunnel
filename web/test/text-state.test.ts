import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SENT_LISTED, reduceTexts, type SentText, type TextEvent } from "../src/lib/text-state.ts";

const run = (events: TextEvent[], from: SentText[] = []) => events.reduce(reduceTexts, from);
const add = (id: string): TextEvent => ({ type: "add", id, preview: id });
const state = (l: SentText[], id: string) => l.find((t) => t.id === id)?.state;

test("host online: sent -> copied", () => {
  assert.equal(state(run([add("a"), { type: "acked", id: "a", copied: true }]), "a"), "copied");
});

test("host online but tab in the background: sent -> stored, then upgraded to copied when the user returns", () => {
  let l = run([add("a"), { type: "acked", id: "a", copied: false }]);
  assert.equal(state(l, "a"), "stored");
  l = run([{ type: "acked", id: "a", copied: true }], l);
  assert.equal(state(l, "a"), "copied");
});

test("host offline: sent -> queued -> received -> copied", () => {
  let l = run([add("a"), { type: "queued", id: "a" }]);
  assert.equal(state(l, "a"), "queued");
  l = run([{ type: "delivered", id: "a" }], l);
  assert.equal(state(l, "a"), "received");
  l = run([{ type: "acked", id: "a", copied: true }], l);
  assert.equal(state(l, "a"), "copied");
});

test("copied is never downgraded by a late or repeated event", () => {
  const l = run([
    add("a"), { type: "acked", id: "a", copied: true },
    { type: "delivered", id: "a" }, { type: "acked", id: "a", copied: false },
    { type: "queued", id: "a" }, { type: "timeout", id: "a" }, { type: "rejected", id: "a" },
  ]);
  assert.equal(state(l, "a"), "copied");
});

test("the 'delivered' notice and the ack can arrive in either order", () => {
  assert.equal(state(run([add("a"), { type: "acked", id: "a", copied: true }, { type: "delivered", id: "a" }]), "a"), "copied");
  assert.equal(state(run([add("a"), { type: "delivered", id: "a" }, { type: "acked", id: "a", copied: false }]), "a"), "stored");
  assert.equal(state(run([add("a"), { type: "acked", id: "a", copied: false }, { type: "delivered", id: "a" }]), "a"), "stored");
});

test("rejected only applies before the computer has it", () => {
  assert.equal(state(run([add("a"), { type: "rejected", id: "a" }]), "a"), "rejected");
  assert.equal(state(run([add("b"), { type: "queued", id: "b" }, { type: "rejected", id: "b" }]), "b"), "rejected");
  assert.equal(state(run([add("c"), { type: "delivered", id: "c" }, { type: "rejected", id: "c" }]), "c"), "received");
});

test("a queued text legitimately waits: the 'no word back' timeout only applies to plain 'sent'", () => {
  assert.equal(state(run([add("a"), { type: "queued", id: "a" }, { type: "timeout", id: "a" }]), "a"), "queued");
  assert.equal(state(run([add("b"), { type: "timeout", id: "b" }]), "b"), "unconfirmed");
});

test("an unconfirmed text is still corrected by a late notice or ack", () => {
  assert.equal(state(run([add("a"), { type: "timeout", id: "a" }, { type: "delivered", id: "a" }]), "a"), "received");
  assert.equal(state(run([add("b"), { type: "timeout", id: "b" }, { type: "acked", id: "b", copied: true }]), "b"), "copied");
});

test("the list is capped, newest first; unknown ids and no-ops keep the same array", () => {
  const l = run(Array.from({ length: MAX_SENT_LISTED + 3 }, (_, i) => add(`t${i}`)));
  assert.equal(l.length, MAX_SENT_LISTED);
  assert.equal(l[0].id, `t${MAX_SENT_LISTED + 2}`);
  assert.equal(reduceTexts(l, { type: "queued", id: "nope" }), l);
  assert.equal(reduceTexts(l, { type: "delivered", id: "nope" }), l);
  const done = run([add("x"), { type: "acked", id: "x", copied: true }]);
  assert.equal(reduceTexts(done, { type: "queued", id: "x" }), done);
});

test("an ack corrects a 'rejected' (the message was delivered live even though the queue was full)", () => {
  assert.equal(state(run([add("a"), { type: "rejected", id: "a" }, { type: "acked", id: "a", copied: true }]), "a"), "copied");
  assert.equal(state(run([add("b"), { type: "rejected", id: "b" }, { type: "acked", id: "b", copied: false }]), "b"), "stored");
  // but a 'delivered' notice never contradicts a rejection (nothing was held)
  assert.equal(state(run([add("c"), { type: "rejected", id: "c" }, { type: "delivered", id: "c" }]), "c"), "rejected");
});
