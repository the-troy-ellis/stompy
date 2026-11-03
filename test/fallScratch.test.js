// The falling-ground checks' scratch (docs/specs/35-bigger-maps.md part 2):
// it grows with what a check visits, never with the map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGround, scratchBytes, PX, PY, PZ, VS, Y0 } from '../src/world/voxels.js';
import { HX as HALF } from '../src/world/terrain.js';
import { makeRng } from '../src/sim/rng.js';

test('after a run of digs and their checks, the scratch is a sliver of the map', () => {
  const g = makeGround(7), r = makeRng(3);
  let found = 0;
  for (let q = 0; q < 60; q++) {
    const x = r.range(-600, 600), z = r.range(-600, 600), y = g.height(x, z) - r.range(0, 12), rad = r.range(3, 14);
    g.carve([x, y, z], rad);
    const i = Math.floor((x + HALF) / VS), j = Math.floor((y - Y0) / VS), k = Math.floor((z + HALF) / VS), c = Math.ceil(rad / VS) + 1;
    const b = [i - c, i + c, j - c, j + c, k - c, k + c];
    found += g.islands(b).length + g.overhangs(b, 1.5, [], null).length;
  }
  assert.ok(found > 0, 'some of them found something');
  const map = PX * PY * PZ;
  assert.ok(scratchBytes() > 0 && scratchBytes() < map / 20, `${(scratchBytes() / 1024).toFixed(0)} KB against a ${(map / 2 ** 20).toFixed(1)} MB map`);
});

test('a check right after another finds the same, its marks cleared', () => {
  const g = makeGround(7);
  const x = 100, z = -80, y = g.height(x, z) - 4;
  g.carve([x, y, z], 10);
  const i = Math.floor((x + HALF) / VS), j = Math.floor((y - Y0) / VS), k = Math.floor((z + HALF) / VS), b = [i - 4, i + 4, j - 4, j + 4, k - 4, k + 4];
  const a1 = g.islands(b), o1 = g.overhangs(b, 1.5, [], null);
  assert.deepEqual(g.islands(b), a1);
  assert.deepEqual(g.overhangs(b, 1.5, [], null), o1);
});
