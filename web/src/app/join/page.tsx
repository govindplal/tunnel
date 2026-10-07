"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { TransferList } from "@/components/TransferList";
import { useFileOutbox } from "@/hooks/useFileOutbox";
import { useRoom } from "@/hooks/useRoom";
import { MAX_FRAME_CHARS, MAX_TEXT_CHARS, newMessageId, parsePeerMessage } from "@/lib/protocol";
import { loadRoomId, parseRoomFromHash, saveRoomId } from "@/lib/room";

type Sent = { id: string; preview: string; state: "sent" | "copied" | "stored" | "unconfirmed" };
const MAX_SENT = 5;
const ACK_TIMEOUT_MS = 10_000;
const STATE_LABEL = {
  sent: "sent…",
  copied: "copied on computer",
  stored: "received (tap Copy on computer)",
  unconfirmed: "not confirmed: check the computer, or send again",
};

/** Client (phone): joins the room from the QR link and sends text to the host. */
export default function JoinPage() {
  const [room, setRoom] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);

  // The outbox needs `send` from useRoom, which needs this handler: link them through a ref.
  const fileHandler = useRef<(d: string | ArrayBuffer) => boolean>(() => false);
  const fileInput = useRef<HTMLInputElement>(null);

  const onMessage = useCallback((data: string | ArrayBuffer) => {
    if (fileHandler.current(data) || typeof data !== "string") return;
    const m = parsePeerMessage(data);
    if (m?.type !== "ack") return;
    setSent((list) =>
      list.map((s) => (s.id === m.id ? { ...s, state: m.copied ? "copied" : "stored" } : s)),
    );
  }, []);

  const { status, paired, send, buffered } = useRoom(room, "client", onMessage);
  const outbox = useFileOutbox(send, buffered, paired);
  useEffect(() => {
    fileHandler.current = outbox.handleMessage;
  }, [outbox.handleMessage]);

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

  function sendText(text: string): boolean {
    if (!text.trim()) {
      setError("Nothing to send: the text is empty.");
      return false;
    }
    if (text.length > MAX_TEXT_CHARS) {
      setError(`Too long (${text.length.toLocaleString()} characters; max ${MAX_TEXT_CHARS.toLocaleString()}).`);
      return false;
    }
    const id = newMessageId();
    const frame = JSON.stringify({ type: "text", id, text, ts: Date.now() });
    if (frame.length > MAX_FRAME_CHARS) {
      setError("Too long once encoded (lots of special characters). Send it in smaller pieces.");
      return false;
    }
    if (!send(frame)) {
      setError('Not connected yet. Wait for "Paired" and try again.');
      return false;
    }
    setError(null);
    setSent((list) => [{ id, preview: text.slice(0, 80), state: "sent" as const }, ...list].slice(0, MAX_SENT));
    setTimeout(
      () =>
        setSent((list) =>
          list.map((s) => (s.id === id && s.state === "sent" ? { ...s, state: "unconfirmed" as const } : s)),
        ),
      ACK_TIMEOUT_MS,
    );
    return true;
  }

  async function sendClipboard() {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setError("Couldn't read the clipboard (permission denied or unsupported). Paste into the box below and press Send.");
      return;
    }
    sendText(text);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-5 p-6 text-center">
      <h1 className="text-2xl font-semibold">Tunnel</h1>
      {!checked ? null : !room ? (
        <p className="text-zinc-600 dark:text-zinc-400">No pairing found. Scan the QR code shown on your computer.</p>
      ) : (
        <>
          <StatusBadge status={status} paired={paired} />
          <button
            onClick={sendClipboard}
            disabled={!paired}
            className="rounded-lg border border-zinc-400 px-4 py-2 disabled:opacity-40 dark:border-zinc-600"
          >
            Send clipboard
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = ""; // lets the same file be picked again
              if (picked.length) void outbox.sendFiles(picked);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={!paired}
            className="rounded-lg border border-zinc-400 px-4 py-2 disabled:opacity-40 dark:border-zinc-600"
          >
            Send file
          </button>
          <TransferList transfers={outbox.transfers} onCancel={outbox.cancel} onDismiss={outbox.dismiss} />
          <div className="flex w-full flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Or type / paste text here"
              rows={4}
              className="w-full rounded-lg border border-zinc-300 bg-transparent p-3 text-sm dark:border-zinc-700"
            />
            <button
              onClick={() => sendText(draft) && setDraft("")}
              disabled={!paired || !draft}
              className="self-end rounded-lg border border-zinc-400 px-4 py-2 text-sm disabled:opacity-40 dark:border-zinc-600"
            >
              Send text
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {sent.length > 0 && (
            <ul className="w-full text-left text-sm">
              {sent.map((s) => (
                <li key={s.id} className="border-t border-zinc-200 py-2 dark:border-zinc-800">
                  <div className="truncate">{s.preview}</div>
                  <div className="text-xs text-zinc-500">{STATE_LABEL[s.state]}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
