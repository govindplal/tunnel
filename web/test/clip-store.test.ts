import test from "node:test";
import assert from "node:assert/strict";
import { ClipStore } from "../src/lib/clip-store.ts";
import { addClip, MAX_CLIPS, type Clip } from "../src/lib/clips-core.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clip = (id: string, ts: number): Clip => ({ id, text: id, ts, copied: true });

/** Fake persistence with random latency, like IndexedDB, mirroring clips.ts semantics. */
function fakeDeps(initial: Clip[] = []) {
  let db = [...initial];
  const changes: Clip[][] = [];
  return {
    get db() {
      return db;
    },
    changes,
    deps: {
      load: async () => {
        await sleep(Math.random() * 5);
        return [...db];
      },
      save: async (current: Clip[], c: Clip) => {
        await sleep(Math.random() * 5);
        const next = addClip(current, c);
        db = next; // the real trim transaction leaves exactly `next` in the table
        return next;
      },
      clear: async () => {
        await sleep(Math.random() * 5);
        db = [];
      },
      onChange: (l: Clip[]) => {
        changes.push(l);
      },
    },
  };
}

test("a burst of concurrent messages loses nothing", async () => {
  const f = fakeDeps();
  const store = new ClipStore(f.deps);
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.receive(async () => {
        await sleep(Math.random() * 5);
        return clip(`m${i}`, 1000 + i);
      }),
    ),
  );
  assert.equal(f.db.length, 20);
  assert.deepEqual(new Set(f.db.map((c) => c.id)), new Set(Array.from({ length: 20 }, (_, i) => `m${i}`)));
});

test("handled in arrival order, and after() runs once stored", async () => {
  const f = fakeDeps();
  const store = new ClipStore(f.deps);
  const order: string[] = [];
  const mk = (id: string, delay: number) =>
    store.receive(
      async () => {
        await sleep(delay);
        return clip(id, order.length + 1);
      },
      (c) => order.push(c.id),
    );
  await Promise.all([mk("slow", 20), mk("fast", 0)]);
  assert.deepEqual(order, ["slow", "fast"]);
});

test("cap holds under concurrency", async () => {
  const f = fakeDeps();
  const store = new ClipStore(f.deps);
  await Promise.all(
    Array.from({ length: MAX_CLIPS + 15 }, (_, i) => store.receive(async () => clip(`m${i}`, i + 1))),
  );
  assert.equal(f.db.length, MAX_CLIPS);
  assert.equal(f.changes.at(-1)?.length, MAX_CLIPS);
});

test("init merges stored history without dropping an early message", async () => {
  const f = fakeDeps([clip("old", 1)]);
  const store = new ClipStore(f.deps);
  const early = store.receive(async () => clip("early", 50)); // arrives before init completes
  const init = store.init();
  await Promise.all([early, init]);
  const ids = f.changes.at(-1)!.map((c) => c.id);
  assert.ok(ids.includes("early") && ids.includes("old"));
});

test("clear is not undone by an in-flight save", async () => {
  const f = fakeDeps();
  const store = new ClipStore(f.deps);
  const a = store.receive(async () => {
    await sleep(10);
    return clip("a", 1);
  });
  const c = store.clear();
  await Promise.all([a, c]);
  assert.deepEqual(f.db, []);
  assert.deepEqual(f.changes.at(-1), []);
});

test("a failing job does not block later ones", async () => {
  const f = fakeDeps();
  const store = new ClipStore(f.deps);
  await store.receive(async () => {
    throw new Error("boom");
  });
  await store.receive(async () => clip("ok", 1));
  assert.deepEqual(f.db.map((c) => c.id), ["ok"]);
});
