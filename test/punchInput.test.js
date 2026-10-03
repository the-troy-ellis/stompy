import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';

test('punchReady lights when a mech is in reach and in front, and goes dark mid-swing', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 40, yaw: Math.PI }); initFeet(G, e); freeze(e);
  stepFor(G, 1);
  assert.equal(G.punchReady, false);
  Object.assign(e, { x: 0, z: 7 }); initFeet(G, e);
  stepFor(G, 1 / 60);
  assert.equal(G.punchReady, true);
  stepFor(G, 1 / 60, input({ punch: true }));
  stepFor(G, 1 / 60);
  assert.equal(G.punchReady, false, 'not ready during the swing');
  assert.ok(P.melee);
});
