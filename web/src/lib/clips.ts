import { addClip, MAX_CLIPS, type Clip } from "./clips-core";
import { getDb } from "./db";

export async function listClips(): Promise<Clip[]> {
  try {
    return await getDb().clips.orderBy("ts").reverse().limit(MAX_CLIPS).toArray();
  } catch {
    return []; // IndexedDB blocked: history just isn't persisted
  }
}

/** Stores the clip and trims to the newest MAX_CLIPS. Returns the new in-order list. */
export async function saveClip(current: Clip[], clip: Clip): Promise<Clip[]> {
  const next = addClip(current, clip);
  try {
    const d = getDb();
    await d.transaction("rw", d.clips, async () => {
      await d.clips.put(clip);
      const keep = new Set(next.map((c) => c.id));
      const stale = (await d.clips.toCollection().primaryKeys()).filter((k) => !keep.has(k));
      await d.clips.bulkDelete(stale);
    });
  } catch {
    // keep going with the in-memory list
  }
  return next;
}

export async function clearClips(): Promise<void> {
  try {
    await getDb().clips.clear();
  } catch {
    // nothing to clear
  }
}
