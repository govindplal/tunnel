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

const btn = "rounded-md border border-zinc-300 px-3 py-1 text-sm text-inherit dark:border-zinc-700";
const LABEL = { image: "IMG", pdf: "PDF", none: "FILE" } as const;

function Thumb({ file }: { file: FileMeta }) {
  const url = useBlobUrl(file.thumb);
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-100 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
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
    return <p className="text-sm text-zinc-500">No files yet. Send one from your phone.</p>;
  }
  return (
    <section className="w-full text-left">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Files ({files.length})</h2>
        {files.length > 0 && (
          <button onClick={onClear} className="text-sm underline text-zinc-600 dark:text-zinc-400">
            Clear
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {receiving.map((pct, i) => (
          <li key={`in-${i}`} className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm dark:border-zinc-700">
            Receiving a file… {pct}%
            <progress className="mt-1 block w-full" value={pct} max={100} />
          </li>
        ))}
        {files.map((f) => (
          <li
            key={f.id}
            className={`rounded-lg border p-3 ${f.id === openId ? "border-zinc-500 dark:border-zinc-400" : "border-zinc-300 dark:border-zinc-700"}`}
          >
            <div className="flex gap-3">
              <Thumb file={f} />
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium">{f.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
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
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {notice}
        </p>
      )}
    </section>
  );
}
