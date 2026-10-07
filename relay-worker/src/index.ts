// Stateless relay: one Durable Object per room forwards WebSocket frames
// between its sockets. Nothing is persisted or logged.

export interface Env {
  ROOM: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  MAX_MESSAGE_BYTES: string;
}

// ALLOWED_ORIGINS entries may contain `*`, which matches any characters except `/` or `.`
// (so one hostname label), e.g. https://tunnel-*-team.vercel.app.
function matchOrigin(pattern: string, origin: string): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === origin;
  if (!origin.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const lit = parts[i];
    // the wildcard consumes up to the next occurrence of `lit` (or to the end for the last part)
    const idx = last ? origin.length - lit.length : origin.indexOf(lit, pos);
    if (idx < pos || (last && !origin.endsWith(lit))) return false;
    if (/[/.]/.test(origin.slice(pos, idx))) return false;
    pos = idx + lit.length;
  }
  return pos === origin.length;
}

function originAllowed(origin: string, list: string): boolean {
  return list.split(",").some((p) => p.trim() !== "" && matchOrigin(p.trim(), origin));
}

const ROOM_RE = /^[A-Za-z0-9_-]{22,64}$/; // >=128-bit base64url IDs

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });

    const m = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!m || !ROOM_RE.test(m[1])) return new Response("Not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const origin = req.headers.get("Origin");
    if (origin && !originAllowed(origin, env.ALLOWED_ORIGINS)) {
      return new Response("Forbidden", { status: 403 });
    }

    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};

type Role = "host" | "client";
const ROLES: Role[] = ["host", "client"];
// Frame types only the relay may originate; clients can't forge them.
const RESERVED = new Set(["presence", "hello"]);

function frameType(msg: string | ArrayBuffer): string | null {
  if (typeof msg !== "string" || msg.length > 256 || !msg.startsWith("{")) return null;
  try {
    const t = JSON.parse(msg)?.type;
    return typeof t === "string" ? t : null;
  } catch {
    return null;
  }
}

export class Room implements DurableObject {
  constructor(private ctx: DurableObjectState, private env: Env) {
    // Answered without waking the object: keeps proxies from idling the socket out.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(_req: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Presence = number of distinct roles (host/client) present, so ghost sockets
  // from a dropped link or a second tab of the same role never read as a peer.
  private broadcastPresence(closing?: WebSocket): void {
    const sockets = this.ctx.getWebSockets().filter((s) => s !== closing);
    const roles = new Set<Role>();
    for (const s of sockets) {
      const r = (s.deserializeAttachment() as { role?: Role } | null)?.role;
      if (r) roles.add(r);
    }
    const msg = JSON.stringify({ type: "presence", count: roles.size });
    for (const s of sockets) this.safeSend(s, msg);
  }

  private safeSend(s: WebSocket, msg: string | ArrayBuffer): void {
    try {
      s.send(msg);
    } catch (e) {
      // Usually a closing peer, whose own close handler updates the others. Log only the
      // error text (never the payload) so a dropped frame is visible in `wrangler tail`.
      console.error("send failed:", e instanceof Error ? e.message : String(e));
    }
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    const size = typeof msg === "string" ? new TextEncoder().encode(msg).byteLength : msg.byteLength;
    if (size > Number(this.env.MAX_MESSAGE_BYTES)) {
      ws.close(1009, "message too big");
      return;
    }
    const type = frameType(msg);
    if (type === "hello") {
      const role = JSON.parse(msg as string).role;
      if (ROLES.includes(role)) {
        ws.serializeAttachment({ role });
        this.broadcastPresence();
      }
      return;
    }
    if (type && RESERVED.has(type)) return; // drop forged server frames
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== ws) this.safeSend(peer, msg);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      // already closed
    }
    this.broadcastPresence(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.broadcastPresence(ws);
  }
}
