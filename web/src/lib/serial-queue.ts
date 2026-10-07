/** Runs jobs one at a time in the order they were submitted. A failed job never blocks the next. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run(job: () => Promise<void>): Promise<void> {
    const result = this.tail.then(job);
    this.tail = result.catch(() => {});
    return result.catch(() => {});
  }
}
