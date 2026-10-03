import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { MELT_T, MELT_MAX, meltMult, coolArmour } from '../src/sim/beams.js';
import { initFeet } from '../src/sim/gait.js';

test('the melt curve runs 1x to MELT_MAX over MELT_T seconds, monotonically', () => {
  assert.equal(meltMult(0), 1);
  assert.equal(meltMult(MELT_T), MELT_MAX);
  assert.equal(meltMult(MELT_T * 2), MELT_MAX);
  let last = 1;
  for (let t = 0; t <= MELT_T; t += 0.1) { const m = meltMult(t); assert.ok(m >= last); last = m; }
});

test('armour cools from full melt to cold in 2 s when nothing is on it', () => {
  const G = createTestGame();
  const e = foes(G)[0];
  e.melt = MELT_T; e.meltAt = -1;
  for (let k = 0; k < 120; k++) { G.time += 1 / 60; coolArmour(G, 1 / 60); }
  assert.ok(e.melt < 1e-6);
});

test('a held beam on a mech ahead heats the shooter, melts and damages the target', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 100, yaw: Math.PI }); initFeet(G, e); freeze(e);
  P.pitch = -0.06;
  const total = m => Object.values(m.hp).reduce((a, v) => a + v, 0);
  const hp0 = total(e);
  stepFor(G, 2, input({ held: { energy: true } }));
  assert.ok(P.beaming, 'not beaming');
  assert.equal(P.beamMech, e);
  assert.ok(e.melt > 1.5, `melt ${e.melt}`);
  assert.ok(total(e) < hp0, 'no damage');
  assert.ok(P.heat > 20, `heat ${P.heat}`);
  assert.equal(G.fx.calls('sfx.laser').length, 1);   // one sound when the beam starts, not per frame
  stepFor(G, 0.5);
  assert.equal(P.beaming, false);
});
