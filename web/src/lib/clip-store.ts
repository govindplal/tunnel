import { addClip, type Clip } from "./clips-core.ts";

export interface ClipStoreDeps {
  load: () => Promise<Clip[]>;
  /** Persists `clip` and returns the new newest-first, capped list. */
  save: (current: Clip[], clip: Clip) => Promise<Clip[]>;
  clear: () => Promise<void>;
  onChange: (list: Clip[]) => void;
}

/**
 * Owns the host's clip history. Every operation (load, receive, clear) runs one at a
 * time in arrival order, so concurrent messages can't overwrite each other's saves
 * and Clear can't be undone by an in-flight save.
 */
export class ClipStore {
  private list: Clip[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private readonly deps: ClipStoreDeps;

  /** The current list, newest first. Always up to date, including inside a queued job. */
  get items(): Clip[] {
    return this.list;
  }

  constructor(deps: ClipStoreDeps) {
    this.deps = deps;
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.tail.then(job);
    this.tail = run.catch(() => {}); // one failed job must not block the next
    return run.catch(() => {});
  }

  private loaded = false;

  // Saves trim the table down to what we hold, so stored history must be merged in
  // before the first change or it would be deleted.
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.deps.load();
    this.loaded = true;
    this.list = stored.reduce((acc, c) => addClip(acc, c), this.list);
    this.deps.onChange(this.list);
  }

  /** Loads the stored history (merged, never replacing what's already here). */
  init(): Promise<void> {
    return this.enqueue(() => this.ensureLoaded());
  }

  /** Saves `clip`; if storage fails the clip is still kept in memory so it shows, but `durable` is false. */
  private async persist(clip: Clip): Promise<boolean> {
    try {
      this.list = await this.deps.save(this.list, clip);
      this.deps.onChange(this.list);
      return true;
    } catch {
      this.list = addClip(this.list, clip);
      this.deps.onChange(this.list);
      return false;
    }
  }

  /**
   * `make` runs in its turn (so e.g. clipboard writes happen in arrival order) and
   * produces the clip; `after` runs once the clip is stored. `durable` is false if it only
   * made it into memory (blocked or full storage): don't tell anyone it is safe.
   */
  receive(make: () => Promise<Clip>, after?: (clip: Clip, durable: boolean) => void): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const clip = await make();
      const durable = await this.persist(clip);
      after?.(clip, durable);
    });
  }

  /**
   * Changes fields of a clip that is still there, in turn. A clip that was cleared or evicted
   * meanwhile is NOT brought back. Resolves true if it was applied.
   */
  update(id: string, patch: Partial<Omit<Clip, "id">>): Promise<boolean> {
    let applied = false;
    return this.enqueue(async () => {
      const current = this.list.find((c) => c.id === id);
      if (!current) return;
      applied = true;
      await this.persist({ ...current, ...patch });
    }).then(() => applied);
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.deps.clear();
      this.list = [];
      this.deps.onChange(this.list);
    });
  }
}
