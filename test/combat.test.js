import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, foes, stepFor } from './helpers.js';
import { sectionHit, damage } from '../src/sim/combat.js';
import { geoOf } from '../src/data/geo.js';
import { VOICE } from '../src/data/voice.js';

test('sectionHit routes by height and lateral offset in torso space', () => {
  const G = createTestGame();
  const P = G.player, g = geoOf(P);             // at the origin, facing +z, no twist
  assert.equal(sectionHit(P, [1, 1, 0]), 'LL');  // low, +x is the mech's left
  assert.equal(sectionHit(P, [-1, 1, 0]), 'RL');
  assert.equal(sectionHit(P, [0, g.legTop + 1, 0]), 'T');
  assert.equal(sectionHit(P, [2.5, g.legTop + 1, 0]), 'LA');
  assert.equal(sectionHit(P, [-2.5, g.legTop + 1, 0]), 'RA');
  P.twist = Math.PI / 2;                        // torso turned left (toward +x): its right arm now points +z
  assert.equal(sectionHit(P, [0, g.legTop + 1, 2.5]), 'RA');
});

test('damage drains the section, kills its weapons at zero and spills over into the torso', () => {
  const G = createTestGame();
  const e = foes(G)[0], g = geoOf(e), arm = [e.x + 2.5 * e.ch.scale, e.y + (g.legTop + 1) * e.ch.scale, e.z];
  e.yaw = 0; e.twist = 0;
  const la = e.weapons.find(w => w.mount === 'LA');
  damage(G, e, arm, 5, G.player);
  assert.equal(e.hp.LA, e.max.LA - 5);
  assert.equal(la.dead, false);
  assert.equal(G.stats.hits, 1);
  damage(G, e, arm, e.max.LA, G.player);        // 5 more than the arm had left
  assert.equal(e.hp.LA, 0);
  assert.equal(la.dead, true);
  assert.equal(e.hp.T, e.max.T - 5);
  assert.ok(e.alive);
  damage(G, e, arm, 1, G.player);               // a dead section forwards to the torso
  assert.equal(e.hp.T, e.max.T - 6);
});

test('torso at zero destroys the mech, leaves a wreck and ends a one-enemy match', () => {
  const G = createTestGame();
  const e = foes(G)[0];
  damage(G, e, [e.x, e.y + 5, e.z], 1000, G.player);
  assert.equal(e.alive, false);
  assert.ok(e.dying, 'the fall is staged');
  assert.equal(G.stats.kills, 1);
  assert.equal(G.state, 'over');
  assert.equal(G.won, true);
  stepFor(G, 1.2);   // beat, blast, topple
  assert.equal(G.wrecks.length, 1);
  assert.ok(G.fx.calls('sfx.boom').length >= 2);
  assert.ok(G.fx.calls('say').some(c => VOICE.kill.includes(c.args[0])));
});

test('the player taking damage records stats, flashes, and auto-targets the attacker', () => {
  const G = createTestGame();
  const P = G.player, e = foes(G)[0];
  damage(G, P, [P.x, P.y + 5, P.z], 7, e);
  assert.equal(G.stats.taken, 7);
  assert.ok(G.flash > 0 && G.shake > 0);
  assert.equal(G.target, e);
  assert.equal(G.fx.calls('sfx.clang').length, 1);
  damage(G, P, [P.x, P.y + 5, P.z], 1000, e);
  assert.equal(P.alive, false);
  assert.equal(G.state, 'over');
  assert.equal(G.won, false);
});
