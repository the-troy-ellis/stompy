import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { meleeOf } from '../src/data/melee.js';
import { geoOf } from '../src/data/geo.js';

// The player, immortal and standing still, with one aware enemy at `z`.
function setup(chassis, z, seed = 3) {
  const G = createTestGame({ seed, foes: [chassis] });
  const P = G.player, e = foes(G)[0];
  P.hp.T = 1e9; P.max.T = 1e9;
  Object.assign(e, { x: 0, z, yaw: Math.PI }); initFeet(G, e); e.ai.aware = true;
  return { G, P, e };
}
const reachOf = (P, e) => meleeOf(P).reach * P.ch.scale + geoOf(e).radius * e.ch.scale;

test('on HARD an adjacent enemy punches the player within 3 s', () => {
  const { G, P, e } = setup('jackal', 6);
  G.diff = 'hard';
  stepFor(G, 3);
  assert.ok(G.fx.calls('sfx.punch').some(c => c.args[1] === true), 'no punch landed');
  assert.equal(P.lastHitMelee, 'punch');
  assert.ok(e.meleeCd > 0 || e.melee, 'the swing left a cooldown behind');
});

test('an enemy stays out of the player\'s reach while they are up', () => {
  const { G, P, e } = setup('jackal', 60);
  let inside = 0, frames = 0;
  for (let s = 0; s < 20; s++) {
    stepFor(G, 0.5);
    frames++;
    if (Math.hypot(e.x - P.x, e.z - P.z) < reachOf(P, e)) inside++;
  }
  assert.ok(inside <= 1, `inside reach ${inside} of ${frames} samples`);
  assert.equal(G.fx.calls('sfx.punch').length, 0);
});

test('a shut-down player gets walked up to and shoved', () => {
  const { G, P } = setup('jackal', 120, 7);
  P.shutdown = true; P.heat = 1000;   // out cold for the whole test
  stepFor(G, 12);
  assert.ok(G.fx.calls('sfx.punch').some(c => c.args[1] === true), 'nobody came to shove the sitting duck');
  assert.ok(Math.hypot(P.x, P.z) > 1, `the player did not move (${Math.hypot(P.x, P.z).toFixed(2)} m)`);
});

test('an enemy fires nothing while it is swinging', () => {
  const { G, e } = setup('jackal', 6);
  G.diff = 'hard';
  let shotWhileSwinging = false;
  for (let i = 0; i < 180; i++) {
    const n = G.fx.calls('sfx.laser').length + G.fx.calls('sfx.cannon').length + G.fx.calls('sfx.missile').length;
    stepFor(G, 1 / 60);
    const n2 = G.fx.calls('sfx.laser').length + G.fx.calls('sfx.cannon').length + G.fx.calls('sfx.missile').length;
    if (e.melee && n2 > n) shotWhileSwinging = true;
  }
  assert.equal(shotWhileSwinging, false);
});
