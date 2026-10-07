// Messages the relay itself sends (as JSON text). Peer payloads use other shapes.
export type ServerMessage = { type: "presence"; count: number };

export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string" || data === "pong") return null;
  try {
    const m = JSON.parse(data);
    if (m && m.type === "presence" && Number.isInteger(m.count) && m.count >= 0) {
      return { type: "presence", count: m.count };
    }
  } catch {
    // not JSON: a peer payload, not a server message
  }
  return null;
}

// Messages exchanged between the two devices (the relay forwards them untouched).
export const MAX_TEXT_CHARS = 100_000;
// Worst-case JSON expansion is 6 chars per char (control chars escape to 6), plus the envelope.
export const MAX_FRAME_CHARS = MAX_TEXT_CHARS * 6 + 200;

export type PeerMessage =
  | { type: "text"; id: string; text: string; ts: number }
  | { type: "ack"; id: string; copied: boolean };

export function parsePeerMessage(data: unknown): PeerMessage | null {
  if (typeof data !== "string" || data.length > MAX_FRAME_CHARS || !data.startsWith("{")) return null;
  try {
    const m = JSON.parse(data);
    if (!m || typeof m.id !== "string" || m.id.length === 0 || m.id.length > 64) return null;
    if (m.type === "text" && typeof m.text === "string" && m.text.length <= MAX_TEXT_CHARS) {
      return { type: "text", id: m.id, text: m.text, ts: Number.isFinite(m.ts) ? m.ts : Date.now() };
    }
    if (m.type === "ack" && typeof m.copied === "boolean") {
      return { type: "ack", id: m.id, copied: m.copied };
    }
  } catch {
    // not a peer message
  }
  return null;
}

export function newMessageId(): string {
  return crypto.randomUUID();
}
