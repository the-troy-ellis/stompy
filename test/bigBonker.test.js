import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center } from '../src/sim/geom.js';
import { fire } from '../src/sim/combat.js';
import { applyLoadout, choicesFor, validate } from '../src/sim/loadout.js';
import { WEAPONS, CAT_OF } from '../src/data/weapons.js';
import { CHASSIS } from '../src/data/chassis.js';
import { FEEL } from '../src/data/feel.js';

const D = WEAPONS.gauss;

test('BIG BONKER is a ballistic weapon, and at 12 t a KESTREL can carry it in place of the cannon', () => {
  assert.equal(CAT_OF.gauss, 'ballistic');
  assert.ok(choicesFor(CHASSIS.kestrel.hardpoints[2]).includes('gauss'));
  assert.ok(validate('kestrel', { hp: { la: 'laser', ra: 'laser', t1: 'gauss', t2: 'lrm' }, sys: { sinks: 0, armour: 0, jets: 1 } }).ok);
  assert.ok(FEEL.fireGauss);
});

test('it hits for 20, knocks a JACKAL at least 3 m, and rocks the shooter back', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 300, yaw: Math.PI }); initFeet(G, e); freeze(e);
  e.hp.T = 1e9; e.max.T = 1e9; e.hp.LA = e.hp.RA = e.hp.LL = e.hp.RL = 1e9;
  applyLoadout(G, P, { hp: { la: null, ra: null, t1: 'gauss', t2: null }, sys: { sinks: 0, armour: 0, jets: 1 } });
  e.hp.T = 1e9; e.max.T = 1e9; e.hp.LA = e.hp.RA = e.hp.LL = e.hp.RL = 1e9;
  const w = P.weapons.find(x => x.type === 'gauss'); w.cd = 0;
  const z0 = P.z, hp0 = Object.values(e.hp).reduce((a, v) => a + v, 0);
  assert.ok(fire(G, P, w, center(e), e));
  assert.ok(P.push[1] < -1, `no recoil (${P.push[1]})`);
  stepFor(G, 0.6);
  assert.ok(P.z < z0 - 0.3, `the shooter should rock back a step (${(z0 - P.z).toFixed(2)} m)`);
  const lost = hp0 - Object.values(e.hp).reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(lost - D.dmg) < 1e-6, `took ${lost}`);
  stepFor(G, 1.5);
  assert.ok(e.z - 300 >= 3, `the JACKAL moved only ${(e.z - 300).toFixed(2)} m`);
  assert.equal(w.ammo, D.ammo - 1);
});

test('an enemy firing it rocks back too', () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 300, yaw: Math.PI }); initFeet(G, e);
  applyLoadout(G, e, { hp: { t1: 'lrm', ra: 'gauss', la: 'laser' }, sys: { sinks: 0, armour: 0, jets: 1 } });
  const w = e.weapons.find(x => x.type === 'gauss'); w.cd = 0;
  assert.ok(fire(G, e, w, center(G.player), G.player));
  assert.ok(e.push[1] > 0.5, 'facing -z, it should be pushed +z');
});
