import { test } from 'node:test';
import { URLSearchParams } from 'node:url';
import assert from 'node:assert/strict';
import { backingSize, readLook, LOOK_DEFAULT } from '../src/render/look.js';

test('the 3D view renders `lines` tall, the width following the screen, never above native', () => {
  assert.deepEqual(backingSize(1280, 720, 1, 0), [1280, 720], '0 is native');
  assert.deepEqual(backingSize(1280, 720, 1.5, 0), [1920, 1080], 'native includes the pixel ratio');
  assert.deepEqual(backingSize(1280, 720, 1, 240), [427, 240]);
  assert.deepEqual(backingSize(740, 360, 1.5, 240), [493, 240], 'a phone held sideways gets the same 240 lines');
  assert.deepEqual(backingSize(1280, 720, 1, 2000), [1280, 720], 'asking for more than native gives native');
  assert.deepEqual(backingSize(0, 0, 1, 240), [1, 1], 'a collapsed view still has a pixel');
});

test('the look comes from the saved setting, and the URL overrides it', () => {
  const p = q => new URLSearchParams(q);
  assert.deepEqual(readLook(p(''), null), LOOK_DEFAULT);
  assert.deepEqual(readLook(p(''), { lines: 200, aa: false }), { lines: 200, aa: false });
  assert.deepEqual(readLook(p('lines=240&aa=0'), { lines: 200, aa: true }), { lines: 240, aa: false });
  assert.equal(readLook(p('lines=junk'), null).lines, 0);
});

test('PIXELS: CHUNKIER (240 lines, no antialias) is the default; CHUNKY is 360; CRISP is the screen, antialiased', async () => {
  const { lookOf } = await import('../src/render/look.js');
  const { SETTINGS, PIXEL_NAMES, readSetting } = await import('../src/data/settings.js');
  assert.equal(SETTINGS.pixels.def, 0);
  assert.equal(PIXEL_NAMES[readSetting('pixels', undefined)], 'CHUNKIER');
  assert.deepEqual(LOOK_DEFAULT, { lines: 240, aa: false });
  assert.deepEqual(lookOf(0), { lines: 240, aa: false });
  assert.deepEqual(lookOf(1), { lines: 360, aa: false });
  assert.deepEqual(lookOf(2), { lines: 0, aa: true });
  assert.deepEqual(readLook(new URLSearchParams(''), null, lookOf(1)), lookOf(1), '?debug=1 starts from the setting');
});

test('a slow phone: five seconds averaging over 40 ms a frame trips the step-down once, and never again', async () => {
  const { slowWatch, SLOW } = await import('../src/render/look.js');
  const fast = slowWatch();
  for (let i = 0; i < 60 * 30; i++) assert.equal(fast(1 / 60), false, 'holding 60 fps');
  const w = slowWatch();
  let trips = 0;
  for (let i = 0; i < 20 * 60; i++) if (w(0.05)) trips++;
  assert.equal(trips, 1);
  const edge = slowWatch();
  let t = 0, hit = false;
  while (t < SLOW.secs + 0.1 && !hit) { hit = edge(0.03); t += 0.03; }
  assert.equal(hit, false, '33 fps is inside the budget');
});
