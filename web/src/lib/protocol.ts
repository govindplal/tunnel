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
