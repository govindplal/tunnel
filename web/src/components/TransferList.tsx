"use client";
import { formatBytes } from "@/lib/files-core";
import type { Transfer } from "@/lib/transfer-state";

const LABEL: Record<Transfer["state"], string> = {
  queued: "waiting for its turn…",
  sending: "sending…",
  waiting: "waiting for the computer…",
  delivered: "saved on computer",
  failed: "failed",
  cancelled: "cancelled",
};

export function TransferList({
  transfers,
  onCancel,
  onDismiss,
}: {
  transfers: Transfer[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (transfers.length === 0) return null;
  return (
    <ul className="w-full text-left text-sm">
      {transfers.map((t) => (
        <li key={t.id} className="border-t border-zinc-200 py-2 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{t.name}</span>
            <span className="shrink-0 text-xs text-zinc-500">{formatBytes(t.size)}</span>
          </div>
          {t.state === "sending" && <progress className="mt-1 block w-full" value={t.pct} max={100} />}
          {t.state === "waiting" && <progress className="mt-1 block w-full" value={t.arrived ?? 0} max={t.size} />}
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-zinc-500">
            <span className={t.state === "failed" ? "text-red-600 dark:text-red-400" : undefined}>
              {t.state === "failed" && t.error
                ? `failed: ${t.error}`
                : t.state === "waiting"
                  ? `arriving on the computer… ${Math.round(((t.arrived ?? 0) / t.size) * 100)}%`
                  : LABEL[t.state]}
            </span>
            {t.state === "sending" || t.state === "queued" ? (
              <button onClick={() => onCancel(t.id)} className="underline">
                Cancel
              </button>
            ) : (
              t.state !== "waiting" && (
                <button onClick={() => onDismiss(t.id)} className="underline">
                  Dismiss
                </button>
              )
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
