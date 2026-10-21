// The brackets' diamond (docs/specs/13-thunk.md § the target brackets): a
// missile lock that means something, G.lockOn, is a lock while you carry
// missiles that can fly, and it chirps once as it comes on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';

const facing = (chassis = 'kestrel') => {
  const G = createTestGame({ chassis }), P = G.player, e = foes(G)[0];
  freeze(e); Object.assign(e, { x: 0, z: 200 }); e.y = 0;
  Object.assign(P, { x: 0, z: 0, yaw: 0, twist: 0, pitch: 0 });
  G.target = e;
  return G;
};
const chirps = G => G.fx.calls('sfx.lock').length;

test('a lock with missiles aboard is a lock that counts, and it chirps once', () => {
  const G = facing();
  stepFor(G, 0.5);
  assert.ok(G.lock && G.lockOn);
  assert.equal(chirps(G), 1);
  G.player.yaw = Math.PI / 2; stepFor(G, 0.2);
  assert.ok(!G.lockOn, 'looking away: open again');
  G.player.yaw = 0; stepFor(G, 0.2);
  assert.equal(chirps(G), 2, 'and it chirps again when it shuts');
});

test('no missiles, or none left, and the lock never shuts the brackets', () => {
  const G = facing('jackal');   // two lasers and the fusion
  stepFor(G, 0.5);
  assert.ok(G.lock && !G.lockOn);
  assert.equal(chirps(G), 0);
  const K = facing();
  for (const w of K.player.weapons) if (w.def.ammo) w.ammo = 0;
  stepFor(K, 0.5);
  assert.ok(!K.lockOn, 'out of missiles');
});
