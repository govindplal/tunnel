// Reads an image's declared size from its header WITHOUT decoding it, so a tiny file that
// claims to be 30000x30000 pixels (a decompression bomb) can be refused before the browser
// tries to allocate gigabytes for it. Pure, so it is easy to test.
export const MAX_IMAGE_PIXELS = 50_000_000;

export interface Dimensions {
  width: number;
  height: number;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) | 0;
const ascii = (b: Uint8Array, i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

function jpeg(b: Uint8Array): Dimensions | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i + 1] === 0xff) i++; // fill bytes
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2; // standalone markers carry no length
      continue;
    }
    const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isSof) return { height: be16(b, i + 5), width: be16(b, i + 7) };
    i += 2 + be16(b, i + 2);
  }
  return null;
}

function webp(b: Uint8Array): Dimensions | null {
  if (b.length < 25) return null;
  if (ascii(b, 12, "VP8X") && b.length >= 30) {
    return {
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  }
  if (ascii(b, 12, "VP8L") && b[20] === 0x2f) {
    return {
      width: 1 + (b[21] | ((b[22] & 0x3f) << 8)),
      height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)),
    };
  }
  if (ascii(b, 12, "VP8 ") && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  return null;
}

/** Declared pixel size of a PNG, JPEG, GIF, WebP or BMP from its first bytes, or null if unreadable. */
export function imageDimensions(b: Uint8Array): Dimensions | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, "PNG") && ascii(b, 12, "IHDR")) {
    return { width: be32(b, 16), height: be32(b, 20) };
  }
  if (b.length >= 10 && (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a"))) {
    return { width: le16(b, 6), height: le16(b, 8) };
  }
  if (b.length >= 26 && ascii(b, 0, "BM")) {
    return { width: Math.abs(le32(b, 18)), height: Math.abs(le32(b, 22)) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (b.length >= 12 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return webp(b);
  return null;
}

export type ImageVerdict = "ok" | "too-large" | "unreadable";

/** Safe to decode? Unreadable headers are refused rather than guessed at. */
export function checkImage(b: Uint8Array): ImageVerdict {
  const d = imageDimensions(b);
  if (!d || !(d.width > 0) || !(d.height > 0)) return "unreadable";
  return d.width * d.height > MAX_IMAGE_PIXELS ? "too-large" : "ok";
}

/** Reads just the header bytes of a blob and checks them. */
export async function checkImageBlob(blob: Blob): Promise<ImageVerdict> {
  // 2 MB covers JPEGs with large EXIF blocks before the frame header.
  return checkImage(new Uint8Array(await blob.slice(0, 2 * 1024 * 1024).arrayBuffer()));
}
