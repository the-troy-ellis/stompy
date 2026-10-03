import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { WEAPONS } from '../src/data/weapons.js';
import { initFeet } from '../src/sim/gait.js';

const setup = () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 120, yaw: Math.PI }); initFeet(G, e); freeze(e);
  G.player.pitch = -0.05;
  stepFor(G, 1);   // weapons start with a staggered cooldown
  return { G, e };
};
const scanning = input({ held: { fusion: true } });

test('three continuous seconds of scan fire the cannon: the target dies, the reactor overloads, the torso pays', () => {
  const { G, e } = setup();
  const P = G.player, T0 = P.hp.T;
  stepFor(G, 1, scanning);
  assert.equal(P.fusion.mech, e);
  assert.ok(P.fusion.t > 0.9);
  stepFor(G, 2.1, scanning);
  assert.ok(P.shutdown, 'no overload');
  assert.ok(P.heat <= WEAPONS.fusion.overload && P.heat > 100);
  assert.ok(Math.abs(P.hp.T - (T0 - P.max.T * WEAPONS.fusion.feedback)) < 1e-6);
  stepFor(G, 1.5);   // the pulse travels 120 m at 350 m/s
  assert.equal(e.alive, false);
  assert.ok(G.fx.calls('sfx.fusion').length >= 1);
});

test('a short slip pauses the scan; a long one or a different target resets it', () => {
  const { G, e } = setup();
  const P = G.player;
  stepFor(G, 1.5, scanning);
  const t1 = P.fusion.t;
  // Slip for 0.4 s: the target steps far out of the beam, then comes back.
  const z = e.z; e.z = 400; initFeet(G, e);
  stepFor(G, 0.4, scanning);
  assert.ok(P.fusion.slipping);
  e.z = z; initFeet(G, e);
  stepFor(G, 0.2, scanning);
  assert.ok(P.fusion.t > t1, 'the scan did not resume');
  // Slip for 0.6 s: start over.
  e.z = 400; initFeet(G, e);
  stepFor(G, 0.6, scanning);
  e.z = z; initFeet(G, e);
  stepFor(G, 0.1, scanning);
  assert.ok(P.fusion.t < 0.2, `scan kept ${P.fusion.t}`);
  assert.equal(e.alive, true);
});

test('letting go clears the scan and no pulse is launched', () => {
  const { G, e } = setup();
  stepFor(G, 2.5, scanning);
  stepFor(G, 1);
  assert.equal(G.player.fusion.on, false);
  assert.equal(G.player.fusion.t, 0);
  assert.equal(G.pulses.length, 0);
  assert.ok(e.alive);
});
