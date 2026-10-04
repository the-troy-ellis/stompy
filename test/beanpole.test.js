import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center } from '../src/sim/geom.js';
import { fire } from '../src/sim/combat.js';
import { CHASSIS, MECH_ORDER } from '../src/data/chassis.js';
import { NAMES } from '../src/data/names.js';
import { GEO, geoFor } from '../src/data/geo.js';
import { stockLoadout, validate, sysMax } from '../src/sim/loadout.js';
import { ridgeRelocate, findRidge } from '../src/sim/ai/behaviours.js';
import { planFor } from '../src/sim/ai/profiles.js';
import { BEHAVIOUR as B } from '../src/data/ai.js';

const { hypot } = Math;
const ch = CHASSIS.sniper1;
const wall = (G, lo, hi, h) => { const base = G.ter.height; G.ter = { ...G.ter, height: (x, z) => (x > lo && x < hi ? h : base(x, z)) }; };

test('BEANPOLE (sniper1): the spec numbers, tall legs and a narrow stance, a placeholder name, selectable', () => {
  assert.equal(NAMES.chassis.sniper1, 'BEANPOLE');
  assert.equal(NAMES.roles.sniper1.role, 'FORWARD-JOINT · LONG GUN, LONG LEGS');
  assert.ok(MECH_ORDER.includes('sniper1'));
  assert.equal(ch.speed, 13); assert.equal(ch.turn, 0.9); assert.equal(ch.sink, 11); assert.equal(ch.scale, 1);
  assert.deepEqual(ch.hp, { T: 60, LA: 26, RA: 26, LL: 36, RL: 36 });
  assert.deepEqual(stockLoadout('sniper1').hp, { ra: 'gauss', la: 'ppc', t1: 'mlaser' });
  assert.equal(stockLoadout('sniper1').sys.jets, 0, 'no jets stock');
  assert.equal(sysMax('sniper1', 'jets'), 1, 'the slot allows level 1');
  assert.ok(validate('sniper1', stockLoadout('sniper1')).ok);
  const g = geoFor(ch);
  assert.equal(g.hip, 5.4); assert.equal(g.l1, 3.0); assert.equal(g.l2, 2.8);
  assert.ok(g.height > GEO.forward.height, 'taller');
  assert.ok(Math.abs(g.legs[0].fx) < Math.abs(GEO.forward.legs[0].fx), 'a narrower stance');
});

test('after three shots from one spot it picks a ridge at least 60 m away', () => {
  const G = createTestGame({ foes: ['sniper1'] });
  const P = G.player, e = foes(G)[0];
  wall(G, 100, 140, 25);   // a plateau east of the player, the length of the map
  const first = findRidge(G, e, P);
  Object.assign(e, { x: first.x, z: first.z }); initFeet(G, e); e.ai.aware = true;
  const ctx = { P, dist: hypot(P.x - e.x, P.z - e.z), toYaw: 0 };
  e.ai.shots = 2; e.ai.ridgeLookT = 0;
  ridgeRelocate(G, e, ctx, 1 / 60);
  assert.ok(!e.ai.ridge || hypot(e.ai.ridge.x - e.x, e.ai.ridge.z - e.z) < B.relocateAway, 'two shots: it stays put');
  e.ai.shots = 3;
  const out = ridgeRelocate(G, e, ctx, 1 / 60);
  assert.ok(e.ai.ridge, 'no new ridge');
  assert.ok(hypot(e.ai.ridge.x - e.x, e.ai.ridge.z - e.z) >= B.relocateAway, 'moved on');
  assert.ok(out && out.thr === 1, 'and walks there');
});

test('it counts its shots, and never squares up to punch: in reach it backs off', () => {
  const G = createTestGame({ foes: ['sniper1'] });
  const P = G.player, e = foes(G)[0];
  assert.equal(planFor(e).noMelee, true);
  P.hp.T = 1e9; P.max.T = 1e9;
  Object.assign(e, { x: 0, z: 9, yaw: Math.PI, twist: 0 }); initFeet(G, e);
  e.ai.aware = true; e.ai.seen = true;
  let swung = false;
  const z0 = e.z;
  for (let i = 0; i < 120; i++) { stepFor(G, 1 / 60); swung ||= !!e.melee; }
  assert.ok(!swung, 'it threw a punch');
  assert.ok(hypot(e.x, e.z) > z0, `it should back away (${hypot(e.x, e.z).toFixed(1)} m)`);
});

test('BIG BONKER\'s recoil rocks it: the wobble shows on the shooter, not only on the player', () => {
  const G = createTestGame({ foes: ['sniper1'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 300, yaw: Math.PI, twist: 0 }); initFeet(G, e);
  stepFor(G, 0.2);
  const w = e.weapons.find(x => x.type === 'gauss'); w.cd = 0;
  const shots0 = e.ai.shots || 0;
  assert.ok(fire(G, e, w, center(G.player), G.player));
  assert.ok(Math.abs(e.wob.p.v) > 0.3, `wobble ${e.wob.p.v}`);
  assert.equal(e.ai.shots || 0, shots0, 'only the AI\'s own decisions count shots');
});
