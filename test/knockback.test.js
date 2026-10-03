import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knock, massOf, KNOCK_MIN, KNOCK_MAX, RECOIL } from '../src/sim/knock.js';
import { blast, BLAST_R } from '../src/sim/missiles.js';
import { FEEL } from '../src/data/feel.js';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';

test('knockback scales by mass: a light mech flies, a heavy one shrugs, within the clamps', () => {
  const G = createTestGame({ foes: ['jackal', 'warden'] });
  const P = G.player, [j, w] = foes(G);
  const vj = knock(G, { target: j, attacker: P, base: 10, dir: [1, 0] });
  const vw = knock(G, { target: w, attacker: P, base: 10, dir: [1, 0] });
  assert.ok(vj > 10 && vw < 10, `${vj} ${vw}`);
  assert.ok(Math.abs(vj - 10 * massOf(P) / massOf(j)) < 1e-9);
  assert.ok(Math.abs(P.push[0] - (-(vj + vw) * RECOIL)) < 1e-9, 'attacker recoil');
  // Clamps.
  const tiny = { ch: { scale: 0.2 }, yaw: 0, twist: 0, pitch: 0, push: [0, 0] }, huge = { ch: { scale: 5 }, yaw: 0, twist: 0, pitch: 0, push: [0, 0] };
  assert.ok(Math.abs(knock(G, { target: tiny, attacker: P, base: 10, dir: [1, 0] }) - 10 * KNOCK_MAX) < 1e-9);
  assert.ok(Math.abs(knock(G, { target: huge, attacker: P, base: 10, dir: [1, 0] }) - 10 * KNOCK_MIN) < 1e-9);
  assert.equal(knock(G, { target: j, attacker: P, base: 0, dir: [1, 0] }), 0);
});

test('a shoved mech skids that way and its aim jolts toward the blow, then it comes to rest', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 100, yaw: 0, twist: 0 }); initFeet(G, e); freeze(e);
  knock(G, { target: e, attacker: G.player, base: 10, dir: [1, 0] });
  assert.ok(e.twist !== 0 && e.pitch > 0, 'no aim jolt');
  stepFor(G, 2);
  assert.ok(e.x > 2, `skidded ${e.x}`);
  assert.ok(Math.hypot(...e.push) < 0.05, 'still sliding');
});

test('a missile blast shoves mechs away from it, falling off with distance, never the firer', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal', 'jackal'] });
  const P = G.player, [a, b, c] = foes(G);
  Object.assign(a, { x: 200, z: 0 }); Object.assign(b, { x: 300, z: 0 }); Object.assign(c, { x: 400, z: 0 });
  for (const m of [a, b, c]) { initFeet(G, m); freeze(m); }
  blast(G, [200 - 3, 3, 0], 1, P, null);        // just off a's left side (the mech's -x)
  blast(G, [300 - 3 - 7, 3, 0], 1, P, null);    // 7 m further out from b
  blast(G, [400 - 3 - BLAST_R - 1, 3, 0], 1, P, null);
  assert.ok(a.push[0] > 0 && b.push[0] > 0 && a.push[0] > b.push[0], `pushes ${a.push[0]} ${b.push[0]}`);
  assert.ok(Math.abs(c.push[0]) < 1e-9, 'out of range yet pushed');
  assert.equal(FEEL.blast.push, 4);
  assert.ok(Math.hypot(...P.push) < 1e-6, 'the firer was pushed');
});
