"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ClipList } from "@/components/ClipList";
import { FileList } from "@/components/FileList";
import { useFileInbox } from "@/hooks/useFileInbox";
import { StatusBadge } from "@/components/StatusBadge";
import { useRoom } from "@/hooks/useRoom";
import { ClipStore } from "@/lib/clip-store";
import type { Clip } from "@/lib/clips-core";
import { clearClips, listClips, saveClip } from "@/lib/clips";
import { parsePeerMessage } from "@/lib/protocol";
import { buildJoinUrl, generateRoomId, loadRoomId, saveRoomId } from "@/lib/room";

/** Host (laptop): owns the room, shows the QR code, receives and stores text. */
export default function HostPage() {
  const [room, setRoom] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const sendRef = useRef<(d: string) => boolean>(() => false);
  // The inbox needs `send` from useRoom, which needs this handler: link them through a ref.
  const fileHandler = useRef<(d: string | ArrayBuffer) => boolean>(() => false);
  // All history changes go through one queue so quick bursts can't overwrite each other.
  const store = useMemo(
    () => new ClipStore({ load: listClips, save: saveClip, clear: clearClips, onChange: setClips }),
    [],
  );

  const onMessage = useCallback(
    (data: string | ArrayBuffer) => {
      if (fileHandler.current(data) || typeof data !== "string") return;
      const m = parsePeerMessage(data);
      if (m?.type !== "text") return;
      void store.receive(
        async () => {
          let copied = false;
          try {
            await navigator.clipboard.writeText(m.text); // needs a focused tab
            copied = true;
          } catch {
            // not allowed right now: it still lands in the list with a Copy button
          }
          // Stamped with our own clock: the phone's clock can't reorder or evict history.
          return { id: m.id, text: m.text, ts: Date.now(), copied };
        },
        (clip) => sendRef.current(JSON.stringify({ type: "ack", id: clip.id, copied: clip.copied })),
      );
    },
    [store],
  );

  const { status, paired, send } = useRoom(room, "host", onMessage);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const inbox = useFileInbox(send, paired);
  useEffect(() => {
    fileHandler.current = inbox.handleMessage;
  }, [inbox.handleMessage]);

  useEffect(() => {
    // localStorage / IndexedDB are only readable in the browser, after hydration.
    const id = loadRoomId() ?? generateRoomId();
    saveRoomId(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoom(id);
    void store.init();
  }, [store]);

  function newRoom() {
    const id = generateRoomId();
    saveRoomId(id);
    setRoom(id);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-semibold">Tunnel</h1>
      {!paired && (
        <>
          <p className="text-zinc-600 dark:text-zinc-400">
            Scan this code with your phone to pair it with this computer.
          </p>
          <div className="rounded-2xl bg-white p-4">
            {room ? (
              <QRCodeSVG value={buildJoinUrl(window.location.origin, room)} size={200} />
            ) : (
              <div className="h-[200px] w-[200px]" />
            )}
          </div>
        </>
      )}
      <StatusBadge status={status} paired={paired} />
      <ClipList clips={clips} onClear={() => void store.clear()} />
      <FileList files={inbox.files} incoming={inbox.incoming} onRemove={inbox.remove} onClear={inbox.clear} />
      <button onClick={newRoom} className="text-sm underline text-zinc-600 dark:text-zinc-400">
        Start a new pairing
      </button>
    </main>
  );
}
