// Relay: one Durable Object per room forwards WebSocket frames between its members.
//
// - Members prove they know the room secret (token whose SHA-256 is the room id), so someone
//   who only sees the URL path can't join, read or consume anything.
// - Frames are forwarded untouched and never logged. The ONLY thing stored is an end-to-end
//   encrypted text envelope (`msg`), held for the other side until it acknowledges (`qack`),
//   and dropped after HOLD_MS (30 min) at the latest. The relay can't read it.

export interface Env {
  ROOM: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  MAX_MESSAGE_BYTES: string;
  /** how long an unacknowledged message is kept, in ms (default 30 minutes) */
  HOLD_MS?: string;
  /** how long a new socket may stay silent before it is closed, in ms (default 10 s) */
  HELLO_TIMEOUT_MS?: string;
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

const ROOM_RE = /^[A-Za-z0-9_-]{22,64}$/; // base64url of a SHA-256 (43 chars)

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
const RESERVED = new Set(["presence", "queued", "delivered", "rejected"]);

const DEFAULT_HOLD_MS = 30 * 60 * 1000;
const DEFAULT_HELLO_TIMEOUT_MS = 10_000;
const MAX_QUEUE_ITEMS = 50;
const MAX_QUEUE_BYTES = 4_000_000;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

interface Attachment {
  room: string;
  /** when the socket connected: sockets that never prove membership are closed */
  created: number;
  role?: Role;
  auth?: boolean;
  /** we already told it to close: don't keep re-arming the alarm for a close that hasn't completed */
  closing?: boolean;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sha256b64url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

/** The frame's `type`, or null. Small frames only, except `msg` envelopes which are recognised by prefix. */
function frameType(msg: string | ArrayBuffer): string | null {
  if (typeof msg !== "string") return null;
  if (msg.startsWith('{"type":"msg"')) return "msg";
  if (msg.length > 512 || !msg.startsWith("{")) return null;
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
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS q (id TEXT NOT NULL, to_role TEXT NOT NULL, ts INTEGER NOT NULL, bytes INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (id, to_role))",
    );
  }

  private get holdMs(): number {
    const n = Number(this.env.HOLD_MS);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_HOLD_MS;
  }

