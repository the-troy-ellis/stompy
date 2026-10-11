import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { rasterSvg, scaleOnto, png, iconFiles } from '../scripts/icons.mjs';

// The app icons (#226): favicon.svg's pixel grid, drawn without a browser.
const svg = '<svg viewBox="0 0 4 2" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="0" width="2" height="1" fill="#f00"/><rect x="3" y="1" width="1" height="1" fill="#0a0"/></svg>';

test('the grid is drawn rect by rect, transparent elsewhere', () => {
  const { w, h, px } = rasterSvg(svg);
  assert.equal(w, 4); assert.equal(h, 2);
  const at = (x, y) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(1, 0), [255, 0, 0, 255]);
  assert.deepEqual(at(3, 1), [0, 170, 0, 255], '#0a0 is #00aa00');
});

test('anything but a rect is refused, so a new favicon cannot lose a shape quietly', () => {
  assert.throws(() => rasterSvg('<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/></svg>'), /only rects/);
  assert.throws(() => rasterSvg('<svg><rect/></svg>'), /viewBox/);
});

test('scaled up with hard edges, centred, over a background when asked', () => {
  const g = rasterSvg(svg), out = scaleOnto(g, 10, 2, [0, 0, 0]);
  const at = (x, y) => [...out.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), [0, 0, 0, 255], 'the margin is the background');
  assert.deepEqual(at(1 + 2, 3), [255, 0, 0, 255], 'grid cell (1, 0) covers 2x2 px from (3, 3)');
  assert.deepEqual(at(1 + 3, 3 + 1), [255, 0, 0, 255]);
});

test('a PNG with the right size and pixels comes out', () => {
  const g = rasterSvg(svg), buf = png(scaleOnto(g, 4, 1), 4);
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(buf.readUInt32BE(16), 4); assert.equal(buf.readUInt32BE(20), 4);
  const idat = buf.indexOf('IDAT'), len = buf.readUInt32BE(idat - 4), rows = inflateSync(buf.subarray(idat + 4, idat + 4 + len));
  assert.equal(rows.length, 4 * (4 * 4 + 1));
  assert.deepEqual([...rows.subarray(17 + 1 + 4, 17 + 1 + 8)], [255, 0, 0, 255], 'row 1 (the grid sits one row down), pixel 1');
  assert.deepEqual([...rows.subarray(1 + 4, 1 + 8)], [0, 0, 0, 0], 'row 0 is the empty margin');
});

test('the shipped favicon makes all three icons at their sizes', () => {
  const files = iconFiles(readFileSync('favicon.svg', 'utf8'));
  assert.deepEqual(Object.keys(files), ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
  assert.deepEqual(Object.values(files).map(b => b.readUInt32BE(16)), [192, 512, 512]);
  const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  assert.deepEqual(manifest.icons.map(i => i.src.replace('icons/', '')), Object.keys(files), 'the manifest names exactly these');
  assert.equal(manifest.orientation, 'landscape'); assert.equal(manifest.display, 'standalone');
});
