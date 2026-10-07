import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { damage, fire } from '../src/sim/combat.js';
import { newMech } from '../src/sim/state.js';
import { preyOf, PREY_SWITCH } from '../src/sim/ai.js';
import { startCoop, hostTick, guestApply, applyEHit, flushEHits, enemyByEid, ES_HZ, GT_SLACK } from '../src/net/coop.js';

// Co-op's host-run enemies (#202, spec 09 § Authority split).
// A host and a guest of one seed and mission, the enemy parked in front of
// both pilots; `relay` hands the host's es to the guest.
function pair(foe = 'warden') {
  const H = createTestGame({ foes: [foe] }), Gs = createTestGame({ foes: [foe] });
  const e = foes(H)[0];
  Object.assign(e, { x: 0, z: 120, yaw: Math.PI }); initFeet(H, e); freeze(e);
  startCoop(H, 'host'); startCoop(Gs, 'guest');
  const relay = () => hostTick(H, 1 / ES_HZ, m => guestApply(Gs, m, Gs.clock));
  relay();
  return { H, Gs, e, ge: enemyByEid(Gs, e.eid), relay };
}

test('both ends number the mission enemies alike; the guest draws the host\'s', () => {
  const { H, Gs, e, ge } = pair();
  assert.equal(e.eid, 1);
  assert.ok(ge && ge.remote && !e.remote, 'the guest\'s copy is remote, the host\'s is real');
  assert.deepEqual([ge.x, ge.z], [e.x, e.z], 'the first report puts it there');
  assert.equal(Gs.mechs.filter(m => m.eid).length, 1, 'no second copy');
  // A wave enemy only the host spawned appears on the guest from its es.
  const w = newMech(H, 'jackal', 1, 50, 50, 0); H.mechs.push(w);
  hostTick(H, 1 / ES_HZ, m => guestApply(Gs, m, Gs.clock));
  assert.equal(w.eid, 2);
  assert.equal(enemyByEid(Gs, 2)?.type, 'jackal');
});

test('a guest\'s hit on an enemy goes to the host as ehit; the guest\'s copy keeps the host\'s armour', () => {
  const { H, Gs, e, ge } = pair();
  const T = ge.hp.T;
  damage(Gs, ge, [ge.x, ge.y + 5, ge.z], 12, Gs.player);
  assert.equal(ge.hp.T, T, 'not applied on the guest');
  assert.equal(Gs.pendingHits.size, 0);
  const sent = [];
  flushEHits(Gs, m => sent.push(m));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, 'ehit'); assert.equal(sent[0].eid, e.eid); assert.equal(sent[0].amt, 12);
  const hp = { ...e.hp };
  assert.ok(applyEHit(H, sent[0], null));
  assert.ok(Object.keys(hp).some(k => e.hp[k] < hp[k]), 'the host applies it');
});

test('acceptance 3: a guest\'s fusion cannon kills an enemy; the host applies it and relays the death', () => {
  const { H, Gs, e, ge, relay } = pair();
  Gs.player.pitch = -0.05;
  stepFor(Gs, 1);
  stepFor(Gs, 3.1, input({ held: { fusion: true } }));
  stepFor(Gs, 1.5);
  const kill = Gs.fx.calls('netSend').map(c => c.args[0]).find(m => m.t === 'ehit');
  assert.ok(kill, 'the pulse arriving sends an ehit');
  assert.equal(kill.fu, 1); assert.equal(kill.eid, e.eid);
  assert.ok(ge.alive, 'the guest does not kill the host\'s enemy itself');
  applyEHit(H, kill, null);
  assert.equal(e.alive, false, 'dead on the host');
  relay();
  assert.equal(ge.alive, false, 'and on the guest, from the host\'s es');
});

test('the host\'s enemies fire with their eid on the wire; a solo game sends nothing', () => {
  const { H, e } = pair('warden');
  const shot = m => m.weapons.find(x => x.def.kind === 'shell' || x.def.kind === 'missile');
  const w = shot(e);
  w.cd = 0; e.shutdown = false; e.heat = 0;
  assert.ok(fire(H, e, w, [0, 5, 0]));
  const fx = H.fx.calls('netSend').map(c => c.args[0]).find(m => m.t === 'fx');
  assert.ok(fx && (fx.k === 's' || fx.k === 'm')); assert.equal(fx.eid, e.eid);
  const S = createTestGame({ foes: ['warden'] }), se = foes(S)[0], sw = shot(se);
  sw.cd = 0; se.shutdown = false; se.heat = 0;
  assert.ok(fire(S, se, sw, [0, 5, 0]));
  assert.equal(S.fx.calls('netSend').length, 0);
});

test('a guest runs no objectives, turrets or waves; its clock follows the host\'s', () => {
  const { H, Gs, relay } = pair();
  stepFor(Gs, 0.5);
  assert.equal(Gs.state, 'play');
  H.time += 5;
  relay();
  assert.ok(Math.abs(Gs.time - H.time) <= GT_SLACK + 0.01, 'game time pulled to the host\'s (lightning)');
});

test('as host, an enemy fights the nearest pilot and only switches for one much closer', () => {
  const { H, e } = pair();
  const far = newMech(H, 'kestrel', 0, 0, 0, 0); Object.assign(far, { remote: true, netId: 5, x: 0, z: 300 }); H.mechs.push(far);
  H.player.x = 0; H.player.z = -200;
  e.x = 0; e.z = 120;
  assert.equal(preyOf(H, e), far, 'the guest at 180 m over the host at 320 m');
  H.player.z = 120 - 180 * PREY_SWITCH * 1.1;   // a little closer, not enough
  assert.equal(preyOf(H, e), far);
  H.player.z = 120 - 180 * PREY_SWITCH * 0.8;
  assert.equal(preyOf(H, e), H.player);
  const S = createTestGame({ foes: ['jackal'] });
  assert.equal(preyOf(S, foes(S)[0]), S.player, 'solo: always you');
});
