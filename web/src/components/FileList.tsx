"use client";
import { useState } from "react";
import { getFile } from "@/lib/files";
import { formatBytes, type FileMeta } from "@/lib/files-core";

interface Props {
  files: FileMeta[];
  /** transfers in progress: id -> percent */
  incoming: Record<string, number>;
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

export function FileList({ files, incoming, onRemove, onClear }: Props) {
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
          <li key={f.id} className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
            <div className="break-words text-sm font-medium">{f.name}</div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-500">
              <span>
                {formatBytes(f.size)} · {new Date(f.ts).toLocaleTimeString()}
              </span>
              <span className="flex gap-2">
                <button
                  onClick={async () =>
                    setNotice((await download(f)) ? null : `"${f.name}" is no longer stored on this computer.`)
                  }
                  className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-inherit dark:border-zinc-700"
                >
                  Download
                </button>
                <button
                  onClick={() => onRemove(f.id)}
                  className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-inherit dark:border-zinc-700"
                >
                  Delete
                </button>
              </span>
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
