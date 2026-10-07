import test from "node:test";
import assert from "node:assert/strict";
import { addClip, MAX_CLIPS, type Clip } from "../src/lib/clips-core.ts";

const clip = (id: string, ts: number): Clip => ({ id, text: id, ts, copied: true });

test("newest first", () => {
  let l: Clip[] = [];
  l = addClip(l, clip("a", 1));
  l = addClip(l, clip("b", 2));
  assert.deepEqual(l.map((c) => c.id), ["b", "a"]);
});

test("caps at MAX_CLIPS, dropping the oldest", () => {
  let l: Clip[] = [];
  for (let i = 0; i < MAX_CLIPS + 10; i++) l = addClip(l, clip(`c${i}`, i));
  assert.equal(l.length, MAX_CLIPS);
  assert.equal(l[0].id, `c${MAX_CLIPS + 9}`);
  assert.equal(l.at(-1)?.id, "c10");
});

test("same id replaces rather than duplicates", () => {
  let l = addClip([], clip("a", 1));
  l = addClip(l, { ...clip("a", 1), copied: false });
  assert.equal(l.length, 1);
  assert.equal(l[0].copied, false);
});

test("does not mutate the input list", () => {
  const l = [clip("a", 1)];
  addClip(l, clip("b", 2));
  assert.equal(l.length, 1);
});
