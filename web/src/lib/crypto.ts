// End-to-end encryption for text. The QR code carries ONE secret (in the URL fragment, which
// browsers never send to any server). Everything else is derived from it:
//   token = HKDF(secret, "tunnel/auth/v1")   proves membership to the relay
//   room  = SHA-256(token)                    the room name the relay (and its logs) can see
//   key   = HKDF(secret, "tunnel/enc/v1")     AES-256-GCM key; never leaves the two devices
// Knowing the room name (e.g. from a log or a proxy) reveals neither the token nor the key.
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const SECRET_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url

/** 256 random bits, as 43 base64url characters. The only secret; never log it or send it anywhere. */
export function generateSecret(): string {
  return b64uEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export function isValidSecret(s: unknown): s is string {
  return typeof s === "string" && SECRET_RE.test(s);
}

export interface RoomKeys {
  /** room name shown to the relay: SHA-256 of the token */
  room: string;
  /** proof of membership sent in `hello` */
  token: string;
  /** AES-GCM key for message encryption */
  key: CryptoKey;
}

export async function deriveRoomKeys(secret: string): Promise<RoomKeys> {
  if (!isValidSecret(secret)) throw new Error("invalid secret");
  const base = await crypto.subtle.importKey("raw", b64uDecode(secret), "HKDF", false, ["deriveBits", "deriveKey"]);
  const params = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) });
  const token = b64uEncode(new Uint8Array(await crypto.subtle.deriveBits(params("tunnel/auth/v1"), base, 256)));
  const room = b64uEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(token))));
  const key = await crypto.subtle.deriveKey(params("tunnel/enc/v1"), base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  return { room, token, key };
}

export interface Envelope {
  type: "msg";
  id: string;
  iv: string;
  ct: string;
}

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
// Generous: 100k chars of text, 3 bytes each as UTF-8, plus GCM tag, as base64.
export const MAX_ENVELOPE_CHARS = 600_000;

/** Encrypts `plaintext`, binding it to `id` so an envelope can't be re-labelled. Returns the wire frame. */
export async function encryptEnvelope(key: CryptoKey, id: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id) }, key, enc.encode(plaintext)),
  );
  // The relay recognises held messages by this exact prefix, so keep `type` first.
  return JSON.stringify({ type: "msg", id, iv: b64uEncode(iv), ct: b64uEncode(ct) });
}

export function parseEnvelope(data: unknown): Envelope | null {
  if (typeof data !== "string" || data.length > MAX_ENVELOPE_CHARS || !data.startsWith('{"type":"msg"')) return null;
  try {
    const m = JSON.parse(data);
    if (m.type !== "msg" || typeof m.id !== "string" || !ID_RE.test(m.id)) return null;
    if (typeof m.iv !== "string" || typeof m.ct !== "string") return null;
    return { type: "msg", id: m.id, iv: m.iv, ct: m.ct };
  } catch {
    return null;
  }
}

/** The plaintext, or null if the envelope is forged, tampered with, re-labelled or for another key. */
export async function decryptEnvelope(key: CryptoKey, env: Envelope): Promise<string | null> {
  try {
    const iv = b64uDecode(env.iv);
    if (iv.length !== 12) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(env.id) },
      key,
      b64uDecode(env.ct),
    );
    return dec.decode(pt);
  } catch {
    return null;
  }
}
