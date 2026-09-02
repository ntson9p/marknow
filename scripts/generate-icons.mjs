// Generates the PWA icon set (pure Node, no native deps).
// Draws the MarkNow mark: an indigo tile with a white "M".
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [79, 70, 229]; // #4f46e5 indigo-600
const FG = [255, 255, 255];

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function roundedRectAlpha(px, py, size, radius) {
  const half = size / 2;
  const qx = Math.abs(px - half) - (half - radius);
  const qy = Math.abs(py - half) - (half - radius);
  const dist =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return Math.max(0, Math.min(1, 0.5 - dist));
}

// "M" strokes in unit space.
const M_SEGMENTS = [
  [0.28, 0.73, 0.28, 0.3],
  [0.28, 0.3, 0.5, 0.55],
  [0.5, 0.55, 0.72, 0.3],
  [0.72, 0.3, 0.72, 0.73],
];

function renderIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const cornerRadius = maskable ? 0 : size * 0.2;
  // Maskable icons keep glyph content inside the central safe zone (~80%).
  const glyphScale = maskable ? 0.62 : 0.9;
  const glyphOffset = (1 - glyphScale) / 2;
  const strokeHalf = size * glyphScale * 0.052;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bgAlpha = maskable ? 1 : roundedRectAlpha(x + 0.5, y + 0.5, size, cornerRadius);
      // Distance to the nearest "M" stroke, in pixels.
      const ux = (x + 0.5) / size;
      const uy = (y + 0.5) / size;
      let d = Infinity;
      for (const [ax, ay, bx, by] of M_SEGMENTS) {
        const sax = (glyphOffset + ax * glyphScale) * size;
        const say = (glyphOffset + ay * glyphScale) * size;
        const sbx = (glyphOffset + bx * glyphScale) * size;
        const sby = (glyphOffset + by * glyphScale) * size;
        d = Math.min(d, distToSegment(ux * size, uy * size, sax, say, sbx, sby));
      }
      const glyphAlpha = Math.max(0, Math.min(1, strokeHalf + 0.5 - d));

      const i = (y * size + x) * 4;
      const r = BG[0] + (FG[0] - BG[0]) * glyphAlpha;
      const g = BG[1] + (FG[1] - BG[1]) * glyphAlpha;
      const b = BG[2] + (FG[2] - BG[2]) * glyphAlpha;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(bgAlpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'icon-192.png'), renderIcon(192));
writeFileSync(path.join(OUT_DIR, 'icon-512.png'), renderIcon(512));
writeFileSync(path.join(OUT_DIR, 'icon-maskable-512.png'), renderIcon(512, { maskable: true }));
console.log('Icons written to', OUT_DIR);
