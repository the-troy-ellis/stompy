import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, N, CELL, HALF, BOUND } from '../src/world/terrain.js';
import { buildTerrainMesh, CHUNKS, CHUNK_CELLS } from '../src/world/terrainMesh.js';
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
test('height() matches the mesh triangles it stands on', () => {
  const t = makeTerrain(23), chunks = buildTerrainMesh(t, PALS.dusk, 23);
  // Each chunk's first triangles are its ground, two a cell in rows, 27 floats each.
  const tri = (i, j, half) => {
    const d = chunks[Math.floor(j / CHUNK_CELLS) * CHUNKS + Math.floor(i / CHUNK_CELLS)].b.d, o = (((j % CHUNK_CELLS) * CHUNK_CELLS + i % CHUNK_CELLS) * 2 + half) * 27;
    return [[d[o], d[o + 1], d[o + 2]], [d[o + 9], d[o + 10], d[o + 11]], [d[o + 18], d[o + 19], d[o + 20]]];
  };
  const planeY = (p, x, z) => {
    const [a, b2, c] = p, u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return a[1] - (n[0] * (x - a[0]) + n[2] * (z - a[2])) / n[1];
  };
  let s = 1;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 1000; k++) {
    const x = (r() * 2 - 1) * (HALF - 1), z = (r() * 2 - 1) * (HALF - 1);
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL), fx = (x + HALF) / CELL - i, fz = (z + HALF) / CELL - j;
    const p = tri(i, j, fx + fz < 1 ? 0 : 1);
    assert.ok(Math.abs(planeY(p, x, z) - t.height(x, z)) < 1e-3, `mismatch at ${x},${z}`);
  }
});

test('the terrain is 16 chunks that tile the map, each inside its bounds', () => {
  const t = makeTerrain(23), chunks = buildTerrainMesh(t, PALS.dusk, 23);
  assert.equal(chunks.length, CHUNKS * CHUNKS);
  assert.equal(chunks.reduce((a, ch) => a + ch.b.d.length, 0) / 27 >= 2 * N * N, true);
  for (const ch of chunks) {
    const d = ch.b.d;
    for (let o = 0; o < d.length; o += 9) assert.ok(Math.hypot(d[o] - ch.c[0], d[o + 1] - ch.c[1], d[o + 2] - ch.c[2]) <= ch.r + 1e-6);
  }
  assert.equal(Math.min(...chunks.map(c => c.lo[0])), -HALF);
  assert.ok(Math.max(...chunks.map(c => c.hi[2])) >= HALF);
});
