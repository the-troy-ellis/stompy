// A JACKAL with your laser on it keeps its own beam steady. Being hit flips a
// harasser's strafe, and a beam is a hit every frame: the flip used to fire
// every frame, and the beam's drift rode the strafe timer it reset, so the
// enemy's beam jumped metres across you each frame while you held yours on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, input, DT } from './helpers.js';
import { update } from '../src/sim/update.js';

function duel(shoot) {
  const G = createTestGame({ foes: ['jackal'], seed: 3 });
  const P = G.player, e = G.mechs.find(m => m.team === 1);
  e.x = P.x; e.z = P.z + 150; e.yaw = Math.PI; e.ai.aware = true;
  const steps = [];
  let prev = null, last = null, flips = 0, side = e.ai.strafe;
  for (let i = 0; i < 600 && e.alive; i++) {
    P.twist = Math.atan2(e.x - P.x, e.z - P.z) - P.yaw; P.pitch = 0;
    G.aim = [e.x, e.y + 5, e.z];
    update(G, input({ held: { energy: shoot } }), DT);
    P.heat = 0; P.hp.T = P.max.T;   // keep the duel going
    const b = e.ai.beamAim, fresh = b && b !== last;   // aimed this frame (a new array), not left over from a burst
    if (fresh && prev) steps.push(Math.hypot(b[0] - prev[0], b[1] - prev[1], b[2] - prev[2]));
    prev = fresh ? b : null; last = b;
    if (e.ai.strafe !== side) { flips++; side = e.ai.strafe; }
  }
  return { worst: Math.max(...steps), flips, hit: e.ai.hitAt != null, n: steps.length };
}

test('under your beam, its beam drifts as smoothly as when nobody shoots it', () => {
  const calm = duel(false), hit = duel(true);
  assert.ok(hit.hit, 'the player hit it');
  assert.ok(hit.worst < 0.1, `its aim jumped ${hit.worst.toFixed(2)} m in one frame`);
  assert.ok(hit.worst < calm.worst * 2, `${hit.worst} under fire vs ${calm.worst} calm`);
});

test('a beam flips its strafe now and then, not every frame', () => {
  const { flips } = duel(true);
  assert.ok(flips >= 1 && flips <= 10, `${flips} flips in 10 s`);
});
