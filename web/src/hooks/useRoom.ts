"use client";
import { useEffect, useState } from "react";
import { RoomConnection, type Role, type Status } from "@/lib/connection";

const RELAY = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://localhost:8787";

/** Keeps a live connection to `room`; `paired` is true when another device is in it. */
export function useRoom(room: string | null, role: Role): { status: Status; paired: boolean } {
  const [status, setStatus] = useState<Status>("closed");
  const [peers, setPeers] = useState(0);

  useEffect(() => {
    if (!room) return;
    const conn = new RoomConnection({
      url: `${RELAY}/ws/${room}`,
      role,
      onStatus: setStatus,
      onPresence: setPeers,
    });
    conn.start();
    return () => conn.stop();
  }, [room, role]);

  return { status, paired: status === "open" && peers >= 2 };
}
