import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { meleeGhost } from '../src/sim/melee.js';
import { DEFAULT_MELEE } from '../src/data/melee.js';
import { massOf, KNOCK_MAX } from '../src/sim/knock.js';

// A foe standing in for another pilot: the arena's client marks it remote,
// and the sim then reports what it does to it rather than applying it.
function arena(chassis = 'jackal') {
  const G = createTestGame({ foes: [chassis] }), fx = G.fx;
  G.mode = 'mp';
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 7, yaw: Math.PI, remote: true, netId: 2, team: 0 }); initFeet(G, e); freeze(e);
  e.net = { x: e.x, y: e.y, z: e.z, yaw: e.yaw, tw: 0, p: 0, sp: 0, air: 0, al: 1, sd: 0, pu: 0, at: G.clock };
  return { G, fx, e };
}

test('punching another pilot announces the swing and queues damage, knockback and the melee flag', () => {
  const { G, fx, e } = arena();
  const P = G.player, hp = { ...e.hp };
  stepFor(G, 1 / 60, input({ punch: true }));
  assert.ok(fx.calls('netSend').some(c => c.args[0].t === 'fx' && c.args[0].k === 'pu'), 'fx pu sent at the press');
  stepFor(G, DEFAULT_MELEE.windup + 0.05);
  const q = G.pendingHits.get(2);
  assert.ok(q, 'a pending hit for pilot 2');
  assert.equal(q.amt, DEFAULT_MELEE.dmg);
  assert.equal(q.me, 1);
  assert.ok(!q.st);
  const v = Math.hypot(q.kb[0], q.kb[1]), ratio = Math.min(KNOCK_MAX, massOf(P) / massOf(e));
  assert.ok(Math.abs(v - DEFAULT_MELEE.knock * ratio) < 0.01, `kb ${v} vs ${DEFAULT_MELEE.knock * ratio}`);
  assert.ok(q.kb[1] > 0, 'pushed away from the puncher (+z)');
  assert.deepEqual(e.hp, hp, 'the remote copy is not damaged here');
  assert.ok(Math.hypot(...e.push) < 0.01, 'the remote copy is not pushed here');
  assert.ok(Math.hypot(...P.push) > 0.1, 'the puncher still recoils');
});

test('a remote swing animates from the reported phase and times itself out', () => {
  const { G, e } = arena();
  meleeGhost(e, 0, 1);
  assert.equal(e.melee.phase, 'windup');
  meleeGhost(e, DEFAULT_MELEE.windup + 0.01, 1);
  assert.equal(e.melee.phase, 'recover', 'rolls into recovery on its own between reports');
  meleeGhost(e, 0, 2);
  assert.equal(e.melee.phase, 'recover');
  meleeGhost(e, DEFAULT_MELEE.recover + 0.01, 2);
  assert.equal(e.melee, null, 'over once the recovery has run');
  meleeGhost(e, 0, 1); meleeGhost(e, 0.01, 0);
  assert.equal(e.melee.phase, 'windup', 'a stale 0 does not cancel a wind-up');
  meleeGhost(e, DEFAULT_MELEE.windup, 0);
  assert.equal(e.melee.phase, 'recover', 'the wind-up rolls over on its own');
  meleeGhost(e, 0.01, 0);
  assert.equal(e.melee, null, 'and the next 0 clears the recovery');
  e.net.pu = 1;
  stepFor(G, 1 / 60);
  assert.equal(e.melee?.phase, 'windup', 'update() drives it from the state report');
});
