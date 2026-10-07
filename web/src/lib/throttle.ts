/** Allows one action per `ms` for each key. The first call for a key is always allowed. */
export function createKeyedThrottle(ms: number, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return {
    allow(key: string): boolean {
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < ms) return false;
      last.set(key, t);
      return true;
    },
    forget(key: string): void {
      last.delete(key);
    },
  };
}
