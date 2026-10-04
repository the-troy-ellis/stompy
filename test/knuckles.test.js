import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { CHASSIS, MECH_ORDER } from '../src/data/chassis.js';
import { SYSTEMS, KNUCKLES_MULT } from '../src/data/systems.js';
import { FIST_MELEE, DEFAULT_MELEE, meleeOf } from '../src/data/melee.js';
import { applyLoadout, stockLoadout, systemsFor, tonsOf, validate } from '../src/sim/loadout.js';

const total = m => Object.values(m.hp).reduce((a, v) => a + v, 0);
const withKnuckles = { hp: { t1: 'ac', t2: 'srm' }, sys: { sinks: 0, armour: 0, jets: 0, knuckles: 1 } };

test('KNUCKLES is a 3 t slot that only a chassis with fists has, so FIT shows it only for PURPLE PUNCHER', () => {
  assert.equal(SYSTEMS.knuckles.tons, 3);
  assert.equal(SYSTEMS.knuckles.max, 1);
  for (const k of MECH_ORDER) assert.equal(systemsFor(k).includes('knuckles'), k === 'puncher', k);
  assert.equal(validate('kestrel', { hp: {}, sys: { knuckles: 1 } }).loadout.sys.knuckles, 0, 'no fists, no knuckles');
  const v = validate('puncher', withKnuckles);
  assert.equal(v.loadout.sys.knuckles, 1);
  assert.ok(v.ok, `${v.tons} t fits in ${CHASSIS.puncher.tons}`);
  assert.equal(tonsOf('puncher', withKnuckles) - tonsOf('puncher', stockLoadout('puncher')), 3);
  assert.equal(stockLoadout('puncher').sys.knuckles, 0, 'none stock');
});

test('fitted, the punch hits 1.5x as hard and shoves 1.5x as far', () => {
  const punch = lo => {
    const G = createTestGame({ chassis: 'puncher', foes: ['puncher'] });
    const P = G.player, e = foes(G)[0];
    applyLoadout(G, P, lo);
    Object.assign(e, { x: 0, z: 10, yaw: Math.PI, twist: 0 }); initFeet(G, e); freeze(e);
    stepFor(G, 0.5);
    const hp0 = total(e);
    stepFor(G, DT, input({ punch: true }));
    stepFor(G, 0.6);
    return { G, P, hurt: hp0 - total(e), def: meleeOf(P) };
  };
  const bare = punch(stockLoadout('puncher')), brass = punch(withKnuckles);
  assert.ok(Math.abs(bare.hurt - FIST_MELEE.dmg) < 1e-6);
  assert.ok(Math.abs(brass.hurt - FIST_MELEE.dmg * KNUCKLES_MULT) < 1e-6, `took ${brass.hurt}`);
  assert.equal(brass.def.knock, FIST_MELEE.knock * KNUCKLES_MULT);
  assert.equal(brass.def.reach, FIST_MELEE.reach, 'only damage and knock change');
  assert.equal(CHASSIS.puncher.melee.dmg, FIST_MELEE.dmg, 'the chassis table is untouched');
  brass.P.hp.LA = 0; brass.P.hp.RA = 0;
  assert.equal(meleeOf(brass.P), DEFAULT_MELEE, 'with no arms left there is nothing to put knuckles on');
});
