// The AI on the voxel ground (docs/specs/18-voxel-ground.md § The AI in
// canyons and caves): the nav grid finds the way round a mesa and into a
// tunnel, digs re-mark it, foes walk round instead of grinding into walls,
// and a foe up on a mesa can't see under its own lip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { makeGround } from '../src/world/voxels.js';
import { makeNav, navOf, walkable } from '../src/sim/ai/nav.js';
import { polar } from '../src/sim/placement.js';
import { dig } from '../src/sim/dig.js';
import { initFeet } from '../src/sim/gait.js';
import { blocked } from '../src/sim/sight.js';

const { hypot } = Math;
const MESA = { kind: 'mesa', at: [0, 400], r: 80, top: 60, lip: 0 }, c = polar([0, 400]);
const inMesa = ([x, , z]) => hypot(x - c.x, z - c.z) < 72;

test('the way from one side of a mesa to the other goes round it, not over', () => {
  const nav = makeNav(makeGround(1, { flat: true }, { ground: { landmarks: [MESA] } }));
  const p = nav.path(c.x + 150, 0, c.z - 150, c.x - 150, 0, c.z + 150);
  assert.ok(p && p.length > 5, 'there is a way');
  assert.ok(p.every(w => w[1] < 5 && !inMesa(w)), `on the ground all the way: ${p.map(w => w.map(Math.round).join(',')).join(' ')}`);
  const end = p[p.length - 1];
  assert.ok(hypot(end[0] - (c.x - 150), end[2] - (c.z + 150)) < 32, 'to where it was going');
});

test('a tunnel through the mesa is a way in; the mesa\'s top is a floor of its own', () => {
  const ter = makeGround(1, { flat: true }, { ground: { landmarks: [MESA, { kind: 'tunnel', from: [0, 250, 12], to: [0, 550, 12], r: 12 }] } }), nav = makeNav(ter);
  assert.equal(nav.floorsAt(c.x, c.z).length, 2, 'the tunnel floor and the top');
  const p = nav.path(c.x, 0, c.z - 200, c.x, 0, c.z);
  assert.ok(p && p.some(inMesa) && p.every(w => w[1] < 5), `in by the tunnel: ${p && p.map(w => w.map(Math.round).join(',')).join(' ')}`);
  assert.equal(nav.path(c.x, 0, c.z - 200, c.x, 60, c.z), null, 'the top: no way up the cliff');
});

test('a wall with no way through has no path; dig a hole in it and there is one', () => {
  const G = createTestGame();
  for (const e of foes(G)) freeze(e);
  G.ter.block(40, 56, -1150, 1150, 14);   // 16 m thick: at 8 m cells a thinner one has no solid corner inside
  const nav = navOf(G);
  assert.equal(nav.path(0, 0, 0, 120, 0, 0, 800), null);
  for (let z = -8; z <= 8; z += 8) for (const x of [44, 52]) for (const y of [2, 9]) dig(G, [x, y, z], 7);
  assert.ok(walkable(G.ter, 30, 0, 0, 70, 0), 'the digs made a gap a mech fits through');
  assert.ok(nav.path(0, 0, 0, 120, 0, 0), 'the nav knows about it');
});

test('a foe hunting you from the far side of a mesa walks round it to you', () => {
  const G = createTestGame({ foes: ['jackal'] }), P = G.player, e = foes(G)[0];
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks: [MESA] } });
  Object.assign(P, { x: c.x, z: c.z - 160, yaw: 0 }); P.y = G.ter.groundBelow(P.x, 3, P.z); initFeet(G, P);
  P.hp.T = P.max.T = 1e9;
  Object.assign(e, { x: c.x, z: c.z + 160, yaw: Math.PI }); e.y = G.ter.groundBelow(e.x, 3, e.z); initFeet(G, e);
  e.ai.aware = true;
  let round = false, stuck = 0, last = [e.x, e.z];
  for (let t = 0; t < 60 && !round; t += 0.5) {
    stepFor(G, 0.5);
    round = e.z < c.z - 60 || (e.ai.seen && hypot(e.x - c.x, e.z - c.z) > 90 && e.z < c.z);   // past the mesa, on your side
    if (hypot(e.x - last[0], e.z - last[1]) < 0.5 && e.throttle > 0) stuck++;
    last = [e.x, e.z];
  }
  assert.ok(round, `it came round to your side: at ${e.x.toFixed(0)}, ${e.z.toFixed(0)}`);
  assert.ok(stuck < 6, `and never stood grinding into the rock (${stuck} half-seconds)`);
});

test('a foe up on a mesa can\'t see a mech under its lip', () => {
  const G = createTestGame({ foes: ['jackal'] }), P = G.player, e = foes(G)[0];
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks: [{ kind: 'mesa', at: [0, 400], r: 50, top: 60, lip: 24 }] } });
  // At the lip's edge: its top 2 m in from where it drops away (the 4 m ground's edge is sharp, docs/specs/29-ground-4m.md).
  let ez = c.z - 60;
  while (G.ter.groundBelow(c.x, 80, ez - 1) > 55) ez--;
  Object.assign(e, { x: c.x, z: ez + 2 }); e.y = G.ter.groundBelow(e.x, 80, e.z); initFeet(G, e);
  assert.ok(e.y > 55, 'up on top, at the edge');
  Object.assign(P, { x: c.x, z: c.z - 62 }); P.y = G.ter.groundBelow(P.x, 20, P.z); initFeet(G, P);
  assert.ok(P.y < 3, 'and you under the lip below it');
  const eye = [e.x, e.y + 7, e.z], at = p => [p.x, p.y + 4, p.z];
  assert.equal(blocked(G, eye, at(P)), true, 'its own lip is in the way');
  Object.assign(P, { x: c.x, z: c.z - 160 }); P.y = G.ter.groundBelow(P.x, 20, P.z);
  assert.equal(blocked(G, eye, at(P)), false, 'out in the open: in sight');
});
