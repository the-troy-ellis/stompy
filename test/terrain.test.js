import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, N, CELL, HALF, BOUND } from '../src/world/terrain.js';
import { buildTerrainMesh } from '../src/world/terrainMesh.js';
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
  const t = makeTerrain(23), b = buildTerrainMesh(t, PALS.dusk, 23);
  // The first 2*N*N triangles of the mesh are the ground, 27 floats each.
  const tri = k => { const o = k * 27, d = b.d; return [[d[o], d[o + 1], d[o + 2]], [d[o + 9], d[o + 10], d[o + 11]], [d[o + 18], d[o + 19], d[o + 20]]]; };
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
    const p = tri((j * N + i) * 2 + (fx + fz < 1 ? 0 : 1));
    assert.ok(Math.abs(planeY(p, x, z) - t.height(x, z)) < 1e-3, `mismatch at ${x},${z}`);
  }
});
