import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from './helpers.js';
import { makeGround, VS, Y0, NX, NZ, CX, CY, CZ, SOFT, chunkCorners } from '../src/world/voxels.js';
import { HALF } from '../src/world/terrain.js';
import { seamAt, SEAM_PITCH } from '../src/world/seams.js';
import { meshChunk } from '../src/world/mesher.js';
import { bite, seamOre } from '../src/sim/dig.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { PALS } from '../src/data/palettes.js';

const MESA = { kind: 'mesa', at: [0, 200], r: 70, top: 110, lip: 0 };

test('seams: the same for a seed, different between seeds, a fifth to a third of the rock', () => {
  let n = 0, hit = 0, same = 0, diff = 0;
  for (let x = -300; x <= 300; x += 8) for (let z = -300; z <= 300; z += 24) for (let y = -40; y <= 120; y += 8) {
    const a = seamAt(7, x, y, z);
    n++; if (a) hit++;
    if (a === seamAt(7, x, y, z)) same++;
    if (a !== seamAt(8, x, y, z)) diff++;
  }
  assert.equal(same, n);
  assert.ok(hit / n > 0.15 && hit / n < 0.35, `${(100 * hit / n).toFixed(0)}% seam`);
  assert.ok(diff / n > 0.1, 'another map, other seams');
});

test('seams: the 8 m corner grid catches every layer (a column through a patch meets one every SEAM_PITCH)', () => {
  let cols = 0, caught = 0;
  for (let x = -200; x <= 200; x += 16) for (let z = -200; z <= 200; z += 16) {
    if (!seamAt(3, x, 40, z) && !seamAt(3, x, 40 + SEAM_PITCH / 2, z) && !seamAt(3, x, 40 - SEAM_PITCH / 2, z)) continue;
    cols++;
    let any = false;
    for (let y = 40 - SEAM_PITCH; y <= 40 + SEAM_PITCH; y += VS) if (seamAt(3, x, y, z)) any = true;
    if (any) caught++;
  }
  assert.ok(cols > 50 && caught / cols > 0.95, `${caught} of ${cols}`);
});

// A digger by a mesa; bite exactly at one rock corner (a 6 m bite reaches no other).
function corner(G, want, deep) {
  const g = G.ter, seed = g.seed;
  for (let i = 1; i < NX; i++) for (let k = 1; k < NZ; k++) {
    const x = -HALF + i * VS, z = -HALF + k * VS, b = g.base[i + (NX + 1) * k];
    if (b < 60) continue;   // inside the mesa
    for (let j = 3; j < 30; j++) {
      const y = Y0 + j * VS, depth = b - y;
      if (depth < SOFT + 1 || g.sample(x, y, z) < 0.9) continue;
      if ((deep ? depth > 60 : depth < 30) && seamAt(seed, x, y, z) === want) return { p: [x, y, z], depth };
    }
  }
  return null;
}
function digger() {
  const G = createTestGame({ chassis: 'digger', foes: [] });
  G.ter = makeGround(5, { flat: true }, { ground: { landmarks: [MESA] } });
  return G;
}

test('a bite into a seam gives four times plain rock and more; a deeper seam gives more again', () => {
  const G = digger(), P = G.player;
  const plain = corner(G, false, false), seam = corner(G, true, false), deep = corner(G, true, true);
  assert.ok(plain && seam && deep, 'found them');
  P.ore = 0; const a = bite(G, P, plain.p);
  assert.equal(P.seamBite, false);
  P.ore = 0; const b = bite(G, P, seam.p);
  assert.equal(P.seamBite, true);
  P.ore = 0; const c = bite(G, P, deep.p);
  assert.equal(a, CONSTRUCT.orePerCorner);
  assert.equal(b, Math.round(seamOre(seam.depth)));
  assert.ok(b >= 4 * a, `seam ${b}, plain ${a}`);
  assert.ok(c > b, `deep ${c}, shallow ${b}`);
  assert.ok(seamOre(1000) === CONSTRUCT.orePerSeam * CONSTRUCT.seamMax, 'capped');
});

test('the mesher paints seams on rock faces in the palette\'s ore colour, and only with a seed', () => {
  const g = makeGround(5, { flat: true }, { ground: { landmarks: [MESA] } }), pal = { ...PALS.dusk, seed: 5 };
  const ore = c => Math.abs(c[0] / pal.ore[0] - c[1] / pal.ore[1]) < 0.02 && Math.abs(c[1] / pal.ore[1] - c[2] / pal.ore[2]) < 0.02;
  let withSeed = 0, faces = 0, without = 0;
  for (let cz = 0; cz < CZ; cz++) for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) {
    const c = chunkCorners(g, cx, cy, cz);
    const f = meshChunk(c.D, c.T, c.dims, c.o, c.s, pal), f0 = meshChunk(c.D, c.T, c.dims, c.o, c.s, { ...pal, seed: undefined });
    for (let q = 0; q < f.length; q += 27) { if (f[q + 4] <= 0.6) faces++; if (ore([f[q + 6], f[q + 7], f[q + 8]])) withSeed++; }
    for (let q = 0; q < f0.length; q += 27) if (ore([f0[q + 6], f0[q + 7], f0[q + 8]])) without++;
  }
  assert.ok(withSeed > 20 && withSeed < faces * 0.6, `${withSeed} seam triangles of ${faces} faces`);
  assert.equal(without, 0);
});
