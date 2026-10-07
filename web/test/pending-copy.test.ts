import test from "node:test";
import assert from "node:assert/strict";
import type { Clip } from "../src/lib/clips-core.ts";
import { pickClipToCopy, titleFor } from "../src/lib/pending-copy.ts";

const clip = (id: string, copied: boolean): Clip => ({ id, text: id, ts: 0, copied });
const seen = (...ids: string[]) => new Set(ids);

test("picks the newest uncopied clip that arrived this session (the list is newest first)", () => {
  const list = [clip("new", false), clip("mid", false), clip("old", true)];
  assert.equal(pickClipToCopy(list, seen("new", "mid"))?.id, "new");
  assert.equal(pickClipToCopy([clip("new", true), clip("mid", false)], seen("new", "mid"))?.id, "mid");
});

test("an uncopied clip from a previous visit is never auto-copied", () => {
  // e.g. text that arrived last week while the tab was in the background: copying it now would
  // silently replace whatever the user has on their clipboard
  assert.equal(pickClipToCopy([clip("last-week", false)], seen()), null);
  assert.equal(pickClipToCopy([clip("new", false), clip("last-week", false)], seen("new"))?.id, "new");
  assert.equal(pickClipToCopy([clip("last-week", false), clip("new", false)], seen("new"))?.id, "new");
});

test("nothing to copy when everything is copied or the list is empty", () => {
  assert.equal(pickClipToCopy([clip("a", true), clip("b", true)], seen("a", "b")), null);
  assert.equal(pickClipToCopy([], seen("a")), null);
});

test("title shows a marker only while text is waiting", () => {
  assert.equal(titleFor(0), "Tunnel");
  assert.equal(titleFor(1), "(1) New text - Tunnel");
  assert.equal(titleFor(9), "(9) New text - Tunnel");
  assert.equal(titleFor(12), "(9+) New text - Tunnel");
});
