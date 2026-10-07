"use client";
import { useState } from "react";
import type { Clip } from "@/lib/clips-core";

export function ClipList({
  clips,
  onClear,
  onCopied,
}: {
  clips: Clip[];
  onClear: () => void;
  /** called after the user copies a clip by hand */
  onCopied?: (clip: Clip) => void;
}) {
  const [flash, setFlash] = useState<string | null>(null);

  async function copy(c: Clip) {
    try {
      await navigator.clipboard.writeText(c.text);
      onCopied?.(c);
      setFlash(c.id);
      setTimeout(() => setFlash((f) => (f === c.id ? null : f)), 1500);
    } catch {
      // clipboard blocked: the text is still selectable on screen
    }
  }

  if (clips.length === 0) {
    return <p className="text-sm text-zinc-500">Nothing received yet. Send text from your phone.</p>;
  }
  return (
    <section className="w-full text-left">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Received ({clips.length})</h2>
        <button onClick={onClear} className="text-sm underline text-zinc-600 dark:text-zinc-400">
          Clear
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {clips.map((c) => (
          <li key={c.id} className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{c.text}</pre>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-500">
              <span>
                {new Date(c.ts).toLocaleTimeString()} · {c.copied ? "copied to clipboard" : "not auto-copied"}
              </span>
              <button
                onClick={() => copy(c)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-inherit dark:border-zinc-700"
              >
                {flash === c.id ? "Copied" : "Copy"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
