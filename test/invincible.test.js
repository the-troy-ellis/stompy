import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { damage, invincible } from '../src/sim/combat.js';
import { initFeet } from '../src/sim/gait.js';

const hitAll = (G, m, amt) => { for (const [dx, dy] of [[0, 4], [1, 1], [-1, 1], [2, 5], [-2, 5]]) damage(G, m, [m.x + dx, m.y + dy * m.ch.scale, m.z], amt, null); };

test('INVINCIBLE (?debug=1): your mech is hit but not hurt, and it still feels it', () => {
  const G = createTestGame();
  const P = G.player, hp = { ...P.hp };
  G.invincible = true;
  for (let i = 0; i < 20; i++) hitAll(G, P, 50);
  assert.deepEqual(P.hp, hp);
  assert.ok(P.alive);
  assert.ok(G.fx.calls('sfx.clang').length > 0, 'the hits still clang');
  assert.ok(G.parts.length > 0, 'and still spark');
});

test('INVINCIBLE only covers your own mech, only in single player, and only while on', () => {
  const G = createTestGame();
  const P = G.player, e = foes(G)[0];
  G.invincible = true;
  hitAll(G, e, 3);
  assert.ok(Object.keys(e.hp).some(k => e.hp[k] < e.max[k]), 'enemies still take damage');
  G.mode = 'mp'; assert.equal(invincible(G, P), false, 'not in the arena');
  G.mode = 'coop'; assert.equal(invincible(G, P), false, 'not in co-op');
  G.mode = 'sp'; G.invincible = false;
  const sum = () => Object.values(P.hp).reduce((a, b) => a + b, 0), before = sum();
  hitAll(G, P, 2);
  assert.ok(sum() < before, 'off: hits hurt again');
});

test('INVINCIBLE: the fusion cannon\'s feedback costs no torso either', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 120, yaw: Math.PI }); initFeet(G, e); freeze(e);
  G.player.pitch = -0.05; G.invincible = true;
  stepFor(G, 1);
  const T = P.hp.T;
  stepFor(G, 3.2, input({ held: { fusion: true } }));
  assert.ok(P.shutdown, 'it fired');
  assert.equal(P.hp.T, T);
});
