import {
  CHUNK_BYTES, MAX_FILE_BYTES, chunkCount, decodeChunk, encodeChunk, fitName, type FileMessage,
} from "./file-protocol.ts";

export interface SendableFile {
  name: string;
  type: string;
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface SendOptions {
  id: string;
  file: SendableFile;
  /** false means the socket is not open */
  send: (data: string | Uint8Array) => boolean;
  /** bytes queued in the socket but not yet on the wire */
  buffered: () => number;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  highWater?: number;
  stallMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Streams a file as chunks with backpressure. Throws a user-readable Error on failure. */
export async function sendFile(o: SendOptions): Promise<void> {
  const { file, id } = o;
  const sleep = o.sleep ?? defaultSleep;
  const highWater = o.highWater ?? 1024 * 1024;
  const stallMs = o.stallMs ?? 30_000;
  if (file.size < 1) throw new Error("That file is empty.");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Too large (${(file.size / 1048576).toFixed(1)} MB; max ${MAX_FILE_BYTES / 1048576} MB).`);
  }
  const chunks = chunkCount(file.size);
  const start: FileMessage = { type: "file-start", id, name: fitName(file.name), mime: file.type, size: file.size, chunks };
  if (!o.send(JSON.stringify(start))) throw new Error("Not connected.");

  const abort = () => {
    o.send(JSON.stringify({ type: "file-abort", id }));
    return new Error("Cancelled.");
  };
  // Waits until the socket has at most `limit` bytes queued. Gives up only if the queue
  // stops shrinking for stallMs (a dead link), so a slow-but-moving link is never aborted.
  const drain = async (limit: number) => {
    let last = o.buffered();
    let waited = 0;
    while (o.buffered() > limit) {
      if (o.signal?.aborted) throw abort();
      const now = o.buffered();
      if (now < last) {
        waited = 0;
        last = now;
      }
      if (waited >= stallMs) throw abort();
      await sleep(25);
      waited += 25;
    }
  };

  for (let seq = 0; seq < chunks; seq++) {
    await drain(highWater);
    if (o.signal?.aborted) throw abort();
    const from = seq * CHUNK_BYTES;
    const to = Math.min(file.size, from + CHUNK_BYTES);
    const payload = new Uint8Array(await file.slice(from, to).arrayBuffer());
    if (!o.send(encodeChunk(id, seq, payload))) throw new Error("Connection lost.");
    // Progress counts bytes that have left this device, not bytes merely queued.
    o.onProgress?.(Math.max(0, to - o.buffered()), file.size);
  }
  // Resolve only once everything is on the wire, so "waiting for the computer" is honest.
  await drain(0);
  o.onProgress?.(file.size, file.size);
}

export interface ReceivedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
}

export interface ReceiverOptions {
  onFile: (f: ReceivedFile) => void;
  /** The transfer was refused or died; the sender should be told. */
  onReject: (id: string, reason: string) => void;
  onProgress?: (id: string, receivedBytes: number, totalBytes: number) => void;
  /** The sender cancelled an in-flight transfer. */
  onAbort?: (id: string) => void;
  idleMs?: number;
  maxConcurrent?: number;
}

interface Incoming {
  meta: Extract<FileMessage, { type: "file-start" }>;
  parts: (Uint8Array | undefined)[];
  got: number;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Reassembles chunked files. Tolerates duplicate chunks; rejects malformed ones. */
export class FileReceiver {
  private active = new Map<string, Incoming>();
  private readonly opts: ReceiverOptions;
  private readonly idleMs: number;
  private readonly maxConcurrent: number;

  constructor(opts: ReceiverOptions) {
    this.opts = opts;
    // Delivery through the relay stalls for 20+ s at times on real networks; don't give up early.
    this.idleMs = opts.idleMs ?? 60_000;
    this.maxConcurrent = opts.maxConcurrent ?? 2;
  }

  handleMessage(m: FileMessage): void {
    if (m.type === "file-start") {
      if (this.active.has(m.id)) return; // repeated start: keep the transfer already running
      if (this.active.size >= this.maxConcurrent) {
        this.opts.onReject(m.id, "The computer is busy receiving other files. Try again in a moment.");
        return;
      }
      this.active.set(m.id, {
        meta: m,
        parts: new Array(m.chunks),
        got: 0,
        bytes: 0,
        timer: this.arm(m.id),
      });
    } else if (m.type === "file-abort") {
      if (!this.active.has(m.id)) return;
      this.drop(m.id);
      this.opts.onAbort?.(m.id);
    }
  }

  handleChunk(buf: ArrayBuffer): void {
    const c = decodeChunk(buf);
    if (!c) return;
    const t = this.active.get(c.id);
    if (!t) return; // unknown or already finished/dropped
    const { chunks, size } = t.meta;
    const expected = c.seq === chunks - 1 ? size - CHUNK_BYTES * (chunks - 1) : CHUNK_BYTES;
    if (c.seq >= chunks || c.payload.length !== expected) {
      this.fail(c.id, "Received a corrupted chunk.");
      return;
    }
    clearTimeout(t.timer);
    t.timer = this.arm(c.id);
    if (!t.parts[c.seq]) {
      t.parts[c.seq] = c.payload.slice(); // copy: the frame buffer is not ours to keep
      t.got++;
      t.bytes += c.payload.length;
      this.opts.onProgress?.(c.id, t.bytes, size);
    }
    if (t.got === chunks) {
      this.drop(c.id);
      this.opts.onFile({
        id: c.id,
        name: t.meta.name,
        mime: t.meta.mime,
        size,
        blob: new Blob(t.parts as BlobPart[], { type: t.meta.mime }),
      });
    }
  }

  /** Component unmounted: stop all timers and forget in-flight transfers, without callbacks. */
  dispose(): void {
    for (const id of [...this.active.keys()]) this.drop(id);
  }

  /** Connection dropped: nothing in flight can finish. */
  abortAll(reason = "Connection lost."): void {
    for (const id of [...this.active.keys()]) this.fail(id, reason);
  }

  get inFlight(): number {
    return this.active.size;
  }

  private arm(id: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => this.fail(id, "Transfer timed out."), this.idleMs);
  }

  private drop(id: string): void {
    const t = this.active.get(id);
    if (t) clearTimeout(t.timer);
    this.active.delete(id);
  }

  private fail(id: string, reason: string): void {
    if (!this.active.has(id)) return;
    this.drop(id);
    this.opts.onReject(id, reason);
  }
}
