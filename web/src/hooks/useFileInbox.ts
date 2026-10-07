"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileReceiver } from "@/lib/file-transfer";
import { FileStore } from "@/lib/file-store";
import { parseFileMessage } from "@/lib/file-protocol";
import { clearFiles, deleteFile, listFiles, saveFile, saveThumb } from "@/lib/files";
import { SerialQueue } from "@/lib/serial-queue";
import { createKeyedThrottle } from "@/lib/throttle";
import { makeThumbnail } from "@/lib/thumbs";
import type { FileMeta } from "@/lib/files-core";

type Send = (data: string | Uint8Array) => boolean;

const PROGRESS_REPORT_MS = 1000;

/** Host side of file casting: receives chunks, stores files, acks the phone. */
export function useFileInbox(
  send: Send,
  paired: boolean,
  /**
   * Called once a received file is safely stored (e.g. to open it in the viewer). Pass a STABLE
   * function (useCallback): a new identity rebuilds the receiver and drops in-flight transfers.
   */
  onStored?: (f: { id: string; name: string; mime: string }) => void,
) {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [incoming, setIncoming] = useState<Record<string, number>>({});
  const thumbQueue = useMemo(() => new SerialQueue(), []);
  const store = useMemo(
    () =>
      new FileStore({
        list: listFiles,
        save: (f, ts) => saveFile({ id: f.id, name: f.name, mime: f.mime, size: f.size, ts, blob: f.blob }),
        setThumb: saveThumb,
        remove: deleteFile,
        clear: clearFiles,
        onChange: setFiles,
      }),
    [],
  );

  const ack = useCallback(
    (id: string, ok: boolean, reason?: string) =>
      send(JSON.stringify({ type: "file-ack", id, ok, ...(reason ? { reason } : {}) })),
    [send],
  );
  const done = useCallback(
    (id: string) =>
      setIncoming((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== id))),
    [],
  );

  const receiver = useMemo(() => {
    const report = createKeyedThrottle(PROGRESS_REPORT_MS);
    return new FileReceiver({
      onFile: async (f) => {
        report.forget(f.id);
        done(f.id);
        const ok = await store.add(f);
        ack(f.id, ok, ok ? undefined : "The computer couldn't save the file (storage full or blocked).");
        if (!ok) return;
        onStored?.({ id: f.id, name: f.name, mime: f.mime });
        // Preview image for the list; made after the ack so it never delays the phone, and one
        // at a time because each PDF thumbnail starts a PDF.js worker and parses the whole file.
        void thumbQueue.run(async () => {
          const t = await makeThumbnail(f.blob, f.mime, f.name);
          if (t) await store.setThumb(f.id, t);
        });
      },
      onReject: (id, reason) => {
        report.forget(id);
        done(id);
        ack(id, false, reason);
      },
      onAbort: (id) => {
        report.forget(id);
        done(id);
      },
      onProgress: (id, got, total) => {
        setIncoming((p) => ({ ...p, [id]: Math.round((got / total) * 100) }));
        // Tell the phone how much has actually arrived (at most once a second per file), so
        // it can show real progress and judge stalls by lack of progress, not a clock. The
        // final chunk is covered by the ack.
        if (got < total && report.allow(id)) {
          send(JSON.stringify({ type: "file-progress", id, received: got }));
        }
      },
    });
  }, [store, ack, done, send, onStored, thumbQueue]);

  useEffect(() => {
    void store.init();
  }, [store]);

  // Leaving the page: drop in-flight transfers and their timers (no callbacks, nobody to tell).
  useEffect(() => () => receiver.dispose(), [receiver]);

  // Nothing in flight can finish once the other device is gone.
  useEffect(() => {
    if (!paired) receiver.abortAll();
  }, [paired, receiver]);

  /** Returns true if the frame was a file message (so other handlers can skip it). */
  const handleMessage = useCallback(
    (data: string | ArrayBuffer): boolean => {
      if (typeof data === "string") {
        const m = parseFileMessage(data);
        if (!m) return false;
        receiver.handleMessage(m);
        return true;
      }
      receiver.handleChunk(data);
      return true;
    },
    [receiver],
  );

  return {
    files,
    incoming,
    handleMessage,
    remove: useCallback((id: string) => void store.remove(id), [store]),
    clear: useCallback(() => void store.clear(), [store]),
  };
}