  private get helloTimeoutMs(): number {
    const n = Number(this.env.HELLO_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_HELLO_TIMEOUT_MS;
  }

  async fetch(req: Request): Promise<Response> {
    const room = new URL(req.url).pathname.split("/").pop() ?? "";
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ room, created: Date.now() } satisfies Attachment);
    this.scheduleAlarm(); // close it if it never says hello
    return new Response(null, { status: 101, webSocket: client });
  }

  private att(ws: WebSocket): Attachment | null {
    return ws.deserializeAttachment() as Attachment | null;
  }

  /** Members that have proven they know the room secret, optionally of one role. */
  private members(role?: Role, except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => {
      if (s === except) return false;
      const a = this.att(s);
      return !!a?.auth && (!role || a.role === role);
    });
  }

  // Presence = number of distinct roles (host/client) present, so ghost sockets
  // from a dropped link or a second tab of the same role never read as a peer.
  private broadcastPresence(closing?: WebSocket): void {
    const sockets = this.members(undefined, closing);
    const roles = new Set<Role>();
    for (const s of sockets) {
      const r = this.att(s)?.role;
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

  // ---- held messages -------------------------------------------------------

  private purgeExpired(): void {
    this.ctx.storage.sql.exec("DELETE FROM q WHERE ts < ?", Date.now() - this.holdMs);
  }

  /** One alarm serves two jobs: purge expired held messages, and close sockets that never said hello. */
  private scheduleAlarm(): void {
    const due: number[] = [];
    const row = this.ctx.storage.sql.exec("SELECT MIN(ts) AS t FROM q").toArray()[0] as { t: number | null } | undefined;
    if (row?.t != null) due.push(row.t + this.holdMs + 1000);
    for (const s of this.ctx.getWebSockets()) {
      const a = this.att(s);
      if (a && !a.auth && !a.closing) due.push(a.created + this.helloTimeoutMs + 250);
    }
    if (due.length === 0) void this.ctx.storage.deleteAlarm();
    else void this.ctx.storage.setAlarm(Math.max(Date.now() + 50, Math.min(...due)));
  }

  async alarm(): Promise<void> {
    this.purgeExpired();
    const now = Date.now();
    for (const s of this.ctx.getWebSockets()) {
      const a = this.att(s);
      if (a && !a.auth && !a.closing && now - a.created >= this.helloTimeoutMs) {
        // Mark first: a close handshake that never completes would otherwise leave this socket
        // looking overdue forever and re-arm the alarm every 50 ms.
        s.serializeAttachment({ ...a, closing: true } satisfies Attachment);
        try {
          s.close(1008, "no hello");
        } catch {
          // already closed
        }
      }
    }
    this.scheduleAlarm();
  }

  /** Stores an envelope for `to`. False if the queue is full (nothing stored). */
  private enqueue(id: string, to: Role, body: string): boolean {
    const sql = this.ctx.storage.sql;
    this.purgeExpired();
    const bytes = new TextEncoder().encode(body).byteLength;
    const t = sql.exec("SELECT COUNT(*) AS c, COALESCE(SUM(bytes),0) AS b FROM q").toArray()[0] as { c: number; b: number };
    const exists = sql.exec("SELECT 1 FROM q WHERE id = ? AND to_role = ?", id, to).toArray().length > 0;
    if (!exists && (t.c >= MAX_QUEUE_ITEMS || t.b + bytes > MAX_QUEUE_BYTES)) return false;
    // A re-sent id is kept as it is (same row, same expiry): it can't reset the clock or replace anything.
    sql.exec("INSERT OR IGNORE INTO q (id, to_role, ts, bytes, body) VALUES (?, ?, ?, ?, ?)", id, to, Date.now(), bytes, body);
    return true;
  }

  private deliverQueued(ws: WebSocket, role: Role): void {
    this.purgeExpired();
    const rows = this.ctx.storage.sql.exec("SELECT body FROM q WHERE to_role = ? ORDER BY ts, rowid", role).toArray() as { body: string }[];
    for (const r of rows) this.safeSend(ws, r.body);
    this.scheduleAlarm();
  }

  // ---- frames ----------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    const size = typeof msg === "string" ? new TextEncoder().encode(msg).byteLength : msg.byteLength;
    if (size > Number(this.env.MAX_MESSAGE_BYTES)) {
      ws.close(1009, "message too big");
      return;
    }
    const att = this.att(ws);
    if (!att) return;
    const type = frameType(msg);

    if (type === "hello") {
      let m: { role?: unknown; token?: unknown };
      try {
        m = JSON.parse(msg as string);
      } catch {
        ws.close(1008, "bad hello");
        return;
      }
      const role = m.role as Role;
      if (!ROLES.includes(role) || typeof m.token !== "string" || m.token.length > 128) {
        ws.close(1008, "bad hello");
        return;
      }
      // The token is only known to someone holding the room secret: its hash is the room id.
      if ((await sha256b64url(m.token)) !== att.room) {
        ws.close(1008, "unauthorized");
        return;
      }
      ws.serializeAttachment({ ...att, role, auth: true } satisfies Attachment);
      this.broadcastPresence();
      this.deliverQueued(ws, role);
      this.scheduleAlarm();
      return;
    }

    if (!att.auth || !att.role) return; // not a proven member: ignore everything else

    if (type === "msg") {
      let env: { id?: unknown; iv?: unknown; ct?: unknown };
      try {
        env = JSON.parse(msg as string);
      } catch {
        return;
      }
      if (typeof env.id !== "string" || !ID_RE.test(env.id) || typeof env.iv !== "string" || typeof env.ct !== "string") return;
      const to: Role = att.role === "host" ? "client" : "host";
      const targets = this.members(to, ws);
      const stored = this.enqueue(env.id, to, msg as string);
      for (const t of targets) this.safeSend(t, msg);
      // The sender is always told when the relay could NOT hold the message (a dead-but-not-yet-noticed
      // receiver socket would otherwise swallow it silently), and when it is being held for an absent one.
      if (!stored) this.safeSend(ws, JSON.stringify({ type: "rejected", id: env.id, reason: "queue-full" }));
      else if (targets.length === 0) this.safeSend(ws, JSON.stringify({ type: "queued", id: env.id }));
      this.scheduleAlarm();
      return;
    }

    if (type === "qack") {
      let id: unknown;
      let drop = false;
      try {
        const m = JSON.parse(msg as string);
        id = m.id;
        drop = m.drop === true; // the receiver discarded it (couldn't read it): not "delivered"
      } catch {
        return;
      }
      if (typeof id !== "string" || !ID_RE.test(id)) return;
      const removed = this.ctx.storage.sql.exec("DELETE FROM q WHERE id = ? AND to_role = ?", id, att.role).rowsWritten;
      if (removed > 0) {
        // Only tell the sender about a message that really was waiting.
        const other: Role = att.role === "host" ? "client" : "host";
        const notice = drop ? { type: "rejected", id, reason: "unreadable" } : { type: "delivered", id };
        for (const t of this.members(other, ws)) this.safeSend(t, JSON.stringify(notice));
      }
      this.scheduleAlarm();
      return;
    }

    if (type && RESERVED.has(type)) return; // drop forged server frames
    for (const peer of this.members(undefined, ws)) this.safeSend(peer, msg);
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      // already closed
    }
    if (this.att(ws)?.auth) this.broadcastPresence(ws); // an unauthenticated socket changes nothing for members
  }

  webSocketError(ws: WebSocket): void {
    if (this.att(ws)?.auth) this.broadcastPresence(ws);
  }
}
