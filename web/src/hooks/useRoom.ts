"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoomConnection, type Role, type Status } from "@/lib/connection";
import { deriveRoomKeys, type RoomKeys } from "@/lib/crypto";
import type { ServerMessage } from "@/lib/protocol";

const RELAY = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://localhost:8787";

type Notice = Exclude<ServerMessage, { type: "presence" }>;

/**
 * Keeps a live connection to the room for `secret`. `paired` is true when the other device is
 * connected right now; `key` encrypts/decrypts messages (null until derived).
 */
export function useRoom(
  secret: string | null,
  role: Role,
  onMessage?: (data: string | ArrayBuffer) => void,
  onNotice?: (m: Notice) => void,
) {
  const [status, setStatus] = useState<Status>("closed");
  const [peers, setPeers] = useState(0);
  const [derived, setDerived] = useState<{ secret: string; keys: RoomKeys } | null>(null);
  const conn = useRef<RoomConnection | null>(null);
  const handler = useRef(onMessage);
  const noticeHandler = useRef(onNotice);
  useEffect(() => {
    handler.current = onMessage;
    noticeHandler.current = onNotice;
  });

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    let c: RoomConnection | null = null;
    deriveRoomKeys(secret).then(
      (keys) => {
        if (cancelled) return;
        setDerived({ secret, keys });
        c = new RoomConnection({
          url: `${RELAY}/ws/${keys.room}`,
          role,
          token: keys.token,
          onStatus: setStatus,
          onPresence: setPeers,
          onMessage: (d) => handler.current?.(d),
          onNotice: (m) => noticeHandler.current?.(m),
        });
        conn.current = c;
        c.start();
      },
      () => {
        /* an invalid secret never connects */
      },
    );
    return () => {
      cancelled = true;
      c?.stop();
      conn.current = null;
    };
  }, [secret, role]);

  const send = useCallback((data: string | Uint8Array) => conn.current?.send(data) ?? false, []);
  const buffered = useCallback(() => conn.current?.bufferedAmount() ?? 0, []);
  const key = derived && derived.secret === secret ? derived.keys.key : null;
  return { status, paired: status === "open" && peers >= 2, send, buffered, key };
}
