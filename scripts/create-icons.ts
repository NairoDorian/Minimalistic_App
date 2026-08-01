import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Generates a cross-platform Tauri v2 icon set entirely from code.
 *
 * Produces:
 *  - `32x32.png`, `128x128.png`, `128x128@2x.png` (256px), `icon.png` (512px)
 *  - `icon.ico`  — multi-entry PNG-compressed ICO for Windows (16/32/48/64/128/256)
 *  - `icon.icns` — a VALID Apple Icon Image container for macOS with PNG-encoded
 *    chunks (icp4..ic15). Previously this file was a raw PNG with an .icns
 *    extension, which breaks macOS bundling. Modern ICNS files may embed PNG
 *    data directly, so no macOS-specific tooling is required to build it.
 */

/** Cyan brand color used for every generated pixel. */
const BRAND: readonly [number, number, number] = [0, 242, 254];

/**
 * Builds a valid PNG buffer for the given dimensions filled with the brand color.
 * Each RGBA scanline is prefixed with filter byte 0 (None), matching the PNG spec.
 */
function createValidPngBuffer(width: number, height: number): Buffer {
  const scanlineLength = 1 + width * 4;
  const rawData = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLength;
    rawData[offset] = 0; // Filter 0 (None)
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 4;
      rawData[px] = BRAND[0];       // R
      rawData[px + 1] = BRAND[1];   // G
      rawData[px + 2] = BRAND[2];   // B
      rawData[px + 3] = 255;        // A
    }
  }

  const idatData = zlib.deflateSync(rawData);

  function makeChunk(type: string, data: Buffer): Buffer {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = zlib.crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // Header chunk (IHDR)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);  // bit depth 8
  ihdr.writeUInt8(6, 9);  // color type 6 (RGBA)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/** PNG cache keyed by pixel dimension so each size is only generated once. */
const pngCache = new Map<number, Buffer>();
function getPng(size: number): Buffer {
  let buf = pngCache.get(size);
  if (!buf) {
    buf = createValidPngBuffer(size, size);
    pngCache.set(size, buf);
  }
  return buf;
}

/**
 * Builds a Windows `.ico` file embedding PNG-compressed entries (supported on
 * Windows Vista and later). Each entry header points at its raw PNG payload.
 */
function createIco(entries: readonly { size: number; png: Buffer }[]): Buffer {
  const headerSize = 6 + entries.length * 16;
  const header = Buffer.alloc(headerSize);

  header.writeUInt16LE(0, 0);                       // Reserved
  header.writeUInt16LE(1, 2);                       // Type 1 = ICO
  header.writeUInt16LE(entries.length, 4);          // Image count

  let offset = headerSize;
  entries.forEach((entry, i) => {
    const base = 6 + i * 16;
    // 0 means 256px in the ICO dimension byte; any 16-255 size fits in one byte.
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 0); // Width
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1); // Height
    header.writeUInt8(0, base + 2);                 // Color count
    header.writeUInt8(0, base + 3);                 // Reserved
    header.writeUInt16LE(1, base + 4);              // Planes
    header.writeUInt16LE(32, base + 6);             // Bits per pixel
    header.writeUInt32LE(entry.png.length, base + 8); // Size of PNG data
    header.writeUInt32LE(offset, base + 12);        // Offset to PNG data
    offset += entry.png.length;
  });

  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

/**
 * Builds a valid macOS `.icns` container. The file starts with the "icns" magic
 * and a total length, followed by type/length/data chunks. PNG-based chunks are
 * the modern, tool-free way to embed icons that macOS 10.7+ accepts.
 */
function createIcns(entries: readonly { type: string; png: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];

  for (const { type, png } of entries) {
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(8 + png.length, 0); // Length includes the 8-byte chunk header
    chunks.push(Buffer.concat([Buffer.from(type, 'ascii'), lengthBuf, png]));
  }

  const totalLength = 8 + chunks.reduce((sum, c) => sum + c.length, 0);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(totalLength, 0);

  return Buffer.concat([Buffer.from('icns', 'ascii'), lengthBuf, ...chunks]);
}

// --- Generate all required pixel sizes once ---
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024] as const;
const pngs = new Map<number, Buffer>(sizes.map((s) => [s, getPng(s)]));

// --- Multi-resolution Windows ICO (16 / 32 / 48 / 64 / 128 / 256) ---
const ico = createIco(
  [16, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngs.get(size)! }))
);

// --- Multi-resolution macOS ICNS (base + retina variants) ---
const icns = createIcns([
  { type: 'icp4', png: pngs.get(16)! },    // 16x16
  { type: 'icp5', png: pngs.get(32)! },    // 32x32
  { type: 'icp6', png: pngs.get(64)! },    // 64x64
  { type: 'ic07', png: pngs.get(128)! },   // 128x128
  { type: 'ic08', png: pngs.get(256)! },   // 256x256
  { type: 'ic09', png: pngs.get(512)! },   // 512x512
  { type: 'ic10', png: pngs.get(1024)! },  // 1024x1024
  { type: 'ic11', png: pngs.get(32)! },    // 16x16 @2x
  { type: 'ic12', png: pngs.get(64)! },    // 32x32 @2x
  { type: 'ic13', png: pngs.get(256)! },   // 128x128 @2x
  { type: 'ic14', png: pngs.get(512)! },   // 256x256 @2x
  { type: 'ic15', png: pngs.get(1024)! },  // 512x512 @2x
]);

const iconsDir = path.resolve('src-tauri/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, '32x32.png'), pngs.get(32)!);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), pngs.get(128)!);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), pngs.get(256)!); // 128 logical @2x
fs.writeFileSync(path.join(iconsDir, 'icon.png'), pngs.get(512)!);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), icns);

console.log(
  `Valid cross-platform icon set generated (${sizes.length} PNG sizes, multi-res ICO + ICNS) at ${iconsDir}`
);
