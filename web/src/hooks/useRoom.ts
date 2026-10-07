"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoomConnection, type Role, type Status } from "@/lib/connection";

const RELAY = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://localhost:8787";

/** Keeps a live connection to `room`; `paired` is true when another device is in it. */
export function useRoom(room: string | null, role: Role, onMessage?: (data: string | ArrayBuffer) => void) {
  const [status, setStatus] = useState<Status>("closed");
  const [peers, setPeers] = useState(0);
  const conn = useRef<RoomConnection | null>(null);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  });

  useEffect(() => {
    if (!room) return;
    const c = new RoomConnection({
      url: `${RELAY}/ws/${room}`,
      role,
      onStatus: setStatus,
      onPresence: setPeers,
      onMessage: (d) => handler.current?.(d),
    });
    conn.current = c;
    c.start();
    return () => {
      c.stop();
      conn.current = null;
    };
  }, [room, role]);

  const send = useCallback((data: string | Uint8Array) => conn.current?.send(data) ?? false, []);
  const buffered = useCallback(() => conn.current?.bufferedAmount() ?? 0, []);
  return { status, paired: status === "open" && peers >= 2, send, buffered };
}
