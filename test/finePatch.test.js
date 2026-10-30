// Fine digging that settles (docs/specs/27-fine-dig.md): edits in play dig a
// patch of 2 m cells that every ground query reads; it's the 4 m ground with
// round bites out of it; 15 s after its last edit, with nobody on it, it
// slumps back into the 4 m ground over 1.5 s and goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes } from './helpers.js';
import { makeGround, cornerIndex, VS, Y0 } from '../src/world/voxels.js';
import { HALF } from '../src/world/terrain.js';
import { FS, PATCH } from '../src/world/finePatch.js';
import { FINE_DIG } from '../src/data/fineDig.js';
import { shiftMech } from '../src/sim/walkView.js';

const game = () => { const G = createTestGame(); for (const e of foes(G)) e.alive = false; return G; };
// A spot 60 m off to the side, away from you, on a corner of the 4 m grid;
// and one 2 m off it, in the middle of a cell, where the 4 m ground misses a
// small bite (a corner is where both grounds agree).
const SPOT = [60, 60], MID = [62, 62];
// A pit the 4 m ground can't see: bites 2.8 m across round the four cell
// middles about (x, z), each 2.83 m from every corner, `n` deep in 2 m steps
// from `top`. The fine ground has a shaft some 9 m wide; the 4 m one, nothing.
const pit = (T, x, z, top, n) => { for (let k = 0; k < n; k++) for (const dx of [-2, 2]) for (const dz of [-2, 2]) T.carve([x + dx, top - k * 2, z + dz], 2.8); };

test('a dig in play makes a patch; at a mission\'s load none are made', () => {
  const plain = makeGround(1, { flat: true }, { ground: { strokes: [[0, 0, 0, 0, 6]] } });
  assert.ok(!plain.patches, 'a mission\'s own strokes');
  const G = game(), h = G.ter.height(...SPOT);
  G.ter.carve([SPOT[0], h, SPOT[1]], 4);
  assert.equal(G.ter.patches.length, 1);
  const p = G.ter.patches[0];
  assert.ok(p.x0 < SPOT[0] - 4 && p.x1 > SPOT[0] + 4 && p.y0 < h - 4 && p.y1 > h + 4, 'it holds the dig, and a margin');
});

test('the bite is round, and the 4 m ground with it: never rock where that ground is air', () => {
  const G = game(), h = G.ter.height(...SPOT), r = 5, [cx, cz] = SPOT;
  G.ter.carve([cx, h, cz], r);
  const T = G.ter;
  // Down the middle, and all round at 3 m out: as deep as the sphere, or deeper where the 4 m ground went further.
  for (let a = 0; a < 8; a++) {
    const x = cx + Math.sin(a * Math.PI / 4) * 3, z = cz + Math.cos(a * Math.PI / 4) * 3, want = h - Math.sqrt(r * r - 9);
    const got = T.groundBelow(x, h + 2, z);
    assert.ok(got <= want + 0.5, `at ${a}: ${got.toFixed(2)} for a sphere's ${want.toFixed(2)}`);
  }
  // Finer than the 4 m ground: a 3 m bite in the middle of a cell barely moves that ground.
  const [mx, mz] = [MID[0] - 32, MID[1]], mh = T.height(mx, mz);
  T.carve([mx, mh, mz], 3);
  assert.ok(T.coarse.groundBelow(mx, mh + 2, mz) > T.groundBelow(mx, mh + 2, mz) + 2, 'finer than the 4 m ground');
  const p = T.patches[0];
  for (let n = 0; n < 2000; n++) {
    const x = p.x0 + Math.random() * (p.x1 - p.x0), y = p.y0 + Math.random() * (p.y1 - p.y0), z = p.z0 + Math.random() * (p.z1 - p.z0);
    assert.ok(T.sample(x, y, z) <= T.csample(x, y, z) + 0.02, 'no rock the 4 m ground lacks');
  }
});

test('feet, shots and the ring read the fine ground inside a patch, the 4 m ground outside', () => {
  const G = game(), h = G.ter.height(...MID), T = G.ter, [cx, cz] = MID;
  T.carve([cx, h, cz], 3);
  assert.ok(T.csample(cx, h - 2, cz) > 0 && T.sample(cx, h - 2, cz) < 0, 'in the bite: air, though the 4 m ground is rock');
  assert.ok(T.height(cx, cz) < h - 2, 'its top');
  assert.ok(Math.abs(T.ray([cx, h + 10, cz], [0, -1, 0], 30) - (10 + h - T.groundBelow(cx, h, cz))) < 0.3, 'a shot down meets the bite');
  assert.equal(T.sample(-60, h - 2, -60), T.csample(-60, h - 2, -60), 'far off: the 4 m ground');
});

// Within a patch, in any order. (A patch growing reads the ground as it is
// then: a dig it didn't hold yet is there only as the 4 m ground has it.)
test('digs give the same patch in any order', () => {
  const a = game(), b = game(), h = a.ter.height(...SPOT);
  const holes = [[[60, h, 60], 6], [[61, h - 1, 61], 4], [[59, h, 60], 3], [[60, h - 2, 59], 5]];
  holes.forEach(([p, r]) => a.ter.carve(p, r));
  [...holes].reverse().forEach(([p, r]) => b.ter.carve(p, r));
  assert.equal(a.ter.hash(), b.ter.hash());
  assert.equal(a.ter.patches.length, b.ter.patches.length);
  const pa = a.ter.patches[0], pb = b.ter.patches[0];
  assert.deepEqual([pa.i0, pa.i1, pa.j0, pa.j1, pa.k0, pa.k1], [pb.i0, pb.i1, pb.j0, pb.j1, pb.k0, pb.k1]);
  assert.ok(pa.D.every((v, i) => v === pb.D[i]), 'the same fine bytes');
});

