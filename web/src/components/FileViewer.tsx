"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useBlobUrl } from "@/hooks/useBlobUrl";
import { getFile } from "@/lib/files";
import type { FileMeta } from "@/lib/files-core";
import { checkImageBlob, type ImageVerdict } from "@/lib/image-info";
import { openPdf, renderPage } from "@/lib/pdf";
import { DEFAULT_ZOOM, clampPage, stepZoom, viewKind } from "@/lib/viewer-core";

const btn =
  "rounded-md border border-zinc-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-zinc-700";
const errorText = "p-4 text-sm text-red-600 dark:text-red-400";

function ImageView({ blob, name }: { blob: Blob; name: string }) {
  // Header check first: a tiny file can declare gigapixel dimensions and freeze the tab on decode.
  const [checked, setChecked] = useState<{ blob: Blob; verdict: ImageVerdict } | null>(null);
  useEffect(() => {
    let cancelled = false;
    checkImageBlob(blob).then((verdict) => !cancelled && setChecked({ blob, verdict }));
    return () => {
      cancelled = true;
    };
  }, [blob]);
  const verdict = checked?.blob === blob ? checked.verdict : null;
  const url = useBlobUrl(verdict === "ok" ? blob : null);
  const [failed, setFailed] = useState(false);

  if (verdict === "too-large") {
    return (
      <p role="alert" className={errorText}>
        This image is too large to preview safely. Use Download.
      </p>
    );
  }
  if (verdict === "unreadable" || failed) {
    return (
      <p role="alert" className={errorText}>
        Couldn&apos;t display this image.
      </p>
    );
  }
  if (!url) return <p className="p-4 text-sm text-zinc-500">Loading…</p>;
  // eslint-disable-next-line @next/next/no-img-element -- a local blob URL; next/image can't optimize it
  return <img src={url} alt={name} onError={() => setFailed(true)} className="mx-auto max-h-[70vh] max-w-full object-contain" />;
}

function PdfView({ blob, name }: { blob: Blob; name: string }) {
  const [pdf, setPdf] = useState<{ doc: PDFDocumentProxy; pages: number; blob: Blob } | null>(null);
  const [error, setError] = useState<Blob | null>(null);
  const [clamped, setClamped] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    openPdf(blob)
      .then((h) => {
        if (cancelled) return void h.destroy();
        destroy = h.destroy;
        setPdf({ doc: h.doc, pages: h.doc.numPages, blob });
      })
      .catch(() => !cancelled && setError(blob));
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [blob]);

  const ready = pdf && pdf.blob === blob ? pdf : null;

  useEffect(() => {
    if (!ready || !canvas.current) return;
    let stale = false;
    const r = renderPage(ready.doc, clampPage(page, ready.pages), canvas.current, zoom);
    r.done.then(
      (res) => !stale && setClamped(res.clamped),
      () => !stale && setError(blob), // only a genuine failure of the current render
    );
    return () => {
      stale = true;
      r.cancel();
    };
  }, [ready, page, zoom, blob]);

  if (error === blob) {
    return (
      <p role="alert" className={errorText}>
        Couldn&apos;t render this PDF.
      </p>
    );
  }
  if (!ready) return <p className="p-4 text-sm text-zinc-500">Loading PDF…</p>;
  const current = clampPage(page, ready.pages);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-2 border-b border-zinc-200 p-2 text-sm dark:border-zinc-800">
        <button className={btn} onClick={() => setPage(current - 1)} disabled={current <= 1}>
          Previous
        </button>
        <button className={btn} onClick={() => setPage(current + 1)} disabled={current >= ready.pages}>
          Next
        </button>
        <button className={btn} onClick={() => setZoom(stepZoom(zoom, -1))} aria-label="Zoom out">
          −
        </button>
        <button className={btn} onClick={() => setZoom(stepZoom(zoom, 1))} aria-label="Zoom in">
          +
        </button>
        <span aria-live="polite">
          Page {current} of {ready.pages} · {Math.round(zoom * 100)}%
        </span>
      </div>
      {clamped && <p className="px-3 py-1 text-xs text-zinc-500">This page is very large, so zoom is limited.</p>}
      <div className="max-h-[70vh] overflow-auto bg-zinc-100 p-2 dark:bg-zinc-900" tabIndex={0} aria-label="Document page">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${name}, page ${current} of ${ready.pages}`}
          className="mx-auto block bg-white shadow"
        />
      </div>
    </div>
  );
}

/** Shows one stored file: images directly, PDFs page by page, everything else as download-only. */
export function FileViewer({ file, onClose }: { file: FileMeta; onClose: () => void }) {
  const kind = viewKind(file.mime, file.name);
  const [loaded, setLoaded] = useState<{ id: string; blob: Blob | null } | null>(null);

  useEffect(() => {
    if (kind === "none") return;
    let cancelled = false;
    getFile(file.id).then((f) => !cancelled && setLoaded({ id: file.id, blob: f?.blob ?? null }));
    return () => {
      cancelled = true;
    };
  }, [file.id, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const blob = loaded?.id === file.id ? loaded.blob : undefined; // undefined = still loading

  return (
    <section className="w-full overflow-hidden rounded-lg border border-zinc-300 text-left dark:border-zinc-700" aria-label="File viewer">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h2 className="truncate text-sm font-medium">{file.name}</h2>
        <button className={btn} onClick={onClose} aria-label={`Close ${file.name}`}>
          Close
        </button>
      </div>
      {kind === "none" ? (
        <p className="p-4 text-sm text-zinc-500">No preview for this file type. Use Download.</p>
      ) : blob === undefined ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : blob === null ? (
        <p role="alert" className={errorText}>
          This file is no longer stored on this computer.
        </p>
      ) : kind === "image" ? (
        <ImageView key={file.id} blob={blob} name={file.name} />
      ) : (
        <PdfView key={file.id} blob={blob} name={file.name} />
      )}
    </section>
  );
}
