import { getDb, type StoredFile } from "./db";
import { pickEvictions, type FileMeta } from "./files-core";

const toMeta = ({ id, name, mime, size, ts }: StoredFile): FileMeta => ({ id, name, mime, size, ts });

export async function listFiles(): Promise<FileMeta[]> {
  try {
    const all = await getDb().files.orderBy("ts").reverse().toArray();
    return all.map(toMeta);
  } catch {
    return []; // IndexedDB blocked
  }
}

/** Stores the file, then evicts the oldest ones beyond the stash limits. Throws if it can't save. */
export async function saveFile(f: StoredFile): Promise<void> {
  const d = getDb();
  await d.transaction("rw", d.files, async () => {
    await d.files.put(f);
    const metas = (await d.files.toArray()).map(toMeta);
    const evict = pickEvictions(metas).filter((id) => id !== f.id);
    if (evict.length) await d.files.bulkDelete(evict);
  });
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  try {
    return await getDb().files.get(id);
  } catch {
    return undefined;
  }
}

export async function deleteFile(id: string): Promise<void> {
  try {
    await getDb().files.delete(id);
  } catch {
    // already gone
  }
}

export async function clearFiles(): Promise<void> {
  try {
    await getDb().files.clear();
  } catch {
    // nothing to clear
  }
}
