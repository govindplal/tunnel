// Browser-only PDF.js wrapper. PDF.js is loaded on first use so it never weighs on the
// pairing/text pages, and its worker is served as a bundled asset (same origin, no CDN).
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { fitScale } from "./viewer-core";

let lib: Promise<typeof import("pdfjs-dist")> | null = null;

function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return lib;
}

/** `destroy` frees the document and stops its worker: call it when done with the PDF. */
export async function openPdf(blob: Blob): Promise<{ doc: PDFDocumentProxy; destroy: () => Promise<void> }> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = (await pdfjs()).getDocument({ data });
  try {
    return { doc: await task.promise, destroy: () => task.destroy() };
  } catch (e) {
    void task.destroy(); // a corrupt or password-protected file would otherwise leak its worker
    throw e;
  }
}

export interface RenderHandle {
  /** Resolves when drawn (or quietly when cancelled). `clamped` = the page was too large for the zoom asked. */
  done: Promise<{ clamped: boolean }>;
  cancel: () => void;
}

// One render at a time per canvas: PDF.js throws if two overlap, and a stale render must never
// draw over a newer one.
const active = new WeakMap<HTMLCanvasElement, RenderHandle>();

/**
 * Draws one page (1-based) onto `canvas` at `scale`, sharp on high-DPI screens, within safe
 * canvas size limits. A new call cancels the previous one on the same canvas.
 */
export function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  opts: { useDpr?: boolean } = {},
): RenderHandle {
  const previous = active.get(canvas);
  previous?.cancel();
  let cancelled = false;
  let task: RenderTask | undefined;

  const done = (async () => {
    await previous?.done.catch(() => {}); // let the old render finish unwinding before reusing the canvas
    if (cancelled) return { clamped: false };
    const page = await doc.getPage(pageNumber);
    if (cancelled) return { clamped: false };
    const base = page.getViewport({ scale: 1 });
    const dpr = opts.useDpr === false ? 1 : window.devicePixelRatio || 1;
    const fit = fitScale(base.width, base.height, scale * dpr);
    const viewport = page.getViewport({ scale: fit.scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    task = page.render({ canvas, viewport });
    try {
      await task.promise;
    } catch (e) {
      if ((e as { name?: string }).name !== "RenderingCancelledException") throw e;
    }
    return { clamped: fit.clamped };
  })();

  const handle: RenderHandle = {
    done,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
  active.set(canvas, handle);
  return handle;
}
