"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { About } from "@/components/About";
import { ArrowDown, Mascot } from "@/components/art";
import { AlertsToggle } from "@/components/AlertsToggle";
import { ClipList } from "@/components/ClipList";
import { FileList } from "@/components/FileList";
import { FileViewer } from "@/components/FileViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { useFileInbox } from "@/hooks/useFileInbox";
import { useRoom } from "@/hooks/useRoom";
import { ClipStore } from "@/lib/clip-store";
import type { Clip } from "@/lib/clips-core";
import { clearClips, listClips, saveClip } from "@/lib/clips";
import { writeWithTimeout } from "@/lib/clipboard";
import { decryptEnvelope, generateSecret, parseEnvelope } from "@/lib/crypto";
import { titleFor } from "@/lib/pending-copy";
import { addSeen, hasSeen } from "@/lib/seen";
import { buildJoinUrl, loadSecret, markPaired, saveSecret, wasPaired } from "@/lib/room";
import { TextInbox } from "@/lib/text-inbox";
import { viewKind } from "@/lib/viewer-core";

/** Host (laptop): owns the pairing, shows the QR code, receives and stores text and files. */
export default function HostPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [everPaired, setEverPaired] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [waiting, setWaiting] = useState(0); // texts that arrived while this tab couldn't copy them
  const [storageProblem, setStorageProblem] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const sendRef = useRef<(d: string) => boolean>(() => false);
  const inboxRef = useRef<TextInbox | null>(null);
  // The file inbox needs `send` from useRoom, which needs this handler: link them through a ref.
  const fileHandler = useRef<(d: string | ArrayBuffer) => boolean>(() => false);
  // All history changes go through one queue so quick bursts can't overwrite each other.
  const store = useMemo(
    () => new ClipStore({ load: listClips, save: saveClip, clear: clearClips, onChange: setClips }),
    [],
  );

  // A page can only write the clipboard while its tab is focused. Text that arrived in the
  // background is copied the moment the user comes back (or clicks the desktop alert).
  const alertIfHidden = useCallback(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.hasFocus()) return;
    // Deliberately generic: the text itself never appears in a notification.
    const n = new Notification("Tunnel", { body: "New text from your phone. Click to copy.", tag: "tunnel-text" });
    n.onclick = () => {
      window.focus();
      void inboxRef.current?.copyPending();
      n.close();
    };
  }, []);

  // Built on first use (not during render) because it reads refs that useRoom's output fills in.
  const getInbox = useCallback((): TextInbox => {
    inboxRef.current ??= new TextInbox({
      decrypt: async (env) => (keyRef.current ? decryptEnvelope(keyRef.current, env) : null),
      hasSeen,
      addSeen,
      store,
      copy: (text) => writeWithTimeout(() => navigator.clipboard.writeText(text)),
      send: (frame) => void sendRef.current(frame),
      onPending: setWaiting,
      onArrivedUncopied: alertIfHidden,
      onUnsaved: () => setStorageProblem(true),
    });
    return inboxRef.current;
  }, [store, alertIfHidden]);

  const onMessage = useCallback(
    (data: string | ArrayBuffer) => {
      if (fileHandler.current(data) || typeof data !== "string") return;
      const env = parseEnvelope(data);
      // Without the key we can't read it, and must NOT acknowledge it: the relay keeps holding it.
      if (!env || !keyRef.current) return;
      void getInbox().handle(env);
    },
    [getInbox],
  );

  const { status, paired, send, key } = useRoom(secret, "host", onMessage);
  useEffect(() => {
    sendRef.current = send;
    keyRef.current = key;
  }, [send, key]);
  const [openId, setOpenId] = useState<string | null>(null);
  // A newly received image or PDF opens right away.
  const onStored = useCallback((f: { id: string; name: string; mime: string }) => {
    if (viewKind(f.mime, f.name) !== "none") setOpenId(f.id);
  }, []);
  const inbox = useFileInbox(send, paired, onStored);
  const openFile = inbox.files.find((f) => f.id === openId);
  useEffect(() => {
    fileHandler.current = inbox.handleMessage;
  }, [inbox.handleMessage]);

  useEffect(() => {
    // localStorage / IndexedDB are only readable in the browser, after hydration.
    const s = loadSecret() ?? generateSecret();
    saveSecret(s);
    /* eslint-disable react-hooks/set-state-in-effect */
    setSecret(s);
    setEverPaired(wasPaired(s));
    /* eslint-enable react-hooks/set-state-in-effect */
    void store.init();
  }, [store]);

  // Remember that pairing completed, so the QR code can stay hidden while the phone is just offline.
  useEffect(() => {
    if (paired && secret) {
      markPaired(secret);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEverPaired(true);
    }
  }, [paired, secret]);

  // Coming back to the tab: copy the newest text that arrived while it was in the background.
  useEffect(() => {
    const onFocus = () => void inboxRef.current?.copyPending();
    const onVisible = () => document.visibilityState === "visible" && void inboxRef.current?.copyPending();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    document.title = titleFor(waiting);
  }, [waiting]);

  function newPairing() {
    const s = generateSecret();
    saveSecret(s);
    inboxRef.current?.reset();
    setEverPaired(false);
    setShowQr(false);
    setSecret(s);
  }

  const qrVisible = !everPaired || showQr;

  return (
    <>
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 p-6 text-center">
      <Mascot className="bob h-24 w-28" />
      <h1 className="text-4xl font-semibold tracking-tight">Tunnel</h1>
      {qrVisible && (
        <>
          <p className="text-muted">
            Scan this code with your phone to pair it with this computer.
          </p>
          <div className="card bg-white p-4">
            {secret ? (
              <QRCodeSVG value={buildJoinUrl(window.location.origin, secret)} size={200} />
            ) : (
              <div className="h-[200px] w-[200px]" />
            )}
          </div>
        </>
      )}
      <StatusBadge status={status} paired={paired} wasPaired={everPaired} />
      {storageProblem && (
        <p role="alert" className="text-sm text-danger">
          This browser couldn&apos;t save the latest text (storage is blocked or full). It is shown below and still held for
          you, but keep this tab open until you have used it.
        </p>
      )}
      {everPaired && (
        <button
          onClick={() => setShowQr((v) => !v)}
          className="text-sm link"
        >
          {showQr ? "Hide pairing code" : "Show pairing code"}
        </button>
      )}
      <AlertsToggle />
      {openFile && <FileViewer file={openFile} onClose={() => setOpenId(null)} />}
      <ClipList
        clips={clips}
        onClear={() => void getInbox().clear()}
        onCopied={(c) => void inboxRef.current?.markCopied(c.id)}
      />
      <FileList
        files={inbox.files}
        incoming={inbox.incoming}
        openId={openFile?.id ?? null}
        onOpen={setOpenId}
        onRemove={inbox.remove}
        onClear={inbox.clear}
      />
      <button onClick={newPairing} className="text-sm link">
        Start a new pairing
      </button>
      <a href="#about" className="mt-2 flex flex-col items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        What is Tunnel?
        <ArrowDown className="bob h-6 w-6" />
      </a>
    </main>
    <About />
    </>
  );
}
