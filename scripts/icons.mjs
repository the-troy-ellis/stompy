// The app icons (docs/specs/11-release.md § PWA): favicon.svg drawn at 192
// and 512 px. The favicon is a pixel grid of filled rects, so it's drawn
// here in plain Node, cell by cell, and written as PNG with zlib: the Pages
// build needs no browser. Anything but rects in the SVG is an error, so a
// new favicon can't quietly lose a shape. `node scripts/icons.mjs [dir]`
// writes them to dir (default dist/icons); scripts/build.mjs calls iconFiles.
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The SVG's grid: { w, h, px } with px RGBA, row by row, transparent where no rect is.
export function rasterSvg(svg) {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!vb) throw new Error('icons: the SVG needs a viewBox "0 0 w h"');
  const w = +vb[1], h = +vb[2], px = new Uint8Array(w * h * 4);
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const shapes = body.match(/<[a-z]+\b[^>]*>/gi) || [];
  for (const tag of shapes) {
    if (!/^<rect\b/.test(tag)) throw new Error(`icons: only rects can be drawn, not ${tag.slice(0, 20)}`);
    const a = k => { const m = new RegExp(`\\b${k}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
    const [x, y, rw, rh] = ['x', 'y', 'width', 'height'].map(k => +(a(k) ?? 0));
    const rgb = hex(a('fill') || '#000');
    for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++) {
      for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) px.set([...rgb, 255], (j * w + i) * 4);
    }
  }
  return { w, h, px };
}
function hex(c) {
  const s = c.replace('#', ''), f = s.length === 3 ? s.split('').map(d => d + d).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(f)) throw new Error(`icons: a fill I can't read: ${c}`);
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
}

// The grid scaled up `scale` times with hard edges onto a size×size square,
// centred, over `bg` ([r, g, b] or null for transparent).
export function scaleOnto({ w, h, px }, size, scale, bg = null) {
  const out = new Uint8Array(size * size * 4), ox = (size - w * scale) >> 1, oy = (size - h * scale) >> 1;
  if (bg) for (let i = 0; i < size * size; i++) out.set([...bg, 255], i * 4);
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      const s = (((y / scale) | 0) * w + ((x / scale) | 0)) * 4;
      if (px[s + 3]) out.set(px.subarray(s, s + 4), ((y + oy) * size + x + ox) * 4);
    }
  }
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// A square RGBA image as PNG bytes.
export function png(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);   // 8 bits, RGBA, deflate, no filter method, no interlace
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rows.set(px.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);   // filter 0 on each row
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// The icons the manifest names: 192 and 512 as drawn, and a 512 for
// Android's masks, on black with the art inside the middle 80%.
export function iconFiles(svg) {
  const g = rasterSvg(svg), fit = size => Math.floor(size / g.w);
  return {
    'icon-192.png': png(scaleOnto(g, 192, fit(192)), 192),
    'icon-512.png': png(scaleOnto(g, 512, fit(512)), 512),
    'icon-maskable-512.png': png(scaleOnto(g, 512, Math.floor(512 * 0.75 / g.w), [0, 0, 0]), 512),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'dist/icons';
  await mkdir(dir, { recursive: true });
  for (const [name, buf] of Object.entries(iconFiles(await readFile('favicon.svg', 'utf8')))) await writeFile(`${dir}/${name}`, buf);
  console.log(`icons in ${dir}/`);
}
