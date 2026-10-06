import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { damage } from '../src/sim/combat.js';
import { PLATE_DMG } from '../src/sim/effects.js';
import { HIT_STOP } from '../src/data/feel.js';
import { buildMechParts } from '../src/mesh/mechParts.js';
import { CHASSIS } from '../src/data/chassis.js';
import { listParticles } from '../src/sim/particles.js';

test('a shell on an arm throws sparks and knocks a plate loose; a light leg hit kicks dust and no plate; the crosshair stops for a beat', () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 40, yaw: Math.PI, twist: 0 }); initFeet(G, e); freeze(e);
  G.parts.clear(); G.debris = [];
  damage(G, e, [e.x + 3 * e.ch.scale, e.y + 8, e.z - 2], 11, G.player);   // high and out to its side: an arm
  assert.ok(listParticles(G).filter(p => p.kind === 'fire').length >= 6, 'no sparks');
  assert.ok(G.debris.some(d => d.part === 'plate'), 'no plate came off');
  assert.ok(G.hitStop > 0 && G.hitStop <= HIT_STOP, 'the crosshair should be holding');
  G.parts.clear(); G.debris = []; G.hitStop = 0;
  damage(G, e, [e.x + 0.5, e.y + 1, e.z - 2], PLATE_DMG - 1, G.player);   // low: a leg
  assert.ok(listParticles(G).some(p => p.kind === 'smoke' && p.p[1] < e.y + 1), 'no dust at the feet');
  assert.ok(!G.debris.some(d => d.part === 'plate'), 'a light hit should not shed a plate');
  stepFor(G, 0.2);
  assert.equal(G.hitStop, 0, 'the hold should be over');
});

test('a leg hit jolts the player harder than an arm hit of the same size', () => {
  const G = createTestGame();
  const P = G.player;
  P.hp.T = 1e9; P.max.T = 1e9;
  G.kick = 0; damage(G, P, [P.x + 3, P.y + 8, P.z + 2], 5, null); const arm = G.kick;
  G.kick = 0; damage(G, P, [P.x + 1, P.y + 1, P.z + 2], 5, null); const leg = G.kick;
  assert.ok(arm > 0 && leg > arm * 1.3, `leg ${leg} vs arm ${arm}`);
});

test('every chassis has a plate part for the debris to draw', () => {
  for (const [k, ch] of Object.entries(CHASSIS)) assert.ok(buildMechParts(ch).plate, `${k} has no plate`);
});
