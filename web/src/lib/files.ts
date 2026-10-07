import { getDb, type StoredFile } from "./db";
import { pickEvictions, type FileMeta } from "./files-core";

const toMeta = ({ id, name, mime, size, ts, thumb }: StoredFile): FileMeta => ({ id, name, mime, size, ts, thumb });

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

/** Attaches a thumbnail to an already-stored file. A file deleted in the meantime is left alone. */
export async function saveThumb(id: string, thumb: Blob): Promise<void> {
  try {
    await getDb().files.update(id, { thumb });
  } catch {
    // storage blocked or full: the file simply has no thumbnail
  }
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
