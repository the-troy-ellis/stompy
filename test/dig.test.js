// Digging in play (docs/specs/18-voxel-ground.md § Digging in play): the
// radius table, what each blast digs, materials, scorches, and what stood on
// the ground settling or breaking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { WEAPONS, DIG } from '../src/data/weapons.js';
import { dig, digOf, deathDig, PROP_DROP } from '../src/sim/dig.js';
import { damage } from '../src/sim/combat.js';
import { addEntity } from '../src/sim/entities.js';
import { makeGround } from '../src/world/voxels.js';
import { DEATH_BEAT } from '../src/sim/combat.js';

const { hypot } = Math;
const shell = (G, type, at, owner, ghost = false) => G.shots.push({ kind: 'shell', type, p: [at[0], 6, at[1]], v: [0, -300, 0], owner, dmg: ghost ? 0 : 1, life: 1, ghost });

test('the battle table: what each weapon digs, deaths by size, and the big events', () => {
  const want = { ac: 2.5, gauss: 3.5, ppc: 4, srm: 2, lrm: 1.5, fusion: 6, mg: 0, laser: 0, mlaser: 0, plaser: 0, flamer: 0 };
  for (const [k, r] of Object.entries(want)) assert.equal(digOf(k), r, k);
  assert.ok(Object.values(WEAPONS).every(w => (w.dig || 0) <= 4 || w.kind === 'fusion'), 'battle weapons stay at 4 m or under');
  const G = createTestGame({ foes: ['warden', 'light1', 'jackal'] });
  const [warden, pip, jackal] = foes(G);
  assert.equal(deathDig(warden), 7, 'a WARDEN: 5 m x 1.4, at most 7');
  assert.equal(deathDig(pip), 4, 'a PIPSQUEAK: 5 m x 0.8');
  assert.equal(deathDig(jackal), 4.25);
  assert.deepEqual([DIG.cookOff, DIG.guided, DIG.rock], [7, 4, 0.5]);
});

test('an AUTOCANNON shell dents the ground where it lands; a PEASHOOTER round and a laser do not', () => {
  const G = createTestGame();
  for (const e of foes(G)) freeze(e);
  const P = G.player, before = G.ter.hash();
  shell(G, 'mg', [0, 40], P);
  stepFor(G, 0.2);
  assert.equal(G.ter.hash(), before, 'a PEASHOOTER round leaves the ground as it was');
  shell(G, 'ac', [0, 40], P);
  stepFor(G, 0.2);
  assert.ok(G.ter.height(0, 40) < -0.3, `a dent: ${G.ter.height(0, 40).toFixed(2)}`);
  assert.ok(Math.abs(G.ter.height(0, 60)) < 0.05, 'and only there');
});

test('soft ground digs to the full radius, the rock band to half, bedrock not at all', () => {
  const G = createTestGame();
  // Under the soft top (6 m), a 7 m dig reaches only 3.5 m into the rock; a plain carve, all 7.
  dig(G, [0, -8, 0], 7);
  const plain = makeGround(1, { flat: true });
  plain.carve([0, -8, 0], 7);
  assert.ok(plain.sample(0, -12, 0) < 0 && G.ter.sample(0, -12, 0) > 0, 'the rock 4 m under the blast holds');
  assert.ok(G.ter.sample(0, -4, 0) < 0, 'the soft ground over it is gone');
  // Bedrock: the bottom two layers stay whatever digs there.
  for (let i = 0; i < 6; i++) dig(G, [100, -40, 100], 7);
  assert.ok(G.ter.solid(100, -40, 100) && G.ter.solid(100, -38, 100));
});

// Overlapping digs, none inside another: a dig that finds no ground within
// its reach is skipped (nothing to send), so one swallowed by an earlier,
// bigger hole would make the order matter.
test('digs give the same ground in any order', () => {
  const a = createTestGame(), b = createTestGame();
  const holes = [[[6, 0, 8], 4], [[13, -2, 11], 7], [[-20, 0, 5], 2.5], [[12, -6, 12], 6]];
  holes.forEach(([p, r]) => dig(a, p, r));
  [...holes].reverse().forEach(([p, r]) => dig(b, p, r));
  assert.equal(a.ter.hash(), b.ter.hash());
});

test('a death digs a crater the wreck and its scorch lie in', () => {
  const G = createTestGame({ foes: ['warden', 'jackal'] }), e = foes(G)[0];
  freeze(foes(G)[1]);
  damage(G, e, [e.x, e.y + 5, e.z], 1000, G.player);
  stepFor(G, DEATH_BEAT + 3);
  const floor = G.ter.height(e.x, e.z);
  assert.ok(floor < -3, `a crater: ${floor.toFixed(1)}`);
  assert.equal(G.wrecks.length, 1);
  assert.ok(Math.abs(G.wrecks[0].y - G.ter.groundBelow(e.x, 5, e.z)) < 0.5, 'the wreck lies in it');
  const s = G.scorches.find(x => hypot(x.x - e.x, x.z - e.z) < 2);
  assert.ok(s && s.y < -2, `the scorch is on the crater floor: ${s && s.y}`);
});

test('a structure in reach settles onto the dug ground; a prop that loses too much under it breaks', () => {
  const G = createTestGame({ flat: false });
  const st = addEntity(G, { kind: 'structure', x: 300, z: 300, radius: 3, height: 10 });
  const y0 = st.y;
  dig(G, [300, y0, 300], 7);
  assert.ok(st.y < y0 - 2 && Math.abs(st.y - G.ter.groundBelow(300, y0 + 1, 300)) < 0.05, 'the structure sits on the new ground');
  assert.ok(st.alive, 'and stands');
  const flat = G.scenery.filter(p => p.alive && Math.abs(p.y) < 1);   // on the level start ground (a crater on a slope is shallower: 8 m cells)
  const [small, big] = [flat[0], flat[flat.length - 1]];
  assert.ok(small && big, 'the map has props');
  const ys = small.y;
  dig(G, [small.x + small.radius + 2, small.y, small.z], 2.5);   // a dent at its edge
  assert.ok(small.alive && small.y <= ys && ys - small.y < PROP_DROP, 'a dent beside a prop: it settles');
  const yb = big.y;
  dig(G, [big.x, big.y, big.z], 7);   // a crater right under one
  assert.ok(yb - G.ter.groundBelow(big.x, yb + 1, big.z) > PROP_DROP, 'the crater took more than a prop can settle into');
  assert.equal(big.alive, false, 'a crater under a prop: it breaks');
  assert.ok(big.fall, 'and topples');
});
