import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { startMission } from './harness.js';
import { MISSIONS } from '../src/data/missions.js';
import { COOP_EXTRA, COOP_RESPAWN } from '../src/data/coop.js';
import { coopDef } from '../src/sim/coopRules.js';
import { destroy, DEATH_BEAT, DEATH_BUCKLE, DEATH_TOPPLE } from '../src/sim/combat.js';
import { destroyEntity } from '../src/sim/entities.js';
import { newMech } from '../src/sim/state.js';
import { waveFoes } from '../src/sim/waves.js';
import { startCoop } from '../src/net/coop.js';

// Co-op's scaling and lives (#204, spec 09 § Scaling, § Death and respawn).
const DOWN = DEATH_BEAT + DEATH_BUCKLE + DEATH_TOPPLE + 0.2;
// A host with another pilot (a remote mech, as net/client.js keeps one).
function hostWithMate(G, at = [0, 40]) {
  const m = newMech(G, 'kestrel', 0, at[0], at[1], 0);
  Object.assign(m, { remote: true, netId: 2, mate: true, net: null });
  G.mechs.push(m);
  startCoop(G, 'host', 2);
  return m;
}

test('more pilots, more enemies where enemies are the point; never more hp', () => {
  const elim = MISSIONS.find(m => (m.objectives || []).some(o => o.type === 'eliminate' && !o.secondary));
  const three = coopDef(elim, 3);
  assert.deepEqual(three.foes.slice(elim.foes.length), [COOP_EXTRA, COOP_EXTRA], 'two extra light mechs, at the end');
  assert.equal(coopDef(elim, 1), elim, 'one pilot: the mission as it is');
  const destroyOnly = MISSIONS.find(m => (m.objectives || []).every(o => o.type !== 'eliminate' || o.secondary) && m.foes.length);
  assert.equal(coopDef(destroyOnly, 4), destroyOnly, 'structures and convoys: no extras');
  const G = createTestGame({ foes: ['jackal'] }), S = createTestGame({ foes: ['jackal'] });
  startCoop(G, 'host', 3);
  assert.deepEqual(waveFoes(G, ['warden']), ['warden', COOP_EXTRA, COOP_EXTRA], 'a wave gets them too');
  assert.deepEqual(waveFoes(S, ['warden']), ['warden'], 'solo: unchanged');
  const solo = foes(S)[0], co = newMech(G, COOP_EXTRA, 1, 0, 0, 0);
  assert.deepEqual(co.max, solo.max, 'the same armour');
  const guest = createTestGame({ foes: ['jackal'] });
  startCoop(guest, 'guest', 3);
  assert.deepEqual(waveFoes(guest, ['warden']), ['warden'], 'only the host adds them');
});

test('down in co-op is not out: back at the start after 45 s with full armour and the ammo it had', () => {
  const G = createTestGame({ foes: ['jackal'] }), P = G.player;
  freeze(foes(G)[0]);
  hostWithMate(G);
  const ammo = P.weapons.find(w => w.def.ammo);
  ammo.ammo = 3;
  P.x = 200; P.z = 200;
  destroy(G, P, null);
  stepFor(G, DOWN);
  assert.equal(G.state, 'play', 'the mission goes on');
  assert.ok(!P.alive);
  stepFor(G, COOP_RESPAWN - DOWN - 1);
  assert.ok(!P.alive, 'not yet');
  stepFor(G, 1.5);
  assert.ok(P.alive, 'back');
  assert.deepEqual([P.x, P.z], [G.startAt.x, G.startAt.z], 'at the start');
  assert.deepEqual(P.hp, P.max, 'full armour');
  assert.equal(ammo.ammo, 3, 'no refill');
  assert.ok(G.fx.calls('netSend').some(c => c.args[0].t === 'died'), 'the others hear of it');
});

test('an objective changing brings a downed pilot back at once', () => {
  // A mission whose second objective waits on the first: the first done, the mission goes on.
  const n = MISSIONS.findIndex(m => (m.objectives || []).some(o => o.after != null) && m.objectives[0].type === 'destroy');
  const G = startMission(n), P = G.player;
  for (const m of G.mechs) if (m.team) freeze(m);
  hostWithMate(G, [P.x + 30, P.z]);
  destroy(G, P, null);
  stepFor(G, DOWN);
  for (const e of G.objectives[0].targets) destroyEntity(G, e, null);
  stepFor(G, 0.2);
  assert.equal(G.state, 'play');
  assert.ok(P.alive, 'the first objective done: back up, long before 45 s');
});

test('everyone down at once fails it; a host alone keeps the single-player rule', () => {
  const G = createTestGame({ foes: ['jackal'] });
  freeze(foes(G)[0]);
  const mate = hostWithMate(G);
  destroy(G, G.player, null);
  stepFor(G, 0.5);
  assert.equal(G.state, 'play', 'one still standing');
  mate.alive = false;
  stepFor(G, 0.1);
  assert.equal(G.state, 'over'); assert.equal(G.won, false);
  const A = createTestGame({ foes: ['jackal'] });
  freeze(foes(A)[0]);
  startCoop(A, 'host', 1);
  destroy(A, A.player, null);
  assert.equal(A.state, 'over', 'alone: die and it is over, as in single player');
});

test('EXTRACT waits for every pilot still standing', () => {
  const n = MISSIONS.findIndex(m => (m.objectives || []).some(o => o.type === 'extract' && o.after == null));
  const G = startMission(n), P = G.player;
  for (const m of G.mechs) if (m.team) freeze(m);
  const o = G.objectives.find(x => x.def.type === 'extract'), pad = o.nav;
  const mate = hostWithMate(G, [pad.x + 500, pad.z]);
  P.x = pad.x; P.z = pad.z;
  stepFor(G, 0.2);
  assert.equal(o.state, 'active', 'one pilot is still out there');
  assert.ok(o.dist > 400, 'the distance is the furthest pilot\'s');
  mate.alive = false;
  stepFor(G, 0.2);
  assert.equal(o.state, 'done', 'a pilot who is down does not hold it up');
});
