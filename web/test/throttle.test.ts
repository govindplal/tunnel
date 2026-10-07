import test from "node:test";
import assert from "node:assert/strict";
import { createKeyedThrottle } from "../src/lib/throttle.ts";

test("first call per key is allowed, repeats within the window are not", () => {
  let t = 1000;
  const th = createKeyedThrottle(500, () => t);
  assert.equal(th.allow("a"), true);
  t += 499;
  assert.equal(th.allow("a"), false);
  t += 1;
  assert.equal(th.allow("a"), true);
});

test("keys are independent, and forget resets a key", () => {
  const th = createKeyedThrottle(1000, () => 0);
  assert.equal(th.allow("a"), true);
  assert.equal(th.allow("b"), true);
  assert.equal(th.allow("a"), false);
  th.forget("a");
  assert.equal(th.allow("a"), true);
});

test("a time of 0 is still treated as a previous call", () => {
  const th = createKeyedThrottle(1000, () => 0);
  assert.equal(th.allow("a"), true);
  assert.equal(th.allow("a"), false);
});
