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
