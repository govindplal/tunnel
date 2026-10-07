import { isValidSecret } from "./crypto.ts";

// The pairing secret (see crypto.ts) is the only thing stored, in this browser only.
const KEY = "tunnel.secret";

/** The QR link. The secret rides in the URL fragment so it is never sent to any server. */
export function buildJoinUrl(origin: string, secret: string): string {
  return `${origin}/join#${secret}`;
}

export function parseSecretFromHash(hash: string): string | null {
  const s = hash.replace(/^#/, "");
  return isValidSecret(s) ? s : null;
}

export function loadSecret(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    const s = storage.getItem(KEY);
    return isValidSecret(s) ? s : null;
  } catch {
    return null;
  }
}

/** Returns false if storage is blocked (private mode); pairing still works for this tab. */
export function saveSecret(secret: string, storage: Pick<Storage, "setItem"> = localStorage): boolean {
  try {
    storage.setItem(KEY, secret);
    return true;
  } catch {
    return false;
  }
}

// Remembers that this browser has completed pairing, so the QR code can stay hidden while the
// phone is simply offline (pairing survives closing either browser).
const PAIRED_KEY = "tunnel.pairedSecret";

export function markPaired(secret: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(PAIRED_KEY, secret);
  } catch {
    // not remembered: the QR code just stays visible
  }
}

export function wasPaired(secret: string, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(PAIRED_KEY) === secret;
  } catch {
    return false;
  }
}
