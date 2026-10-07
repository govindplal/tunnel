import { addClip, MAX_CLIPS, type Clip } from "./clips-core";
import { getDb } from "./db";

export async function listClips(): Promise<Clip[]> {
  try {
    return await getDb().clips.orderBy("ts").reverse().limit(MAX_CLIPS).toArray();
  } catch {
    return []; // IndexedDB blocked: history just isn't persisted
  }
}

/**
 * Stores the clip and trims to the newest MAX_CLIPS. Returns the new in-order list.
 * THROWS if storage fails, so the caller knows the clip is not durable (and must not tell the
 * relay it can forget a held message).
 */
export async function saveClip(current: Clip[], clip: Clip): Promise<Clip[]> {
  const next = addClip(current, clip);
  const d = getDb();
  await d.transaction("rw", d.clips, async () => {
    await d.clips.put(clip);
    const keep = new Set(next.map((c) => c.id));
    const stale = (await d.clips.toCollection().primaryKeys()).filter((k) => !keep.has(k));
    await d.clips.bulkDelete(stale);
  });
  return next;
}

/** Throws if the stored history could not be cleared, so the list on screen isn't emptied while it survives on disk. */
export async function clearClips(): Promise<void> {
  await getDb().clips.clear();
}
