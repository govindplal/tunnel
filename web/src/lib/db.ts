import Dexie, { type EntityTable } from "dexie";
import type { Clip } from "./clips-core";

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  ts: number;
  blob: Blob;
  /** small preview image, generated after the file arrives (absent until then, or if unsupported) */
  thumb?: Blob;
}

export type TunnelDb = Dexie & {
  clips: EntityTable<Clip, "id">;
  files: EntityTable<StoredFile, "id">;
  seen: EntityTable<{ id: string; ts: number }, "id">;
};

let db: TunnelDb | null = null;

/** Host-only, local to this browser. The relay never sees or stores any of this. */
export function getDb(): TunnelDb {
  if (!db) {
    const d = new Dexie("tunnel") as TunnelDb;
    d.version(1).stores({ clips: "id, ts" });
    d.version(2).stores({ clips: "id, ts", files: "id, ts" });
    d.version(3).stores({ clips: "id, ts", files: "id, ts", seen: "id, ts" });
    db = d;
  }
  return db;
}
