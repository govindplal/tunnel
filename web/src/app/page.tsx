"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { StatusBadge } from "@/components/StatusBadge";
import { useRoom } from "@/hooks/useRoom";
import { buildJoinUrl, generateRoomId, loadRoomId, saveRoomId } from "@/lib/room";

/** Host (laptop): owns the room, shows the QR code the phone scans. */
export default function HostPage() {
  const [room, setRoom] = useState<string | null>(null);
  const { status, paired } = useRoom(room, "host");

  useEffect(() => {
    // localStorage is only readable in the browser, after hydration.
    const id = loadRoomId() ?? generateRoomId();
    saveRoomId(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoom(id);
  }, []);

  function newRoom() {
    const id = generateRoomId();
    saveRoomId(id);
    setRoom(id);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-semibold">Tunnel</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Scan this code with your phone to pair it with this computer.
      </p>
      <div className="rounded-2xl bg-white p-4">
        {room ? (
          <QRCodeSVG value={buildJoinUrl(window.location.origin, room)} size={224} />
        ) : (
          <div className="h-56 w-56" />
        )}
      </div>
      <StatusBadge status={status} paired={paired} />
      <button onClick={newRoom} className="text-sm underline text-zinc-600 dark:text-zinc-400">
        Start a new pairing
      </button>
    </main>
  );
}
