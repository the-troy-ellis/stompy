import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, N, CELL, HALF, BOUND } from '../src/world/terrain.js';
import { buildGroundExtras, CHUNKS, CHUNK_CELLS } from '../src/world/terrainMesh.js';
import { PALS } from '../src/data/palettes.js';

test('terrain is deterministic for a seed and differs between seeds', () => {
  const a = makeTerrain(7), b = makeTerrain(7), c = makeTerrain(8);
  assert.deepEqual(Array.from(a.hs), Array.from(b.hs));
  assert.notDeepEqual(Array.from(a.hs), Array.from(c.hs));
});
test('the start zone is flat and the map has relief', () => {
  const t = makeTerrain(11);
  // The zone is flat out to the ring of grid vertices inside 70 m of the start.
  for (const [x, z] of [[0, 0], [30, -20], [-20, 30], [40, 10]]) assert.equal(t.height(x, z), 0);
  assert.ok(Math.max(...t.hs) > 20);
  assert.ok(BOUND < HALF && N * CELL === 2 * HALF);
});
test('flat terrain is level everywhere', () => {
  const t = makeTerrain(5, { flat: true });
  for (let i = 0; i < 50; i++) assert.equal(t.height((i * 97) % HALF - HALF / 2, (i * 53) % HALF - HALF / 2), 0);
});
test('what stands on the ground is 16 chunks over the map, each inside its bounds', () => {
  const t = makeTerrain(23), chunks = buildGroundExtras(t, PALS.dusk, 23);
  assert.equal(chunks.length, CHUNKS * CHUNKS);
  assert.ok(chunks.filter(ch => ch.b.d.length).length > CHUNKS * CHUNKS / 2, 'rocks all over');
  for (const ch of chunks) {
    const d = ch.b.d;
    for (let o = 0; o < d.length; o += 9) assert.ok(Math.hypot(d[o] - ch.c[0], d[o + 1] - ch.c[1], d[o + 2] - ch.c[2]) <= ch.r + 1e-6);
    const size = CHUNK_CELLS * CELL;
    if (d.length) assert.ok(ch.c[0] > -HALF - size && ch.c[0] < HALF + size);
  }
});
