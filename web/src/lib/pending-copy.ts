import type { Clip } from "./clips-core.ts";

/**
 * A page can only write the clipboard while its tab is focused. Text that arrives in a background
 * tab is stored uncopied; when the tab regains focus (or the user clicks the notification) the
 * newest such text is copied, which is the one they want to paste. `clips` is newest first.
 */
export function pickClipToCopy(clips: Clip[], arrivedThisSession: ReadonlySet<string>): Clip | null {
  // Only text that arrived uncopied THIS session: an old uncopied clip from a previous visit
  // must never overwrite what the user has on their clipboard now.
  return clips.find((c) => !c.copied && arrivedThisSession.has(c.id)) ?? null;
}

/** Tab title with a marker while text is waiting to be copied. */
export function titleFor(pendingCount: number, base = "Tunnel"): string {
  return pendingCount > 0 ? `(${pendingCount > 9 ? "9+" : pendingCount}) New text - ${base}` : base;
}
