// Ids of text messages this device has already handled. Kept even after the user clears the
// history, so the same ciphertext re-delivered later (a lost acknowledgement, or a replay by the
// relay) can never put old text back on the clipboard. Ids only: no content.
export const SEEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SEEN_MAX = 2000;

export interface SeenRow {
  id: string;
  ts: number;
}

/** Which remembered ids to forget: older than the age limit, or beyond the newest `max`. */
export function pickSeenToPrune(
  rows: SeenRow[],
  now: number,
  maxAgeMs = SEEN_MAX_AGE_MS,
  max = SEEN_MAX,
): string[] {
  const newestFirst = [...rows].sort((a, b) => b.ts - a.ts);
  return newestFirst.filter((r, i) => i >= max || now - r.ts > maxAgeMs).map((r) => r.id);
}
