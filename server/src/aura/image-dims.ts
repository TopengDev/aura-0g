// SERVER-ONLY. Dependency-free image dimension reader for PNG + JPEG (the two formats the create-agent
// validator accepts). Parses the header bytes directly so we do not pull another native image lib.
//   PNG: 8-byte signature, then IHDR chunk -> width (bytes 16-20) + height (bytes 20-24), big-endian.
//   JPEG: scan segments for a Start-Of-Frame marker (0xFFC0..0xFFCF, excluding C4/C8/CC) -> height,width.
export interface ImageDims {
  width: number;
  height: number;
  format: "png" | "jpeg";
}

function isPng(b: Buffer): boolean {
  return (
    b.length > 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

function pngDims(b: Buffer): ImageDims {
  // IHDR is the first chunk; width@16, height@20 (after 8-byte sig + 4 len + 4 "IHDR").
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  return { width, height, format: "png" };
}

function isJpeg(b: Buffer): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
}

function jpegDims(b: Buffer): ImageDims | null {
  let off = 2; // skip SOI
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    // SOFn markers carry the frame dimensions (skip C4=DHT, C8=JPG, CC=DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = b.readUInt16BE(off + 5);
      const width = b.readUInt16BE(off + 7);
      return { width, height, format: "jpeg" };
    }
    // otherwise skip this segment using its length field.
    const segLen = b.readUInt16BE(off + 2);
    if (segLen < 2) return null;
    off += 2 + segLen;
  }
  return null;
}

/** Read width/height from a PNG or JPEG buffer. Returns null if unrecognised. */
export function imageDimensions(b: Buffer): ImageDims | null {
  if (isPng(b)) return pngDims(b);
  if (isJpeg(b)) return jpegDims(b);
  return null;
}
