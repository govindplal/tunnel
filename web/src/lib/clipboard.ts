/**
 * Runs a clipboard write but gives up after `ms`. A browser prompt left open or an odd focus state
 * can leave `writeText` pending forever, and everything queued behind it (every later text) would
 * wait with it. Resolves true if the write succeeded, false if it was refused or timed out.
 */
export function writeWithTimeout(write: () => Promise<void>, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    let p: Promise<void>;
    try {
      p = write();
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    p.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}
