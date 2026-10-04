import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet, restCyc } from '../src/sim/gait.js';
import { CHASSIS, MECH_ORDER } from '../src/data/chassis.js';
import { NAMES } from '../src/data/names.js';
import { GEO, geoFor } from '../src/data/geo.js';
import { stockLoadout, validate } from '../src/sim/loadout.js';
import { cover, harassStomp } from '../src/sim/ai/behaviours.js';
import { planFor } from '../src/sim/ai/profiles.js';
import { BEHAVIOUR as B } from '../src/data/ai.js';

const ch = CHASSIS.light1;

test('PIPSQUEAK (light1): the spec numbers, boosted jets stock, a placeholder name, selectable', () => {
  assert.equal(NAMES.chassis.light1, 'PIPSQUEAK');
  assert.equal(NAMES.roles.light1.role, 'REVERSE-JOINT · SMALL, RUDE');
  assert.ok(MECH_ORDER.includes('light1'));
  assert.equal(ch.legs, 'reverse');
  assert.equal(ch.scale, 0.8); assert.equal(ch.speed, 22); assert.equal(ch.turn, 1.9); assert.equal(ch.sink, 8);
  assert.deepEqual(ch.hp, { T: 28, LA: 12, RA: 12, LL: 16, RL: 16 });
  assert.deepEqual(stockLoadout('light1'), { hp: { la: 'srm', ra: 'mlaser', t1: 'mg' }, sys: { sinks: 0, armour: 0, jets: 2, knuckles: 0 } });
  assert.ok(validate('light1', stockLoadout('light1')).ok);
  const g = geoFor(ch);
  assert.equal(g.l1, 2.4); assert.equal(g.l2, 2.9); assert.equal(g.swing, 0.46);
  assert.ok(g.hip < GEO.reverse.hip, 'the hip sits lower');
  assert.ok(g.stride[0] > GEO.reverse.stride[0] && g.stride[1] > GEO.reverse.stride[1], 'a longer stride');
});

test('a longer swing still starts and lands with every foot planted', () => {
  const g = geoFor(ch), c = restCyc(g);
  for (const l of g.legs) assert.ok((((c - l.ph) % 1) + 1) % 1 >= g.swing, `leg at phase ${l.ph} is mid-swing at ${c}`);
  assert.equal(restCyc(GEO.reverse), 0.45, 'the stock plans keep their old rest point');
});

test('it gets shoved a very long way: further than a JACKAL', () => {
  const shove = type => {
    const G = createTestGame({ foes: [type] });
    const e = foes(G)[0];
    Object.assign(e, { x: 0, z: 7, yaw: Math.PI, twist: 0 }); initFeet(G, e); freeze(e);
    stepFor(G, 0.5);
    stepFor(G, 1 / 60, input({ punch: true }));
    stepFor(G, 1.5);
    return e.z - 7;
  };
  const p = shove('light1'), j = shove('jackal');
  assert.ok(p > j * 1.1 && p > 8, `PIPSQUEAK ${p.toFixed(1)} m vs JACKAL ${j.toFixed(1)} m`);
});

test('its AI breaks off at half torso, where the JACKAL\'s would not', () => {
  const G = createTestGame({ foes: ['light1'] });
  const e = foes(G)[0], ctx = { P: G.player, dist: 150, toYaw: 0 };
  const plan = planFor(e);
  assert.equal(plan.drive.length, 2);
  const look = (frac, drv) => { e.ai.cover = null; e.ai.coverLookT = 0; e.heat = 0; e.hp.T = e.max.T * frac; drv(G, e, ctx); return e.ai.coverLookT > 0; };
  assert.ok(look(0.45, plan.drive[0]), 'at 45% it looks for cover');
  assert.ok(!look(0.55, plan.drive[0]), 'at 55% it keeps fighting');
  assert.ok(!look(0.45, cover({ hurt: false })), 'the JACKAL\'s only hides from heat');
});

test('it dives to stomp: over its target it cuts the jets and drops', () => {
  const G = createTestGame({ foes: ['light1'] });
  const e = foes(G)[0];
  e.ai.jump = { until: G.time + 1, yaw: 0 };
  e.air = true;
  const far = harassStomp(G, e, { dist: 20, toYaw: 0.3, seen: true }, 1 / 60);
  assert.ok(far.jets && far.thr === 1 && far.moveYaw === 0.3, 'still flying at the target');
  const over = harassStomp(G, e, { dist: B.stompOver - 1, toYaw: 0.3, seen: true }, 1 / 60);
  assert.ok(!over.jets && over.thr === 0, 'right on top: drop');
});
