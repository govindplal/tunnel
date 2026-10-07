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

  /**
   * `make` runs in its turn (so e.g. clipboard writes happen in arrival order) and
   * produces the clip; `after` runs once the clip is stored.
   */
  receive(make: () => Promise<Clip>, after?: (clip: Clip) => void): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const clip = await make();
      this.list = await this.deps.save(this.list, clip);
      this.deps.onChange(this.list);
      after?.(clip);
    });
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.deps.clear();
      this.list = [];
      this.deps.onChange(this.list);
    });
  }
}
