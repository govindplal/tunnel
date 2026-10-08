"use client";
import { useState } from "react";
import { useBlobUrl } from "@/hooks/useBlobUrl";
import { getFile } from "@/lib/files";
import { formatBytes, type FileMeta } from "@/lib/files-core";
import { viewKind } from "@/lib/viewer-core";

interface Props {
  files: FileMeta[];
  /** transfers in progress: id -> percent */
  incoming: Record<string, number>;
  /** the file currently open in the viewer, if any */
  openId: string | null;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

/** Returns false if the file is no longer in storage (evicted, cleared or deleted). */
async function download(meta: FileMeta): Promise<boolean> {
  const stored = await getFile(meta.id);
  if (!stored) return false;
  const url = URL.createObjectURL(stored.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = meta.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

const btn = "btn";
const LABEL = { image: "IMG", pdf: "PDF", none: "FILE" } as const;

function Thumb({ file }: { file: FileMeta }) {
  const url = useBlobUrl(file.thumb);
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-line bg-paper-2 text-[10px] font-medium text-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL; next/image can't optimize it
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        LABEL[viewKind(file.mime, file.name)]
      )}
    </div>
  );
}

export function FileList({ files, incoming, openId, onOpen, onRemove, onClear }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const receiving = Object.values(incoming);
  if (files.length === 0 && receiving.length === 0) {
    return <p className="text-sm text-muted">No files yet. Send one from your phone.</p>;
  }
  return (
    <section className="w-full text-left">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Files ({files.length})</h2>
        {files.length > 0 && (
          <button onClick={onClear} className="text-sm link">
            Clear
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {receiving.map((pct, i) => (
          <li key={`in-${i}`} className="rounded-2xl border-2 border-dashed border-line p-3 text-sm">
            Receiving a file… {pct}%
            <progress className="mt-1 block w-full" value={pct} max={100} />
          </li>
        ))}
        {files.map((f) => (
          <li
            key={f.id}
            className={`card p-3 ${f.id === openId ? "!border-coral" : ""}`}
          >
            <div className="flex gap-3">
              <Thumb file={f} />
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium">{f.name}</div>
                <div className="mt-1 text-xs text-muted">
                  {formatBytes(f.size)} · {new Date(f.ts).toLocaleTimeString()}
                </div>
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              {viewKind(f.mime, f.name) !== "none" && (
                <button onClick={() => onOpen(f.id)} className={btn} aria-label={`View ${f.name}`}>
                  {f.id === openId ? "Viewing" : "View"}
                </button>
              )}
              <button
                onClick={async () =>
                  setNotice((await download(f)) ? null : `"${f.name}" is no longer stored on this computer.`)
                }
                className={btn}
                aria-label={`Download ${f.name}`}
              >
                Download
              </button>
              <button onClick={() => onRemove(f.id)} className={btn} aria-label={`Delete ${f.name}`}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {notice && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {notice}
        </p>
      )}
    </section>
  );
}
