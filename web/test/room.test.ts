import test from "node:test";
import assert from "node:assert/strict";
import { generateSecret, isValidSecret } from "../src/lib/crypto.ts";
import { buildJoinUrl, loadSecret, parseSecretFromHash, saveSecret } from "../src/lib/room.ts";

test("join URL keeps the secret in the fragment and round-trips", () => {
  const s = generateSecret();
  const url = new URL(buildJoinUrl("https://x.example", s));
  assert.equal(url.search, "");
  assert.equal(url.pathname, "/join");
  assert.equal(parseSecretFromHash(url.hash), s);
  assert.equal(parseSecretFromHash("#nope"), null);
  assert.equal(parseSecretFromHash(""), null);
  assert.equal(parseSecretFromHash("#" + "A".repeat(42)), null); // wrong length
  assert.equal(parseSecretFromHash("#" + "A".repeat(44)), null);
});

test("an old-style room id is not accepted as a secret (existing pairings must re-scan)", () => {
  assert.equal(isValidSecret("A".repeat(22)), false);
});

test("storage round-trip and failure tolerance", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const s = generateSecret();
  assert.equal(saveSecret(s, store), true);
  assert.equal(loadSecret(store), s);
  mem.set("tunnel.secret", "garbage");
  assert.equal(loadSecret(store), null);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(loadSecret(broken), null);
  assert.equal(saveSecret(s, broken), false);
});
