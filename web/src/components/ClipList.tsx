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
    return <p className="text-sm text-muted">Nothing received yet. Send text from your phone.</p>;
  }
  return (
    <section className="w-full text-left">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Received ({clips.length})</h2>
        <button onClick={onClear} className="text-sm link">
          Clear
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {clips.map((c) => (
          <li key={c.id} className="card p-3">
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{c.text}</pre>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
              <span>
                {new Date(c.ts).toLocaleTimeString()} · {c.copied ? "copied to clipboard" : "not auto-copied"}
              </span>
              <button
                onClick={() => copy(c)}
                className="btn"
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
