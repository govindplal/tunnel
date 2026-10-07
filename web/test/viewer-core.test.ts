import test from "node:test";
import assert from "node:assert/strict";
import { THUMB_MAX, ZOOMS, clampPage, stepZoom, thumbSize, viewKind } from "../src/lib/viewer-core.ts";

test("viewKind: pdf and common image types by mime", () => {
  assert.equal(viewKind("application/pdf", "x"), "pdf");
  assert.equal(viewKind("APPLICATION/PDF; charset=binary", "x"), "pdf");
  for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]) {
    assert.equal(viewKind(t, "x"), "image", t);
  }
});

test("viewKind: falls back to the extension only when the mime is missing or generic", () => {
  assert.equal(viewKind("", "Report.PDF"), "pdf");
  assert.equal(viewKind("application/octet-stream", "photo.JPG"), "image");
  assert.equal(viewKind("", "noextension"), "none");
  assert.equal(viewKind("", "archive.tar.gz"), "none");
  // an explicit, different mime wins over a misleading extension
  assert.equal(viewKind("text/plain", "photo.png"), "none");
  assert.equal(viewKind("application/zip", "doc.pdf"), "none");
});

test("viewKind: anything else (including svg, heic, html) is download-only", () => {
  for (const t of ["image/svg+xml", "image/heic", "image/avif", "text/html", "application/zip", "video/mp4"]) {
    assert.equal(viewKind(t, "x"), "none", t);
  }
  assert.equal(viewKind("", "icon.svg"), "none");
});

test("stepZoom moves one step and stops at both ends", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(ZOOMS[0], -1), ZOOMS[0]);
  assert.equal(stepZoom(ZOOMS.at(-1)!, 1), ZOOMS.at(-1));
  assert.equal(stepZoom(1.1, 1), 1.25); // off-grid value snaps to the nearest step first
});

test("clampPage keeps the page in range and survives bad input", () => {
  assert.equal(clampPage(0, 5), 1);
  assert.equal(clampPage(9, 5), 5);
  assert.equal(clampPage(3, 5), 3);
  assert.equal(clampPage(2.9, 5), 2);
  assert.equal(clampPage(Number.NaN, 5), 1);
  assert.equal(clampPage(4, 0), 1);
});

test("thumbSize keeps aspect ratio, fits the box, never upscales or returns 0", () => {
  assert.deepEqual(thumbSize(1920, 1080), { width: THUMB_MAX, height: 54 });
  assert.deepEqual(thumbSize(1080, 1920), { width: 54, height: THUMB_MAX });
  assert.deepEqual(thumbSize(40, 20), { width: 40, height: 20 });
  assert.deepEqual(thumbSize(10000, 1), { width: THUMB_MAX, height: 1 });
  assert.deepEqual(thumbSize(0, 0), { width: THUMB_MAX, height: THUMB_MAX });
  assert.deepEqual(thumbSize(Number.NaN, 5), { width: THUMB_MAX, height: THUMB_MAX });
});
