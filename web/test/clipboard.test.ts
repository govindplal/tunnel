import test from "node:test";
import assert from "node:assert/strict";
import { writeWithTimeout } from "../src/lib/clipboard.ts";

test("true when the write succeeds", async () => {
  assert.equal(await writeWithTimeout(async () => {}, 200), true);
});

test("false when the browser refuses (rejects)", async () => {
  assert.equal(await writeWithTimeout(() => Promise.reject(new Error("NotAllowedError")), 200), false);
});

test("false when the write throws synchronously", async () => {
  assert.equal(
    await writeWithTimeout(() => {
      throw new Error("no clipboard");
    }, 200),
    false,
  );
});

test("false, and not stuck, when the write never settles", async () => {
  const t0 = Date.now();
  assert.equal(await writeWithTimeout(() => new Promise<void>(() => {}), 50), false);
  assert.ok(Date.now() - t0 < 1000);
});

test("a slow write that finishes before the timeout still counts as success", async () => {
  assert.equal(await writeWithTimeout(() => new Promise<void>((r) => setTimeout(r, 30)), 300), true);
});
