// The torque rule (docs/specs/18-voxel-ground.md § Overhangs that can't hold
// their weight): ground that still reaches bedrock breaks off and falls when
// too much of it hangs too far off to one side of what holds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { makeGround } from '../src/world/voxels.js';
import { polar } from '../src/sim/placement.js';
import { dig, applyDigList } from '../src/sim/dig.js';
import { TORQUE } from '../src/data/weapons.js';

const game = landmarks => {
  const G = createTestGame();
  for (const e of foes(G)) { freeze(e); e.x = 900; e.z = 900; }
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks } });
  return G;
};
const ARCH = [{ kind: 'arch', at: [0, 300] }], a = polar([0, 300]);
// Cut the arch's +x leg through (as many blasts would; a battle dig only
// dents rock), then one dig there, which runs the rules.
const cutLeg = G => {
  for (const y of [0, 6, 12, 18]) for (const dz of [-8, 0, 8]) for (const dx of [-6, 0, 6]) G.ter.carve([a.x + 46 + dx, y, a.z + dz], 7);
  dig(G, [a.x + 46, G.ter.groundBelow(a.x + 46, 2, a.z), a.z], 4);
};

test('an arch on both legs stands; a dig at its foot drops nothing', () => {
  const G = game(ARCH);
  dig(G, [a.x + 46, 2, a.z + 10], 6);
  assert.equal(G.falls.length, 0);
  assert.ok(G.ter.solid(a.x, 40, a.z), 'the crown is up');
});

test('with one leg blown out, the crown breaks off at the other leg and comes down', () => {
  const G = game(ARCH);
  assert.ok(G.ter.solid(a.x, 40, a.z));
  cutLeg(G);
  assert.ok(G.falls.length >= 1, 'it breaks');
  assert.ok(!G.ter.solid(a.x, 40, a.z), 'the crown is gone from up there');
  assert.ok(G.ter.solid(a.x - 44, 8, a.z), 'and the other leg still stands');
  stepFor(G, 4);
  assert.equal(G.falls.length, 0, 'landed');
});

test('a mesa\'s 24 m lip holds, dug at its edge', () => {
  const G = game([{ kind: 'mesa', at: [0, 400] }]), m = polar([0, 400]);
  dig(G, [m.x + 80, 110, m.z], 7);
  assert.equal(G.falls.length, 0);
  assert.ok(G.ter.solid(m.x + 70, 100, m.z), 'the lip is still there');
});

test('a slab on a pillar stands; thin the pillar and it snaps off', () => {
  const G = game([]);
  G.ter.block(-12, 12, -12, 12, 44);
  for (let x = -32; x <= 32; x += 8) for (let z = -32; z <= 32; z += 8) G.ter.build([x, 44, z], 7);
  dig(G, [0, 2, 20], 5);
  assert.equal(G.falls.length, 0, 'whole, it holds the slab');
  for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, -8], [-8, 0]]) for (const y of [8, 16]) G.ter.carve([x, y, z], 5);
  dig(G, [0, 12, 8], 3);
  assert.ok(G.falls.length >= 1, 'thinned, it snaps');
  assert.ok(!G.ter.solid(28, 44, 28), 'the slab\'s far corner is gone');
});

test('the check weighs load against section: the numbers K was set from', () => {
  const both = game(ARCH), one = game(ARCH), box = [140, 150, 8, 12, 180, 190], r1 = [], r2 = [];
  both.ter.overhangs(box, Infinity, r1);
  for (const y of [0, 6, 12, 18]) for (const dz of [-8, 0, 8]) for (const dx of [-6, 0, 6]) one.ter.carve([a.x + 46 + dx, y, a.z + dz], 7);
  one.ter.overhangs([148, 152, 5, 9, 186, 190], Infinity, r2);
  assert.ok(Math.max(...r1) < TORQUE.rock, `on both legs: ${Math.max(...r1).toFixed(0)} < ${TORQUE.rock}`);
  assert.ok(Math.max(...r2) > TORQUE.rock, `on one: ${Math.max(...r2).toFixed(0)} > ${TORQUE.rock}`);
});

test('two clients find the same break from the relay\'s order', () => {
  const A = game(ARCH), B = game(ARCH);
  for (const G of [A, B]) { G.mode = 'mp'; for (const y of [0, 6, 12, 18]) for (const dz of [-8, 0, 8]) for (const dx of [-6, 0, 6]) G.ter.carve([a.x + 46 + dx, y, a.z + dz], 7); }
  dig(A, [a.x + 46, A.ter.groundBelow(a.x + 46, 2, a.z), a.z], 4);
  assert.equal(A.falls.length, 0, 'it waits for the relay');
  const l = A.pendingDigs.splice(0).map((d, i) => [i + 1, ...d]);
  applyDigList(A, l); applyDigList(B, l);
  assert.ok(A.falls.length >= 1 && A.falls.length === B.falls.length);
  assert.equal(A.ter.hash(), B.ter.hash());
});
