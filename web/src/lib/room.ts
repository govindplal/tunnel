const KEY = "tunnel.room";
const ROOM_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** 128 random bits as 22 base64url chars. The ID is the only secret: never log it. */
export function generateRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isValidRoomId(id: unknown): id is string {
  return typeof id === "string" && ROOM_RE.test(id);
}

/** The ID rides in the URL fragment so it is never sent to any server. */
export function buildJoinUrl(origin: string, room: string): string {
  return `${origin}/join#${room}`;
}

export function parseRoomFromHash(hash: string): string | null {
  const id = hash.replace(/^#/, "");
  return isValidRoomId(id) ? id : null;
}

export function loadRoomId(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    const id = storage.getItem(KEY);
    return isValidRoomId(id) ? id : null;
  } catch {
    return null;
  }
}

/** Returns false if storage is blocked (private mode); pairing still works for this tab. */
export function saveRoomId(id: string, storage: Pick<Storage, "setItem"> = localStorage): boolean {
  try {
    storage.setItem(KEY, id);
    return true;
  } catch {
    return false;
  }
}
