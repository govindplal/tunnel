import { parseServerMessage } from "./protocol.ts";

export type Status = "connecting" | "open" | "reconnecting" | "closed";

export interface SocketLike {
  send(data: string | Uint8Array): void;
  close(): void;
  binaryType?: string;
  /** bytes queued but not yet transmitted */
  bufferedAmount?: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
}

export type Role = "host" | "client";

export interface ConnectionOptions {
  url: string;
  /** Announced to the relay on every (re)connect so presence counts distinct roles. */
  role: Role;
  onStatus: (s: Status) => void;
  /** Number of sockets in the room, including this one. */
  onPresence: (count: number) => void;
  /** Any non-server text frame from the other device. */
  onMessage?: (data: string | ArrayBuffer) => void;
  socketFactory?: (url: string) => SocketLike;
  pingMs?: number;
  maxBackoffMs?: number;
  /** 0..1, for backoff jitter (injectable for tests). */
  random?: () => number;
  /** Subscribes to "tab visible / network back" events; returns an unsubscribe. */
  onResume?: (cb: () => void) => () => void;
}

function browserResume(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const onVisible = () => document.visibilityState === "visible" && cb();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", cb);
  window.addEventListener("pageshow", cb);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", cb);
    window.removeEventListener("pageshow", cb);
  };
}

/** WebSocket to one room with auto-reconnect (backoff), heartbeat and dead-link detection. */
export class RoomConnection {
  private ws: SocketLike | null = null;
  private status: Status = "closed";
  private stopped = true;
  private attempts = 0;
  private lastSeen = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private unsubResume: (() => void) | null = null;
  private readonly opts: ConnectionOptions;
  private readonly pingMs: number;
  private readonly maxBackoffMs: number;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
    this.pingMs = opts.pingMs ?? 25_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 15_000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    this.unsubResume = (this.opts.onResume ?? browserResume)(() => this.resume());
    this.connect();
  }

  /** Sends a text frame; false if the socket isn't open. */
  send(data: string | Uint8Array): boolean {
    if (!this.ws || this.status !== "open") return false;
    try {
      this.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Bytes queued in the socket but not yet on the wire (for backpressure). */
  bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** Timers freeze in suspended tabs, so on resume verify the link instead of waiting for them. */
  private resume(): void {
    if (this.stopped) return;
    const stale = Date.now() - this.lastSeen > this.pingMs;
    if (this.ws && this.status === "open" && !stale) return;
    this.reconnectNow();
  }

  private reconnectNow(): void {
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = old.onmessage = old.onerror = old.onopen = null;
      try { old.close(); } catch { /* already closed */ }
    }
    this.clearTimers();
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.unsubResume?.();
    this.unsubResume = null;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      ws.close();
    }
    this.opts.onPresence(0);
    this.setStatus("closed");
  }

  private setStatus(s: Status): void {
    this.status = s;
    this.opts.onStatus(s);
  }

  private connect(): void {
    this.setStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    const make =
      this.opts.socketFactory ??
      ((u: string) => {
        const s = new WebSocket(u);
        s.binaryType = "arraybuffer"; // file chunks arrive as ArrayBuffer, not Blob
        return s as unknown as SocketLike;
      });
    let ws: SocketLike;
    try {
      ws = make(this.opts.url);
    } catch {
      // e.g. ws:// from an https page, or a malformed URL: retry like any other failure
      this.ws = null;
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.lastSeen = Date.now();
      this.setStatus("open");
      ws.send(JSON.stringify({ type: "hello", role: this.opts.role }));
      this.beat = setInterval(() => {
        if (Date.now() - this.lastSeen > this.pingMs * 2) {
          ws.close(); // no pong for two intervals: link is dead; its close event may never come
          lost();
          return;
        }
        ws.send("ping");
      }, this.pingMs);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      const m = parseServerMessage(e.data);
      if (m?.type === "presence") this.opts.onPresence(m.count);
      else if (!m && e.data !== "pong" && (typeof e.data === "string" || e.data instanceof ArrayBuffer)) {
        this.opts.onMessage?.(e.data);
      }
    };
    const lost = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.opts.onPresence(0);
      this.scheduleRetry();
    };
    ws.onclose = lost;
    ws.onerror = lost;
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const base = Math.min(this.maxBackoffMs, 500 * 2 ** this.attempts++);
    const jitter = 0.75 + 0.5 * (this.opts.random ?? Math.random)(); // +-25%
    this.setStatus("reconnecting");
    this.retry = setTimeout(() => this.connect(), Math.round(base * jitter));
  }

  private clearTimers(): void {
    if (this.retry) clearTimeout(this.retry);
    if (this.beat) clearInterval(this.beat);
    this.retry = this.beat = null;
  }
}
