import type { ClipStore } from "./clip-store.ts";
import type { Clip } from "./clips-core.ts";
import type { Envelope } from "./crypto.ts";
import { pickClipToCopy } from "./pending-copy.ts";
import { parsePeerMessage } from "./protocol.ts";
import { SerialQueue } from "./serial-queue.ts";

export interface TextInboxDeps {
  /** The plaintext, or null if the envelope can't be read (wrong key, tampered, malformed). */
  decrypt: (env: Envelope) => Promise<string | null>;
  hasSeen: (id: string) => Promise<boolean>;
  /** Resolves true only if the id was durably remembered. */
  addSeen: (id: string) => Promise<boolean>;
  store: Pick<ClipStore, "items" | "receive" | "update" | "clear">;
  /** Writes the system clipboard; false if the browser refused (e.g. the tab isn't focused). */
  copy: (text: string) => Promise<boolean>;
  /** Sends a frame to the relay. */
  send: (frame: string) => void;
  now?: () => number;
  /** How many texts are waiting for the tab to regain focus. */
  onPending?: (count: number) => void;
  /** A new text arrived that couldn't be copied right now (e.g. raise a desktop alert). */
  onArrivedUncopied?: () => void;
  /** Storage failed: the text is shown but NOT acknowledged, so the relay keeps holding it. */
  onUnsaved?: () => void;
}

/**
 * The host's handling of incoming text. Everything runs one job at a time in arrival order, so the
 * newest text really is the last one copied, and the pending set can't race with arrivals.
 *
 * Rules it enforces:
 *  - a message is acknowledged to the relay (which then forgets it) only once it is durably stored
 *    AND its id is durably remembered;
 *  - an id seen before (even if the history was cleared since) never touches the clipboard again;
 *  - anything unreadable is dropped explicitly, so it isn't redelivered until it expires;
 *  - only text that arrived uncopied THIS session can later be auto-copied.
 */
export class TextInbox {
  private readonly q = new SerialQueue();
  private readonly pending = new Set<string>();
  private readonly deps: TextInboxDeps;

  constructor(deps: TextInboxDeps) {
    this.deps = deps;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Handles one incoming envelope. Resolves when it has been fully processed. */
  handle(env: Envelope): Promise<void> {
    return this.q.run(() => this.process(env));
  }

  /** Copies the newest text that arrived while the tab couldn't copy it (call when focus returns). */
  copyPending(): Promise<void> {
    return this.q.run(async () => {
      const { store, copy, send } = this.deps;
      const c = pickClipToCopy(store.items, this.pending);
      if (!c) return;
      if (!(await copy(c.text))) return; // still not allowed: stays pending
      this.pending.clear(); // older waiting texts are superseded by the newest one
      this.deps.onPending?.(0);
      if (await store.update(c.id, { copied: true })) {
        send(JSON.stringify({ type: "ack", id: c.id, copied: true }));
      }
    });
  }

  /** The user copied a clip by hand: it is no longer waiting. Only a waiting one is reported to the phone. */
  markCopied(id: string): Promise<void> {
    return this.q.run(async () => {
      const had = this.pending.delete(id);
      if (had) this.deps.onPending?.(this.pending.size);
      const applied = await this.deps.store.update(id, { copied: true });
      if (had && applied) this.deps.send(JSON.stringify({ type: "ack", id, copied: true }));
    });
  }

  /**
   * Clears the history IN TURN with copies and arrivals, so a Clear can't slip in between "pick the
   * text to copy" and "write the clipboard", and nothing cleared can be copied afterwards.
   */
  clear(): Promise<void> {
    return this.q.run(async () => {
      this.pending.clear();
      this.deps.onPending?.(0);
      await this.deps.store.clear();
    });
  }

  /** Forget what is waiting (a new pairing started). */
  reset(): void {
    this.pending.clear();
    this.deps.onPending?.(0);
  }

  private async process(env: Envelope): Promise<void> {
    const { decrypt, hasSeen, addSeen, store, copy, send } = this.deps;
    const plain = await decrypt(env);
    const m = plain ? parsePeerMessage(plain) : null;
    if (!m || m.type !== "text" || m.id !== env.id) {
      send(JSON.stringify({ type: "qack", id: env.id, drop: true }));
      return;
    }
    if (await hasSeen(m.id)) {
      // Handled before (a lost acknowledgement, or a replay): just let the relay forget it.
      send(JSON.stringify({ type: "qack", id: m.id }));
      return;
    }

    let durable = true;
    let clip: Clip | null = null;
    await store.receive(
      async () => {
        const existing = store.items.find((c) => c.id === m.id);
        if (existing) {
          // Still in memory from an attempt that wasn't acknowledged: never copy it a second time.
          return existing;
        }
        const copied = await copy(m.text); // needs a focused tab
        // Stamped with our own clock: the phone's clock can't reorder or evict history.
        return { id: m.id, text: m.text, ts: (this.deps.now ?? Date.now)(), copied };
      },
      (c, d) => {
        clip = c;
        durable = d;
      },
    );
    if (!clip) return;
    const stored: Clip = clip;

    // Only now may the relay forget it. If either write failed, leave it held: it is shown here,
    // and will be redelivered (and found in memory) rather than lost with the tab.
    if (!durable || !(await addSeen(m.id))) {
      this.deps.onUnsaved?.();
      return;
    }
    send(JSON.stringify({ type: "qack", id: m.id }));
    send(JSON.stringify({ type: "ack", id: m.id, copied: stored.copied }));
    // Waiting for the tab to be focused: anything shown uncopied that reached us THIS session, even a
    // redelivery of a clip we stored earlier but couldn't acknowledge. Alert once per text.
    if (!stored.copied && !this.pending.has(m.id)) {
      this.pending.add(m.id);
      this.deps.onPending?.(this.pending.size);
      this.deps.onArrivedUncopied?.();
    }
  }
}
