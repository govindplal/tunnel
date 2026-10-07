export const MAX_STASH_FILES = 20;
export const MAX_STASH_BYTES = 200 * 1024 * 1024;

export interface FileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  ts: number;
  thumb?: Blob;
}

/**
 * Which stored files to delete so the stash stays within both limits. Newest files are
 * kept first; once either limit is exceeded, that file and everything older goes.
 */
export function pickEvictions(
  files: Pick<FileMeta, "id" | "size" | "ts">[],
  maxFiles = MAX_STASH_FILES,
  maxBytes = MAX_STASH_BYTES,
): string[] {
  const newestFirst = [...files].sort((a, b) => b.ts - a.ts);
  const evict: string[] = [];
  let count = 0;
  let bytes = 0;
  let over = false;
  for (const f of newestFirst) {
    if (!over) {
      count++;
      bytes += f.size;
      over = count > maxFiles || bytes > maxBytes;
    }
    if (over) evict.push(f.id);
  }
  return evict;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
