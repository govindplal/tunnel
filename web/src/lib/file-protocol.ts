// Wire format for file casting. Control messages are JSON text; file data travels as
// binary frames: [16-byte file id][4-byte big-endian chunk index][payload].
export const CHUNK_BYTES = 64 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_NAME_CHARS = 255;
const HEADER_BYTES = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FileMessage =
  | { type: "file-start"; id: string; name: string; mime: string; size: number; chunks: number }
  | { type: "file-ack"; id: string; ok: boolean; reason?: string }
  /** host -> phone: bytes received so far (throttled), so the phone can show real arrival progress */
  | { type: "file-progress"; id: string; received: number }
  | { type: "file-abort"; id: string };

export function chunkCount(size: number): number {
  return Math.ceil(size / CHUNK_BYTES);
}

/**
 * Names are shown as text and used for downloads: drop path separators, control chars and
 * bidi overrides (which can make "report‮gpj.exe" display as "reportexe.jpg").
 */
export function sanitizeName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩/\\]/g, "_").trim();
  return clean.slice(0, MAX_NAME_CHARS) || "file";
}

/** Sender side: shorten an over-long name but keep its extension, so it is never rejected. */
export function fitName(name: string): string {
  if (name.length <= MAX_NAME_CHARS) return name || "file";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
  return name.slice(0, MAX_NAME_CHARS - ext.length) + ext;
}

export function parseFileMessage(data: unknown): FileMessage | null {
  if (typeof data !== "string" || data.length > 2048 || !data.startsWith("{")) return null;
  try {
    const m = JSON.parse(data);
    if (!m || typeof m.id !== "string" || !UUID_RE.test(m.id)) return null;
    if (m.type === "file-start") {
      if (typeof m.name !== "string" || m.name.length === 0 || m.name.length > MAX_NAME_CHARS) return null;
      if (typeof m.mime !== "string" || m.mime.length > 127) return null;
      if (!Number.isInteger(m.size) || m.size < 1 || m.size > MAX_FILE_BYTES) return null;
      if (m.chunks !== chunkCount(m.size)) return null;
      return { type: "file-start", id: m.id.toLowerCase(), name: sanitizeName(m.name), mime: m.mime, size: m.size, chunks: m.chunks };
    }
    if (m.type === "file-ack" && typeof m.ok === "boolean") {
      const reason = typeof m.reason === "string" ? m.reason.slice(0, 200) : undefined;
      return { type: "file-ack", id: m.id.toLowerCase(), ok: m.ok, reason };
    }
    if (m.type === "file-progress" && Number.isInteger(m.received) && m.received >= 0 && m.received <= MAX_FILE_BYTES) {
      return { type: "file-progress", id: m.id.toLowerCase(), received: m.received };
    }
    if (m.type === "file-abort") return { type: "file-abort", id: m.id.toLowerCase() };
  } catch {
    // not a file message
  }
  return null;
}

export function idToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToId(b: Uint8Array): string {
  const hex = Array.from(b.subarray(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeChunk(id: string, seq: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + payload.length);
  out.set(idToBytes(id), 0);
  new DataView(out.buffer).setUint32(16, seq, false);
  out.set(payload, HEADER_BYTES);
  return out;
}

export function decodeChunk(buf: ArrayBuffer): { id: string; seq: number; payload: Uint8Array } | null {
  if (buf.byteLength <= HEADER_BYTES || buf.byteLength > HEADER_BYTES + CHUNK_BYTES) return null;
  const bytes = new Uint8Array(buf);
  return {
    id: bytesToId(bytes),
    seq: new DataView(buf).getUint32(16, false),
    payload: bytes.subarray(HEADER_BYTES),
  };
}
