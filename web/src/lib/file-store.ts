import type { FileMeta } from "./files-core.ts";
import { SerialQueue } from "./serial-queue.ts";
import type { ReceivedFile } from "./file-transfer.ts";

export interface FileStoreDeps {
  list: () => Promise<FileMeta[]>;
  /** Persists the file and evicts beyond the stash limits. Throws if it can't save. */
  save: (f: ReceivedFile, ts: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  onChange: (list: FileMeta[]) => void;
}

/** Host file stash. Every change runs in order, then the list is re-read from storage. */
export class FileStore {
  private readonly q = new SerialQueue();
  private readonly deps: FileStoreDeps;

  constructor(deps: FileStoreDeps) {
    this.deps = deps;
  }

  private async refresh(): Promise<void> {
    this.deps.onChange(await this.deps.list());
  }

  init(): Promise<void> {
    return this.q.run(() => this.refresh());
  }

  /** Resolves true if stored, false if saving failed (quota, blocked storage). */
  add(f: ReceivedFile, ts = Date.now()): Promise<boolean> {
    let ok = false;
    return this.q
      .run(async () => {
        await this.deps.save(f, ts);
        ok = true;
        await this.refresh();
      })
      .then(() => ok);
  }

  remove(id: string): Promise<void> {
    return this.q.run(async () => {
      await this.deps.remove(id);
      await this.refresh();
    });
  }

  clear(): Promise<void> {
    return this.q.run(async () => {
      await this.deps.clear();
      await this.refresh();
    });
  }
}
