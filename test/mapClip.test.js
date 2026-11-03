// The map's lines and shapes are cut to the screen before they're drawn
// (render/markers.js): an iPhone's canvas dashed a line out to points
// millions of pixels away and ran out of memory (THE VIEW WENT OUT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipTo, seg, poly, offScreen } from '../src/render/markers.js';

const rec = () => { const pts = []; return { pts, moveTo: (x, y) => pts.push(['M', x, y]), lineTo: (x, y) => pts.push(['L', x, y]), closePath: () => pts.push(['Z']) }; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('a line from on screen to 200 million pixels away is cut at the screen\'s edge (64 px out)', () => {
  clipTo(800, 400);
  const c = rec();
  seg(c, [400, 200], [2e8, 200]);
  assert.deepEqual(c.pts[0], ['M', 400, 200]);
  assert.equal(c.pts[1][0], 'L'); assert.ok(near(c.pts[1][1], 864) && near(c.pts[1][2], 200));
});

test('a line wholly off screen draws nothing; one crossing it is cut at both ends; a missing end draws nothing', () => {
  clipTo(800, 400);
  const c = rec();
  seg(c, [-5e7, -5e7], [-4e7, 1e3]);
  seg(c, [400, 200], null);
  assert.equal(c.pts.length, 0);
  seg(c, [-1e7, 200], [1e7, 200]);
  assert.ok(near(c.pts[0][1], -64) && near(c.pts[1][1], 864));
});

test('a shape reaching far off screen is cut to the screen; one off it draws nothing', () => {
  clipTo(800, 400);
  const c = rec();
  poly(c, [[100, 100], [3e8, 100], [100, 300]]);
  assert.ok(c.pts.length >= 4 && c.pts.at(-1)[0] === 'Z');
  for (const p of c.pts) if (p[0] !== 'Z') assert.ok(p[1] >= -64 - 1e-6 && p[1] <= 864 + 1e-6 && p[2] >= -64 - 1e-6 && p[2] <= 464 + 1e-6, JSON.stringify(p));
  const d = rec();
  poly(d, [[-1e6, -1e6], [-9e5, -1e6], [-9e5, -9e5]]);
  assert.equal(d.pts.length, 0);
});

test('a marker well off the screen is skipped; one at its edge is drawn', () => {
  clipTo(800, 400);
  assert.equal(offScreen([1e6, 10]), true);
  assert.equal(offScreen(null), true);
  assert.equal(offScreen([810, 390]), false);
});
