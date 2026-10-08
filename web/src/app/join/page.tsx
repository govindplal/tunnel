"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Tunnel } from "@/components/art";
import { StatusBadge } from "@/components/StatusBadge";
import { TransferList } from "@/components/TransferList";
import { useFileOutbox } from "@/hooks/useFileOutbox";
import { useRoom } from "@/hooks/useRoom";
import { encryptEnvelope } from "@/lib/crypto";
import { MAX_FRAME_CHARS, MAX_TEXT_CHARS, newMessageId, parsePeerMessage, type ServerMessage } from "@/lib/protocol";
import { loadSecret, parseSecretFromHash, saveSecret } from "@/lib/room";
import { reduceTexts, type SentText } from "@/lib/text-state";

const ACK_TIMEOUT_MS = 10_000;
const STATE_LABEL: Record<SentText["state"], string> = {
  sent: "sent…",
  queued: "waiting for the computer to open Tunnel (held, encrypted, for up to 30 minutes)",
  received: "received by the computer",
  copied: "copied on computer",
  stored: "received by the computer (not copied yet: it is in the list on the computer)",
  rejected: "not delivered: the computer couldn't accept it (its offline hold queue is full, or it couldn't be read)",
  unconfirmed: "no word yet: the computer may be reconnecting. If it was reachable the text is held for up to 30 minutes, so avoid sending it again",
};

/** Client (phone): joins from the QR link and sends text and files to the host. */
export default function JoinPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, dispatch] = useReducer(reduceTexts, [] as SentText[]);

  // The outbox needs `send` from useRoom, which needs this handler: link them through a ref.
  const fileHandler = useRef<(d: string | ArrayBuffer) => boolean>(() => false);
  const fileInput = useRef<HTMLInputElement>(null);

  const onMessage = useCallback((data: string | ArrayBuffer) => {
    if (fileHandler.current(data) || typeof data !== "string") return;
    const m = parsePeerMessage(data);
    if (m?.type === "ack") dispatch({ type: "acked", id: m.id, copied: m.copied });
  }, []);

  const onNotice = useCallback((m: Exclude<ServerMessage, { type: "presence" }>) => {
    dispatch({ type: m.type, id: m.id });
  }, []);

  const { status, paired, send, buffered, key } = useRoom(secret, "client", onMessage, onNotice);
  const outbox = useFileOutbox(send, buffered, paired);
  useEffect(() => {
    fileHandler.current = outbox.handleMessage;
  }, [outbox.handleMessage]);

  useEffect(() => {
    const fromUrl = parseSecretFromHash(window.location.hash);
    if (fromUrl) {
      // Drop the secret from the address bar only once it is safely stored; with
      // storage blocked, keeping the hash lets a reload still rejoin.
      if (saveSecret(fromUrl)) history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSecret(fromUrl ?? loadSecret());
    setChecked(true);
  }, []);

  // Text can be sent whenever the relay is reachable: if the computer isn't connected the relay
  // holds the (encrypted) message for it. Files need the computer online.
  const canSendText = status === "open" && key !== null;

  async function sendText(text: string): Promise<boolean> {
    if (!text.trim()) {
      setError("Nothing to send: the text is empty.");
      return false;
    }
    if (text.length > MAX_TEXT_CHARS) {
      setError(`Too long (${text.length.toLocaleString()} characters; max ${MAX_TEXT_CHARS.toLocaleString()}).`);
      return false;
    }
    if (!key) {
      setError("Still setting up. Try again in a moment.");
      return false;
    }
    const id = newMessageId();
    const payload = JSON.stringify({ type: "text", id, text, ts: Date.now() });
    if (payload.length > MAX_FRAME_CHARS) {
      setError("Too long once encoded (lots of special characters). Send it in smaller pieces.");
      return false;
    }
    const frame = await encryptEnvelope(key, id, payload);
    if (!send(frame)) {
      setError("Not connected yet. Try again in a moment.");
      return false;
    }
    setError(null);
    dispatch({ type: "add", id, preview: text.slice(0, 80) });
    setTimeout(() => dispatch({ type: "timeout", id }), ACK_TIMEOUT_MS);
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
    await sendText(text);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-5 p-6 text-center">
      <Tunnel className="h-20 w-28" />
      <h1 className="text-4xl font-semibold tracking-tight">Tunnel</h1>
      {!checked ? null : !secret ? (
        <p className="text-muted">No pairing found. Scan the QR code shown on your computer.</p>
      ) : (
        <>
          <StatusBadge status={status} paired={paired} wasPaired />
          {status === "open" && !paired && (
            <p className="text-xs text-muted">
              The computer isn&apos;t connected. Text you send is held (encrypted) for up to 30 minutes and delivered when
              it opens Tunnel. Files need the computer to be connected.
            </p>
          )}
          <button
            onClick={sendClipboard}
            disabled={!canSendText}
            className="btn btn-big"
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
            className="btn btn-big"
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
              className="w-full rounded-2xl border-2 border-line bg-paper p-3 text-sm placeholder:text-muted"
            />
            <button
              onClick={async () => (await sendText(draft)) && setDraft("")}
              disabled={!canSendText || !draft}
              className="btn self-end"
            >
              Send text
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {sent.length > 0 && (
            <ul className="w-full text-left text-sm">
              {sent.map((s) => (
                <li key={s.id} className="border-t border-line py-2">
                  <div className="truncate">{s.preview}</div>
                  <div className="text-xs text-muted">{STATE_LABEL[s.state]}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