test('a patch grows to hold nearby digs, up to its widest; past that a new one; past six the oldest goes at once', () => {
  const G = game(), T = G.ter, h = T.height(...SPOT);
  T.carve([60, h, 60], 3);
  T.carve([68, h, 60], 3);
  assert.equal(T.patches.length, 1, 'grown');
  T.carve([60 + PATCH.maxSide * VS, h, 60], 3);
  assert.equal(T.patches.length, 2, 'too wide: a second');
  for (let n = 0; n < 5; n++) T.carve([-120 + n * 60, T.height(-120 + n * 60, -60), -60], 3);   // all within FINE_DIG.far of you
  assert.equal(T.patches.length, 7);
  assert.ok(T.patches[0].force && !T.patches[1].force, 'the oldest is pushed out');
  stepFor(G, FINE_DIG.settleTime + 0.1);
  assert.equal(T.patches.length, 6, 'and settles at once');
});

test('15 s after the last dig it slumps over 1.5 s, with a rumble and dust, and goes', () => {
  const G = game(), T = G.ter, h = T.height(...MID), [cx, cz] = MID;
  T.carve([cx, h, cz], 4);
  stepFor(G, FINE_DIG.settleAfter - 1);
  assert.equal(T.patches.length, 1, 'still fine');
  T.carve([cx + 1, h, cz], 3);   // dug again: the clock starts over
  stepFor(G, FINE_DIG.settleAfter - 1);
  assert.equal(T.patches.length, 1, 'still fine after a second dig');
  const before = T.groundBelow(cx, h + 2, cz);
  stepFor(G, 1 + FINE_DIG.settleTime / 2);
  assert.ok(T.patches[0].blend > 0.2 && T.patches[0].blend < 0.8, 'slumping');
  const mid = T.groundBelow(cx, h + 2, cz);
  assert.ok(mid > before, 'the bite filling in');
  assert.equal(G.fx.calls('sfx.settle').length, 1);
  stepFor(G, FINE_DIG.settleTime);
  assert.equal(T.patches.length, 0, 'gone');
  assert.equal(T.sample(cx, h - 2, cz), T.csample(cx, h - 2, cz), 'the 4 m ground again');
});

test('stood on, it waits; then it slumps anyway, lifting the mech out of the bite', () => {
  const G = game(), T = G.ter, P = G.player, [cx, cz] = SPOT;
  shiftMech(P, cx - P.x, cz - P.z);
  stepFor(G, 0.5);
  pit(T, cx, cz, P.y, 4);
  stepFor(G, 1);
  const low = P.y;
  stepFor(G, FINE_DIG.settleAfter + FINE_DIG.settleTime + 1);
  assert.equal(T.patches.length, 1, 'waiting while you stand there');
  stepFor(G, FINE_DIG.settleWait);
  assert.equal(T.patches.length, 0);
  assert.ok(P.y > low + 1, `lifted: ${low.toFixed(1)} -> ${P.y.toFixed(1)}`);
});

test('a mech beside the bite, or in a scrape less than a step deep, doesn\'t hold the settle', () => {
  const G = game(), T = G.ter, P = G.player, [cx, cz] = SPOT;
  shiftMech(P, cx - P.x, cz - P.z);
  stepFor(G, 0.5);
  const h = P.y;
  T.carve([cx + 9, h, cz], 4);   // the bite, at the face in front
  T.carve([cx, h + 3, cz], 4);   // a scrape underfoot, 1 m deep
  stepFor(G, 1);
  assert.equal(T.patches.length, 1);
  stepFor(G, FINE_DIG.settleAfter + FINE_DIG.settleTime);
  assert.equal(T.patches.length, 0, 'settled on time');
});

test('ground falling in a patch drops the patch first: the 4 m ground says what falls', () => {
  const G = game(), T = G.ter, h = T.height(...SPOT);
  T.carve([60, h, 60], 4);
  const i = Math.round((60 + HALF) / VS), j = Math.round((h - 8 - Y0) / VS), k = Math.round((60 + HALF) / VS);
  T.fall([cornerIndex(i, j, k)]);
  assert.equal(T.patches.length, 0);
});

test('a mech in a deep bite walks out of it', () => {
  const G = game(), T = G.ter, P = G.player, [cx, cz] = SPOT;
  shiftMech(P, cx - P.x, cz - P.z);
  stepFor(G, 0.5);
  const h = P.y;
  pit(T, cx, cz, h, 4);
  stepFor(G, 1);
  assert.ok(P.y < h - 4, `in the bite: ${(h - P.y).toFixed(1)} m down`);
  P.throttle = 1;
  stepFor(G, 4, input({ thrUp: true }));
  assert.ok(Math.hypot(P.x - cx, P.z - cz) > 10 && P.y > h - 1, `out: ${Math.hypot(P.x - cx, P.z - cz).toFixed(1)} m off, ${(h - P.y).toFixed(1)} m down`);
  void FS;
});
