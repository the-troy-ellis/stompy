import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGround, chunkCorners, farCorners, CX, CY, CZ, CS, VS } from '../src/world/voxels.js';
import { meshChunk, boundsOf } from '../src/world/mesher.js';
import { PALS } from '../src/data/palettes.js';

const meshAll = (g, keep = () => true) => {
  const out = [];
  for (let cz = 0; cz < CZ; cz++) for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) {
    if (!keep(cx, cz)) continue;
    const c = chunkCorners(g, cx, cy, cz), f = meshChunk(c.D, c.T, c.dims, c.o, c.s, PALS.dusk);
    if (f.length) out.push(f);
  }
  return out;
};

test('the drawn top is the ground height: 97% of it within 0.6 m, all of it within 2.5 m (creases are smoothed)', () => {
  const g = makeGround(23);
  let n = 0, near = 0, worst = 0;
  for (const f of meshAll(g)) for (let p = 0; p < f.length; p += 27) {
    if (f[p + 4] < 0.6) continue;   // faces, not tops
    const x = (f[p] + f[p + 9] + f[p + 18]) / 3, y = (f[p + 1] + f[p + 10] + f[p + 19]) / 3, z = (f[p + 2] + f[p + 11] + f[p + 20]) / 3;
    if (Math.abs(x) > 1060 || Math.abs(z) > 1060) continue;   // the slab's edge, past BOUND
    const e = Math.abs(g.height(x, z) - y);
    n++; if (e < 0.6) near++; worst = Math.max(worst, e);
  }
  assert.ok(near / n > 0.97, `${(near / n * 100).toFixed(2)}% within 0.6 m`);
  assert.ok(worst < 2.5, `worst ${worst.toFixed(2)} m`);
});

test('chunks join with no holes: every edge inside is shared by two triangles (four at a pinch)', () => {
  // Craters and a tunnel across chunk borders (a chunk is CS × VS, 64 m), meshed chunk by chunk.
  const g = makeGround(5, {}, { ground: { landmarks: [{ kind: 'tunnel', from: [90, 100, 10], to: [90, 160, 10], r: 12 }] } });
  for (const p of [[0, 0, 0], [128, 10, 0], [-128, 5, 128], [64, 0, -64]]) g.carve(p, 18);
  const key = (f, p) => `${f[p].toFixed(3)},${f[p + 1].toFixed(3)},${f[p + 2].toFixed(3)}`, edges = new Map();
  const inside = (f, p) => Math.abs(f[p]) < 300 && Math.abs(f[p + 2]) < 300, reach = Math.ceil(300 / (CS * VS)) + 1;   // chunks out past 300 m, so no edge inside is the meshed block's own
  for (const f of meshAll(g, (cx, cz) => Math.abs(cx - CX / 2) <= reach && Math.abs(cz - CZ / 2) <= reach)) for (let p = 0; p < f.length; p += 27) {
    const v = [p, p + 9, p + 18];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (!inside(f, a) || !inside(f, b)) continue;
      const k = [key(f, a), key(f, b)].sort().join('|');
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  const open = [...edges].filter(([, c]) => c % 2);   // a hole leaves an edge on one triangle; a pinch (two sheets touching at an edge, which 4 m cells meet now and then) shares it among four
  assert.ok(edges.size > 1000);
  assert.equal(open.length, 0, `open edges: ${open.slice(0, 3).map(([k, c]) => k + "x" + c).join(" ")} of ${open.length}`);
});

test('normals face the air, and colours are the palette\'s', () => {
  const g = makeGround(5, { flat: true }, { ground: { landmarks: [{ kind: 'mesa', at: [0, 300], r: 50, top: 60, lip: 20 }] } });
  let up = 0, down = 0;
  for (const f of meshAll(g)) for (let p = 0; p < f.length; p += 9) {
    const x = f[p], y = f[p + 1], z = f[p + 2], nx = f[p + 3], ny = f[p + 4], nz = f[p + 5];
    if (Math.abs(x) > 1000 || Math.abs(z) > 1000) continue;
    assert.ok(!g.solid(x + nx * 3, y + ny * 3, z + nz * 3) || g.solid(x - nx * 3, y - ny * 3, z - nz * 3), 'out of the rock along the normal');
    if (ny > 0.9) up++; if (ny < -0.9) down++;
    for (let c = 6; c < 9; c++) assert.ok(f[p + c] >= 0 && f[p + c] <= 1.2);
  }
  assert.ok(up > 1000 && down > 10, 'tops, and the lip\'s underside');
});

test('an all-rock or all-air chunk is empty, and boundsOf boxes a mesh', () => {
  const g = makeGround(5, { flat: true });
  const c = chunkCorners(g, CX / 2, CY - 1, CZ / 2);
  assert.equal(meshChunk(c.D, c.T, c.dims, c.o, c.s, PALS.dusk).length, 0);
  assert.equal(boundsOf(new Float32Array(0)), null);
  const d = chunkCorners(g, CX / 2, 0, CZ / 2), f = meshChunk(d.D, d.T, d.dims, d.o, d.s, PALS.dusk), [lo, hi] = boundsOf(f);
  assert.ok(f.length > 0 && Math.abs(lo[1]) < 0.01 && Math.abs(hi[1]) < 0.01, 'flat ground at 0');
});

test('the far version is the near one in 16 m cells: a quarter of the triangles, in the same place', () => {
  const g = makeGround(23), near = [];
  let tris = 0;
  for (let cz = 8; cz < 10; cz++) for (let cy = 0; cy < CY; cy++) for (let cx = 4; cx < 6; cx++) {
    const c = chunkCorners(g, cx, cy, cz), f = meshChunk(c.D, c.T, c.dims, c.o, c.s, PALS.dusk);
    tris += f.length / 27; if (f.length) near.push(boundsOf(f));
  }
  const c = farCorners(g, 4, 8, 2), f = meshChunk(c.D, c.T, c.dims, c.o, c.s, PALS.dusk), [lo, hi] = boundsOf(f);
  assert.ok(f.length / 27 < tris * 0.45, `${f.length / 27} far triangles for ${tris} near`);
  const nlo = [0, 1, 2].map(a => Math.min(...near.map(b => b[0][a]))), nhi = [0, 1, 2].map(a => Math.max(...near.map(b => b[1][a])));
  for (const a of [0, 2]) assert.ok(lo[a] >= nlo[a] - 33 && hi[a] <= nhi[a] + 33, 'a coarse cell or so of overlap, no more');
  // Where both have ground, they agree to within a couple of metres.
  for (let p = 0; p < f.length; p += 27 * 5) {
    const x = (f[p] + f[p + 9] + f[p + 18]) / 3, y = (f[p + 1] + f[p + 10] + f[p + 19]) / 3, z = (f[p + 2] + f[p + 11] + f[p + 20]) / 3;
    if (f[p + 4] > 0.6) assert.ok(Math.abs(g.height(x, z) - y) < 4, `far top at ${x.toFixed(0)},${z.toFixed(0)}: ${y.toFixed(1)} vs ${g.height(x, z).toFixed(1)}`);
  }
});
