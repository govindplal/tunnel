"use client";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { useRoom } from "@/hooks/useRoom";
import { loadRoomId, parseRoomFromHash, saveRoomId } from "@/lib/room";

/** Client (phone): joins the room from the QR link, or resumes the saved one. */
export default function JoinPage() {
  const [room, setRoom] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const { status, paired } = useRoom(room, "client");

  useEffect(() => {
    const fromUrl = parseRoomFromHash(window.location.hash);
    if (fromUrl) {
      // Drop the secret from the address bar only once it is safely stored; with
      // storage blocked, keeping the hash lets a reload still rejoin.
      if (saveRoomId(fromUrl)) history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoom(fromUrl ?? loadRoomId());
    setChecked(true);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-semibold">Tunnel</h1>
      {!checked ? null : room ? (
        <StatusBadge status={status} paired={paired} />
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          No pairing found. Scan the QR code shown on your computer.
        </p>
      )}
    </main>
  );
}
