import { getDb } from "./db";
import { pickSeenToPrune } from "./seen-core";

export async function hasSeen(id: string): Promise<boolean> {
  try {
    return (await getDb().seen.get(id)) !== undefined;
  } catch {
    return false; // can't tell; addSeen will fail too, so nothing is acknowledged
  }
}

/** Remembers the id. Resolves false if it could not be stored durably. */
export async function addSeen(id: string, now = Date.now()): Promise<boolean> {
  try {
    const d = getDb();
    await d.transaction("rw", d.seen, async () => {
      await d.seen.put({ id, ts: now });
      const rows = await d.seen.toArray();
      const stale = pickSeenToPrune(rows, now);
      if (stale.length) await d.seen.bulkDelete(stale);
    });
    return true;
  } catch {
    return false;
  }
}
