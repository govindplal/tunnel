// Pure rules for the file viewer, kept separate from the DOM/PDF.js code so they can be tested.
export type ViewKind = "image" | "pdf" | "none";

// Formats we can show AND size-check from their header before decoding (see image-info.ts).
// SVG is left out on purpose (can't be thumbnailed reliably everywhere), HEIC isn't displayable
// in most browsers, and AVIF headers are too involved to size-check cheaply.
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

/** Decides how to show a file. The mime comes from the sender, so fall back to the extension when it is missing. */
export function viewKind(mime: string, name: string): ViewKind {
  const type = mime.split(";")[0].trim().toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(type)) return "image";
  if (type === "" || type === "application/octet-stream") {
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (ext === "pdf") return "pdf";
    if (IMAGE_EXT.has(ext)) return "image";
  }
  return "none";
}

export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
export const DEFAULT_ZOOM = 1;

/** Next zoom step in `dir` (+1 or -1); stays put at either end. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const i = ZOOMS.reduce((best, z, idx) => (Math.abs(z - current) < Math.abs(ZOOMS[best] - current) ? idx : best), 0);
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))];
}

/** Keeps a 1-based page number within 1..total (total 0 means no pages: page 1). */
export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, total));
}

export const THUMB_MAX = 96;

/** Scales (w, h) to fit a THUMB_MAX box, keeping aspect ratio; never upscales, never returns 0. */
export function thumbSize(w: number, h: number, max = THUMB_MAX): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: max, height: max };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Browsers cap canvases (about 16k px per side, ~268M px total, less on phones). Stay well under
// so a sender-controlled page size can never blank the canvas or exhaust memory.
export const MAX_CANVAS_SIDE = 8192;
export const MAX_CANVAS_PIXELS = 40_000_000;

/** Largest scale that keeps a (w x h) page within the canvas caps; `clamped` says if `wanted` was reduced. */
export function fitScale(w: number, h: number, wanted: number): { scale: number; clamped: boolean } {
  if (!(w > 0) || !(h > 0) || !(wanted > 0)) return { scale: wanted > 0 ? wanted : 1, clamped: false };
  const cap = Math.min(MAX_CANVAS_SIDE / Math.max(w, h), Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
  return wanted <= cap ? { scale: wanted, clamped: false } : { scale: cap, clamped: true };
}
