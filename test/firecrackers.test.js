import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center } from '../src/sim/geom.js';
import { fire } from '../src/sim/combat.js';
import { applyLoadout, choicesFor } from '../src/sim/loadout.js';
import { WEAPONS, CAT_OF } from '../src/data/weapons.js';
import { CHASSIS } from '../src/data/chassis.js';
import * as Proto from '../src/net/protocol.js';

const D = WEAPONS.srm;
const fitted = (G, m) => applyLoadout(G, m, { hp: { la: 'laser', ra: 'laser', t1: 'ac', t2: 'srm' }, sys: { sinks: 0, armour: 0, jets: 1 } });

test('FIRECRACKERS is a missile weapon any missile hardpoint can take', () => {
  assert.equal(CAT_OF.srm, 'missile');
  assert.ok(choicesFor(CHASSIS.kestrel.hardpoints[3]).includes('srm'));
  assert.ok(choicesFor(CHASSIS.warden.hardpoints[0]).includes('srm'));
  assert.equal(D.homing, false);
});

test('a volley is six missiles that fly straight even with a lock, and every hit shoves', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 90, yaw: Math.PI }); initFeet(G, e); freeze(e);
  fitted(G, P);
  const w = P.weapons.find(x => x.type === 'srm'); w.cd = 0;
  assert.ok(fire(G, P, w, center(e), e));
  const volley = G.shots.filter(s => s.type === 'srm');
  assert.equal(volley.length, D.count);
  assert.ok(volley.every(s => s.target === null), 'dumb-fire: no target');
  assert.equal(w.ammo, D.ammo - 1);
  const hp0 = Object.values(e.hp).reduce((a, v) => a + v, 0);
  stepFor(G, 0.8);
  const hp1 = Object.values(e.hp).reduce((a, v) => a + v, 0);
  assert.ok(hp0 - hp1 > D.dmg * 2, `took only ${(hp0 - hp1).toFixed(1)}`);
  assert.ok(Math.hypot(e.x, e.z - 90) > 0.3, `a JACKAL hit by firecrackers should be shoved (moved ${Math.hypot(e.x, e.z - 90).toFixed(2)} m)`);
});

test('a volley fired past a target that walks out of the way does not curve after it', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 200, yaw: Math.PI }); initFeet(G, e); freeze(e);
  fitted(G, P);
  const w = P.weapons.find(x => x.type === 'srm'); w.cd = 0;
  fire(G, P, w, [60, 4, 200], e);   // aimed well to the side, the mech as the "target"
  const before = G.shots.filter(s => s.type === 'srm').map(s => s.v[0]);
  stepFor(G, 0.5);
  const after = G.shots.filter(s => s.type === 'srm').map(s => s.v[0]);
  for (let i = 0; i < after.length; i++) assert.ok(Math.abs(after[i] - before[i]) < 1e-9, 'a missile turned');
});

test('the AI fires them up close with no lock, unlike LRMs', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  P.hp.T = 1e9; P.max.T = 1e9;
  Object.assign(e, { x: 0, z: 80, yaw: Math.PI }); initFeet(G, e); e.ai.aware = true;
  applyLoadout(G, e, { hp: { t1: 'srm', ra: null, la: null }, sys: { sinks: 3, armour: 0, jets: 1 } });
  e.weapons.forEach(x => { x.cd = 0; });
  stepFor(G, 3);
  assert.ok(G.shots.some(s => s.type === 'srm' && s.owner === e) || e.weapons.find(x => x.type === 'srm').ammo < D.ammo, 'no volley at 80 m');
});

test('other screens draw six, not ten', () => {
  const m = Proto.fxMissiles([0, 0, 0], [0, 0, 1], 0, 3, 'srm');
  assert.equal(m.w, 'srm');
  assert.equal(Proto.fxMissiles([0, 0, 0], [0, 0, 1], 0, 3).w, 'lrm');
});
