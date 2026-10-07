export const MAX_CLIPS = 30;

export interface Clip {
  id: string;
  text: string;
  ts: number;
  /** true if the browser let us write it to the system clipboard on arrival */
  copied: boolean;
}

/** Newest first, de-duplicated by id, capped at `max`. Pure, so it is easy to test. */
export function addClip(list: Clip[], clip: Clip, max = MAX_CLIPS): Clip[] {
  const rest = list.filter((c) => c.id !== clip.id);
  return [clip, ...rest].sort((a, b) => b.ts - a.ts).slice(0, max);
}
