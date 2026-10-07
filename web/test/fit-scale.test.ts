import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, fitScale } from "../src/lib/viewer-core.ts";

test("fitScale leaves normal pages alone", () => {
  assert.deepEqual(fitScale(612, 792, 1), { scale: 1, clamped: false });
  assert.deepEqual(fitScale(612, 792, 3 * 2), { scale: 6, clamped: false }); // 3x zoom on a 2x screen
});

test("fitScale caps huge pages by total pixels", () => {
  const huge = fitScale(14400, 14400, 1); // a 200-inch square page
  assert.equal(huge.clamped, true);
  const side = 14400 * huge.scale;
  assert.ok(side <= MAX_CANVAS_SIDE + 1e-6);
  assert.ok(side * side <= MAX_CANVAS_PIXELS * (1 + 1e-9));
});

test("fitScale caps thin strips by side length, where the area cap would allow more", () => {
  const wide = fitScale(20000, 100, 1);
  assert.equal(wide.clamped, true);
  assert.ok(Math.abs(20000 * wide.scale - MAX_CANVAS_SIDE) < 1e-6);
});

test("fitScale never returns a zero or negative scale", () => {
  for (const [w, h, s] of [[0, 0, 1], [Number.NaN, 5, 2], [100, 100, 0], [100, 100, -1]] as const) {
    assert.ok(fitScale(w, h, s).scale > 0, `${w},${h},${s}`);
  }
});
