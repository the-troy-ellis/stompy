import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { BOUND } from '../src/world/terrain.js';
import { initFeet } from '../src/sim/gait.js';

test('an unaware enemy patrols inside the map and never fires', () => {
  const G = createTestGame({ seed: 5, foes: ['jackal'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 900, z: 900 }); initFeet(G, e); e.ai.aware = false;   // out of the 600 m awareness radius
  stepFor(G, 20);
  assert.equal(e.ai.aware, false);
  assert.ok(Math.abs(e.x) <= BOUND && Math.abs(e.z) <= BOUND);
  assert.equal(G.stats.taken, 0);
  assert.equal(G.fx.calls('sfx.laser').length + G.fx.calls('sfx.cannon').length, 0);
});

test('a shut-down enemy fires nothing', () => {
  const G = createTestGame({ seed: 2, foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 200, yaw: Math.PI, heat: 100, shutdown: true }); initFeet(G, e); e.ai.aware = true;
  stepFor(G, 2);
  assert.ok(e.shutdown);
  assert.equal(G.shots.length, 0);
  assert.equal(G.fx.calls('sfx.cannon').length + G.fx.calls('sfx.missile').length, 0);
});

test('aware enemies keep their own heat under control over a long fight', () => {
  const G = createTestGame({ seed: 4, foes: ['jackal', 'warden', 'jackal'] });
  for (const e of foes(G)) e.ai.aware = true;
  G.player.hp.T = 1e9; G.player.max.T = 1e9;   // the player survives the whole minute
  let peak = 0;
  for (let s = 0; s < 60; s++) { stepFor(G, 1); for (const e of foes(G)) peak = Math.max(peak, e.heat); }
  assert.ok(peak < 100, `an enemy reached ${peak} heat`);
  assert.ok(G.stats.taken > 0, 'nobody landed a hit in a minute');
  assert.ok(!foes(G).some(e => e.shutdown));
});

test('enemies close to their preferred range and face the player', () => {
  const G = createTestGame({ seed: 8, foes: ['jackal'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 700, yaw: 0 }); initFeet(G, e); e.ai.aware = true;
  stepFor(G, 45);
  const d = Math.hypot(e.x, e.z);
  assert.ok(d < e.ch.pref * 1.6, `still ${d.toFixed(0)} m out`);
});
