import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createValidPngBuffer(width: number, height: number): Buffer {
  // Create raw RGBA scanlines with filter byte 0
  const scanlineLength = 1 + width * 4;
  const rawData = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLength;
    rawData[offset] = 0; // Filter 0 (None)
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 4;
      rawData[px] = 0;       // R
      rawData[px + 1] = 242; // G
      rawData[px + 2] = 254; // B
      rawData[px + 3] = 255; // A
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

const png32 = createValidPngBuffer(32, 32);
const png128 = createValidPngBuffer(128, 128);

// Construct ICO header wrapping the 32x32 PNG
const icoHeader = Buffer.alloc(6 + 16);
icoHeader.writeUInt16LE(0, 0);                 // Reserved
icoHeader.writeUInt16LE(1, 2);                 // Type 1 = ICO
icoHeader.writeUInt16LE(1, 4);                 // Count 1 image

icoHeader.writeUInt8(32, 6);                   // Width
icoHeader.writeUInt8(32, 7);                   // Height
icoHeader.writeUInt8(0, 8);                    // Color count
icoHeader.writeUInt8(0, 9);                    // Reserved
icoHeader.writeUInt16LE(1, 10);                // Planes
icoHeader.writeUInt16LE(32, 12);               // Bits per pixel
icoHeader.writeUInt32LE(png32.length, 14);     // Size of PNG
icoHeader.writeUInt32LE(22, 18);               // Offset (6 + 16 = 22)

const icoBuffer = Buffer.concat([icoHeader, png32]);

const iconsDir = path.resolve('src-tauri/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, '32x32.png'), png32);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), png128);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), png128);
fs.writeFileSync(path.join(iconsDir, 'icon.png'), png128);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), png128);

console.log("Clean zlib PNG and ICO icon set generated successfully!");
