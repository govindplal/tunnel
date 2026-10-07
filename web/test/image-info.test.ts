import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { MAX_IMAGE_PIXELS, checkImage, imageDimensions } from "../src/lib/image-info.ts";

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >> 8) & 255];
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

const png = (w: number, h: number) =>
  bytes([0x89], "PNG", [13, 10, 26, 10], u32be(13), "IHDR", u32be(w), u32be(h), [8, 2, 0, 0, 0]);
const gif = (w: number, h: number) => bytes("GIF89a", u16le(w), u16le(h), [0, 0, 0]);
const bmp = (w: number, h: number) => bytes("BM", new Array(16).fill(0), u32le(w), u32le(h), [1, 0, 24, 0]);
const jpeg = (w: number, h: number, withExif = false) =>
  bytes(
    [0xff, 0xd8],
    withExif ? [0xff, 0xe1, 0x01, 0x00, ...new Array(254).fill(0)] : [],
    [0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
const webpX = (w: number, h: number) =>
  bytes("RIFF", u32le(30), "WEBP", "VP8X", u32le(10), [0, 0, 0, 0], u32le(w - 1).slice(0, 3), u32le(h - 1).slice(0, 3));
const webpL = (w: number, h: number) => {
  const v = (w - 1) | ((h - 1) << 14);
  return bytes("RIFF", u32le(30), "WEBP", "VP8L", u32le(5), [0x2f], u32le(v).slice(0, 4), [0]);
};
const webpLossy = (w: number, h: number) =>
  bytes("RIFF", u32le(40), "WEBP", "VP8 ", u32le(20), [0, 0, 0], [0x9d, 0x01, 0x2a], u16le(w), u16le(h), new Array(6).fill(0));

test("reads PNG, GIF and BMP sizes", () => {
  assert.deepEqual(imageDimensions(png(320, 200)), { width: 320, height: 200 });
  assert.deepEqual(imageDimensions(gif(64, 48)), { width: 64, height: 48 });
  assert.deepEqual(imageDimensions(bmp(100, 50)), { width: 100, height: 50 });
  assert.deepEqual(imageDimensions(bmp(100, -50)), { width: 100, height: 50 }); // top-down BMP has a negative height
});

test("reads JPEG size, including after a large EXIF block", () => {
  assert.deepEqual(imageDimensions(jpeg(4032, 3024)), { width: 4032, height: 3024 });
  assert.deepEqual(imageDimensions(jpeg(4032, 3024, true)), { width: 4032, height: 3024 });
});

test("reads all three WebP flavours", () => {
  assert.deepEqual(imageDimensions(webpX(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(imageDimensions(webpL(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(webpLossy(800, 600)), { width: 800, height: 600 });
});

test("a PNG assembled with real zlib data is read correctly", () => {
  const w = 7;
  const h = 5;
  const idat = zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h));
  const chunk = (type: string, data: Buffer) =>
    Buffer.concat([Buffer.from(u32be(data.length)), Buffer.from(type), data, Buffer.alloc(4)]);
  const ihdr = Buffer.from([...u32be(w), ...u32be(h), 8, 2, 0, 0, 0]);
  const file = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.deepEqual(imageDimensions(new Uint8Array(file)), { width: w, height: h });
});

test("garbage, truncated and unknown formats are unreadable, never a crash", () => {
  assert.equal(imageDimensions(bytes("hello world, not an image")), null);
  assert.equal(imageDimensions(new Uint8Array(0)), null);
  assert.equal(imageDimensions(png(1, 1).slice(0, 10)), null);
  assert.equal(imageDimensions(bytes([0xff, 0xd8, 0xff])), null);
  assert.equal(imageDimensions(bytes([0xff, 0xd8], new Array(10).fill(0))), null);
  // a JPEG whose segment length runs past the end must terminate, not loop
  assert.equal(imageDimensions(bytes([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0])), null);
});

test("checkImage: ok / too-large / unreadable", () => {
  assert.equal(checkImage(png(4000, 3000)), "ok"); // a 12 MP phone photo
  assert.equal(checkImage(png(30000, 30000)), "too-large"); // decompression bomb: tiny file, 900 MP
  assert.equal(checkImage(jpeg(10000, 10000)), "too-large");
  assert.equal(checkImage(png(0, 100)), "unreadable");
  assert.equal(checkImage(bytes("nope")), "unreadable");
  const edge = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS));
  assert.equal(checkImage(png(edge, edge)), "ok");
  assert.equal(checkImage(png(edge + 10, edge + 10)), "too-large");
});
