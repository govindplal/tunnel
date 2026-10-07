// Stateless relay: one Durable Object per room forwards WebSocket frames
// between its sockets. Nothing is persisted or logged.

export interface Env {
  ROOM: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  MAX_MESSAGE_BYTES: string;
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
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    if (origin && !allowed.includes(origin)) return new Response("Forbidden", { status: 403 });

    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};

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

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    const size = typeof msg === "string" ? new TextEncoder().encode(msg).byteLength : msg.byteLength;
    if (size > Number(this.env.MAX_MESSAGE_BYTES)) {
      ws.close(1009, "message too big");
      return;
    }
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== ws) peer.send(msg);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code === 1005 || code === 1006 ? 1000 : code);
  }
}
