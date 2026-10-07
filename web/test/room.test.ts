import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJoinUrl, generateRoomId, isValidRoomId, loadRoomId, parseRoomFromHash, saveRoomId,
} from "../src/lib/room.ts";

test("generateRoomId: 22 url-safe chars, unique", () => {
  const ids = new Set(Array.from({ length: 200 }, generateRoomId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{22}$/);
});

test("isValidRoomId rejects short, long, and bad chars", () => {
  assert.equal(isValidRoomId("A".repeat(22)), true);
  assert.equal(isValidRoomId("short"), false);
  assert.equal(isValidRoomId("A".repeat(65)), false);
  assert.equal(isValidRoomId("A".repeat(21) + "!"), false);
  assert.equal(isValidRoomId(null), false);
});

test("join URL keeps the room in the fragment and round-trips", () => {
  const id = generateRoomId();
  const url = new URL(buildJoinUrl("https://x.example", id));
  assert.equal(url.search, "");
  assert.equal(parseRoomFromHash(url.hash), id);
  assert.equal(parseRoomFromHash("#nope"), null);
  assert.equal(parseRoomFromHash(""), null);
});

test("storage round-trip and failure tolerance", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const id = generateRoomId();
  saveRoomId(id, store);
  assert.equal(loadRoomId(store), id);
  mem.set("tunnel.room", "garbage");
  assert.equal(loadRoomId(store), null);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(loadRoomId(broken), null);
  assert.equal(saveRoomId(id, broken), false);
  assert.equal(saveRoomId(id, store), true);
});
