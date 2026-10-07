"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { parseFileMessage } from "@/lib/file-protocol";
import { sendFile } from "@/lib/file-transfer";
import { SerialQueue } from "@/lib/serial-queue";
import { reduceTransfers, type Transfer } from "@/lib/transfer-state";

export type { Transfer };
type Send = (data: string | Uint8Array) => boolean;

// How long to wait with no sign of life from the computer (progress or ack) before failing.
const STALL_TIMEOUT_MS = 30_000;

/**
 * Client (phone) side of file casting. Files are sent strictly one at a time (queued),
 * and every transition goes through `reduceTransfers` so late events can't corrupt state.
 */
export function useFileOutbox(send: Send, buffered: () => number, paired: boolean) {
  const [transfers, dispatch] = useReducer(reduceTransfers, [] as Transfer[]);
  const controllers = useRef(new Map<string, AbortController>());
  const ackTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queue = useMemo(() => new SerialQueue(), []);

  const armStallTimer = useCallback((id: string) => {
    const old = ackTimers.current.get(id);
    if (old) clearTimeout(old);
    ackTimers.current.set(
      id,
      setTimeout(() => dispatch({ type: "ackTimeout", id }), STALL_TIMEOUT_MS),
    );
  }, []);

  const sendFiles = useCallback(
    (files: File[]) => {
      const batch = files.map((file) => {
        const id = crypto.randomUUID();
        const ctl = new AbortController();
        controllers.current.set(id, ctl);
        dispatch({ type: "add", id, name: file.name, size: file.size });
        return { id, file, ctl };
      });
      return queue.run(async () => {
        for (const { id, file, ctl } of batch) {
          if (ctl.signal.aborted) {
            controllers.current.delete(id);
            continue; // cancelled or connection lost while waiting its turn
          }
          dispatch({ type: "start", id });
          try {
            await sendFile({
              id,
              file,
              send,
              buffered,
              signal: ctl.signal,
              onProgress: (s, t) => dispatch({ type: "progress", id, pct: Math.round((s / t) * 100) }),
            });
            dispatch({ type: "sent", id });
            armStallTimer(id);
          } catch (e) {
            dispatch({ type: "fail", id, error: e instanceof Error ? e.message : "Failed." });
          } finally {
            controllers.current.delete(id);
          }
        }
      });
    },
    [send, buffered, queue, armStallTimer],
  );

  const cancel = useCallback((id: string) => {
    dispatch({ type: "cancel", id });
    controllers.current.get(id)?.abort();
  }, []);

  // If the link drops, whatever is queued or mid-send can't finish: stop now instead of
  // streaming into a dead socket and finding out 15 seconds later.
  useEffect(() => {
    if (paired) return;
    for (const c of controllers.current.values()) c.abort();
    dispatch({ type: "connectionLost" });
  }, [paired]);

  // Leaving the page: stop sending and clear timers.
  useEffect(() => {
    const ctls = controllers.current;
    const timers = ackTimers.current;
    return () => {
      for (const c of ctls.values()) c.abort();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  /** Handles the computer's file-ack. Returns true if the frame was a file message. */
  const handleMessage = useCallback((data: string | ArrayBuffer): boolean => {
    const m = typeof data === "string" ? parseFileMessage(data) : null;
    if (!m) return false;
    if (m.type === "file-progress") {
      dispatch({ type: "arrived", id: m.id, received: m.received });
      if (ackTimers.current.has(m.id)) armStallTimer(m.id); // alive: restart the stall clock
    } else if (m.type === "file-ack") {
      const t = ackTimers.current.get(m.id);
      if (t) {
        clearTimeout(t);
        ackTimers.current.delete(m.id);
      }
      dispatch({ type: "ack", id: m.id, ok: m.ok, reason: m.reason });
      if (!m.ok) controllers.current.get(m.id)?.abort(); // stop sending what nobody wants
    }
    return true;
  }, [armStallTimer]);

  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);

  return { transfers, sendFiles, cancel, handleMessage, dismiss };
}
