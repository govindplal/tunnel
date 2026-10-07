// Browser-only: makes the small preview image stored next to each received file.
import { checkImageBlob } from "./image-info";
import { openPdf, renderPage } from "./pdf";
import { THUMB_MAX, thumbSize, viewKind } from "./viewer-core";

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.7));
}

async function imageThumb(blob: Blob): Promise<Blob | null> {
  // Refuse images that declare an absurd size before the browser tries to decode them.
  if ((await checkImageBlob(blob)) !== "ok") return null;
  // resizeWidth lets the browser downscale while decoding instead of holding a full-size bitmap.
  const bmp = await createImageBitmap(blob, { resizeWidth: THUMB_MAX, resizeQuality: "medium" });
  try {
    const { width, height } = thumbSize(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, width, height);
    return await toBlob(canvas);
  } finally {
    bmp.close();
  }
}

async function pdfThumb(blob: Blob): Promise<Blob | null> {
  const { doc, destroy } = await openPdf(blob);
  try {
    const first = await doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    const { width } = thumbSize(base.width, base.height);
    const canvas = document.createElement("canvas");
    // Thumbnails are tiny: no devicePixelRatio boost.
    await renderPage(doc, 1, canvas, width / base.width, { useDpr: false }).done;
    return await toBlob(canvas);
  } finally {
    void destroy();
  }
}

/** Never throws: a file that can't be thumbnailed simply has no thumbnail. */
export async function makeThumbnail(blob: Blob, mime: string, name: string): Promise<Blob | null> {
  try {
    const kind = viewKind(mime, name);
    if (kind === "image") return await imageThumb(blob);
    if (kind === "pdf") return await pdfThumb(blob);
  } catch {
    // corrupt or unsupported file
  }
  return null;
}
