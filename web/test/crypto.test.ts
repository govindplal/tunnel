import test from "node:test";
import assert from "node:assert/strict";
import {
  b64uDecode, b64uEncode, decryptEnvelope, deriveRoomKeys, encryptEnvelope, generateSecret, isValidSecret,
  parseEnvelope, type Envelope,
} from "../src/lib/crypto.ts";

const ID = "123e4567-e89b-42d3-a456-426614174000";

test("generateSecret: 43 url-safe chars, unique, valid", () => {
  const all = new Set(Array.from({ length: 200 }, generateSecret));
  assert.equal(all.size, 200);
  for (const s of all) assert.ok(isValidSecret(s) && /^[A-Za-z0-9_-]{43}$/.test(s));
});

test("isValidSecret rejects wrong length, bad characters and non-strings", () => {
  assert.equal(isValidSecret("A".repeat(43)), true);
  assert.equal(isValidSecret("A".repeat(42)), false);
  assert.equal(isValidSecret("A".repeat(42) + "+"), false);
  assert.equal(isValidSecret(null), false);
  assert.equal(isValidSecret(5), false);
});

test("base64url round-trips arbitrary bytes", () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33, 255]) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    assert.deepEqual(b64uDecode(b64uEncode(bytes)), bytes);
  }
  assert.ok(!/[+/=]/.test(b64uEncode(new Uint8Array([251, 255, 254]))));
});

test("deriveRoomKeys is deterministic and both devices get the same keys", async () => {
  const s = generateSecret();
  const a = await deriveRoomKeys(s);
  const b = await deriveRoomKeys(s);
  assert.equal(a.room, b.room);
  assert.equal(a.token, b.token);
  assert.match(a.room, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.room, a.token);
  assert.notEqual(a.token, s);
  assert.notEqual(a.room, s);
});

test("different secrets give unrelated rooms, tokens and keys", async () => {
  const a = await deriveRoomKeys(generateSecret());
  const b = await deriveRoomKeys(generateSecret());
  assert.notEqual(a.room, b.room);
  assert.notEqual(a.token, b.token);
});

test("the relay's check holds: SHA-256 of the token is the room name", async () => {
  const { room, token } = await deriveRoomKeys(generateSecret());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  assert.equal(b64uEncode(digest), room);
});

test("the room name alone cannot decrypt anything (it is unrelated to the key)", async () => {
  const s = generateSecret();
  const { room, key } = await deriveRoomKeys(s);
  const frame = await encryptEnvelope(key, ID, "top secret");
  // an attacker who only knows the room name derives a key from it: must fail
  const wrong = await crypto.subtle.importKey("raw", b64uDecode(room), "AES-GCM", false, ["decrypt"]);
  const env = parseEnvelope(frame)!;
  assert.equal(await decryptEnvelope(wrong, env), null);
});

test("deriveRoomKeys rejects an invalid secret", async () => {
  await assert.rejects(deriveRoomKeys("short"));
});

test("encrypt/decrypt round-trips text exactly (unicode, newlines, quotes, emoji)", async () => {
  const { key } = await deriveRoomKeys(generateSecret());
  const text = 'line1\nline2 "quoted" \u{1F600} \\ done é中';
  const frame = await encryptEnvelope(key, ID, text);
  const env = parseEnvelope(frame)!;
  assert.equal(env.id, ID);
  assert.equal(await decryptEnvelope(key, env), text);
});

test("the frame carries no plaintext and starts with the prefix the relay looks for", async () => {
  const { key } = await deriveRoomKeys(generateSecret());
  const frame = await encryptEnvelope(key, ID, "visible-marker-text");
  assert.ok(frame.startsWith('{"type":"msg"'));
  assert.ok(!frame.includes("visible-marker-text"));
});

test("every encryption uses a fresh IV, so equal messages look different", async () => {
  const { key } = await deriveRoomKeys(generateSecret());
  const a = parseEnvelope(await encryptEnvelope(key, ID, "same"))!;
  const b = parseEnvelope(await encryptEnvelope(key, ID, "same"))!;
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test("a different room's key cannot decrypt", async () => {
  const k1 = (await deriveRoomKeys(generateSecret())).key;
  const k2 = (await deriveRoomKeys(generateSecret())).key;
  const env = parseEnvelope(await encryptEnvelope(k1, ID, "hi"))!;
  assert.equal(await decryptEnvelope(k2, env), null);
});

test("tampering with the ciphertext, the IV or the id is detected", async () => {
  const { key } = await deriveRoomKeys(generateSecret());
  const env = parseEnvelope(await encryptEnvelope(key, ID, "hello"))!;
  const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
  assert.equal(await decryptEnvelope(key, { ...env, ct: flip(env.ct) }), null);
  assert.equal(await decryptEnvelope(key, { ...env, iv: flip(env.iv) }), null);
  assert.equal(await decryptEnvelope(key, { ...env, id: "00000000-0000-4000-8000-000000000000" }), null); // re-labelled
  assert.equal(await decryptEnvelope(key, { ...env, ct: env.ct.slice(0, -4) }), null); // truncated
  assert.equal(await decryptEnvelope(key, { ...env, iv: "AAAA" }), null); // wrong IV length
  assert.equal(await decryptEnvelope(key, { ...env, ct: "!!!not base64!!!" }), null);
});

test("parseEnvelope accepts a real frame and rejects everything else", async () => {
  const { key } = await deriveRoomKeys(generateSecret());
  assert.ok(parseEnvelope(await encryptEnvelope(key, ID, "x")));
  const good: Envelope = { type: "msg", id: ID, iv: "aXY", ct: "Y3Q" };
  assert.deepEqual(parseEnvelope(JSON.stringify(good)), good);
  assert.equal(parseEnvelope("plain text"), null);
  assert.equal(parseEnvelope(new ArrayBuffer(4)), null);
  assert.equal(parseEnvelope('{"type":"msg"'), null);
  assert.equal(parseEnvelope(JSON.stringify({ ...good, id: "short" })), null);
  assert.equal(parseEnvelope(JSON.stringify({ ...good, iv: 5 })), null);
  assert.equal(parseEnvelope(JSON.stringify({ ...good, ct: undefined })), null);
  assert.equal(parseEnvelope(JSON.stringify({ id: ID, type: "msg", iv: "a", ct: "b" })), null); // prefix order matters
  assert.equal(parseEnvelope('{"type":"msg","id":"' + ID + '","iv":"a","ct":"' + "x".repeat(700_000) + '"}'), null);
});
