import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMission } from './harness.js';
import { stepFor, freeze } from './helpers.js';
import { damageEntity, destroyEntity } from '../src/sim/entities.js';
import { WAVE_WARN } from '../src/sim/waves.js';
import { startCoop, hostTick, guestApply, flushEHits, applyEHit, becomeHost, ES_HZ } from '../src/net/coop.js';

// Co-op's entities and objectives (#203, spec 09 § Authority split), on
// mission 2 (DESTROY: three relays; two down calls a wave).
function pair() {
  const H = startMission(1), Gs = startMission(1);
  for (const G of [H, Gs]) for (const m of G.mechs) if (m.team) { freeze(m); Object.assign(m, { x: 900, z: -900 }); }
  startCoop(H, 'host'); startCoop(Gs, 'guest');
  const sent = [];
  const relay = (dt = 1 / ES_HZ) => hostTick(H, dt, m => { sent.push(m); guestApply(Gs, m, Gs.clock); });
  // The host's sim sends entx through G.fx; hand those over too.
  const flushFx = () => { for (const c of H.fx.calls('netSend').splice(0)) guestApply(Gs, c.args[0], Gs.clock); };
  relay(0.5);
  return { H, Gs, relay, flushFx, sent, relayH: id => H.entities.find(e => e.id === id), relayG: id => Gs.entities.find(e => e.id === id) };
}

test('a guest\'s hit on a relay goes to the host, which applies it; the guest\'s copy follows the host\'s hp', () => {
  const { H, Gs, relay, relayH, relayG } = pair();
  const hp = relayH('relay1').hp;
  damageEntity(Gs, relayG('relay1'), 10, Gs.player, null);
  assert.equal(relayG('relay1').hp, hp, 'not applied on the guest');
  const out = [];
  flushEHits(Gs, m => out.push(m));
  assert.deepEqual([out[0].t, out[0].ent, out[0].amt, 'eid' in out[0]], ['ehit', 'relay1', 10, false]);
  assert.ok(applyEHit(H, out[0], null));
  assert.equal(relayH('relay1').hp, hp - 10);
  relay(0.5);
  assert.equal(relayG('relay1').hp, hp - 10, 'the 2 Hz snapshot');
});

test('a relay down on the host is down on the guest at once; the objective count follows', () => {
  const { H, Gs, relay, flushFx, relayH, relayG } = pair();
  destroyEntity(H, relayH('relay1'), H.player, { punch: true, yaw: 1.2 });
  flushFx();
  assert.equal(relayG('relay1').alive, false, 'entx');
  assert.ok(Math.abs(relayG('relay1').fall.yaw - 1.2) < 0.01, 'falling the same way');
  stepFor(H, 0.1);
  relay(0.5);   // progress goes out at ENT_HZ
  assert.equal(Gs.objectives[0].done, 1);
  assert.equal(Gs.objectives[0].state, 'active');
  stepFor(Gs, 0.5);
  assert.equal(Gs.state, 'play', 'the guest decides nothing itself');
});

test('acceptance 2: the host leaves mid-mission; the guest takes over, enemies move, objectives tick, the wave is not sent twice', () => {
  const { H, Gs, relay, flushFx, relayH, relayG } = pair();
  for (const id of ['relay1', 'relay2']) destroyEntity(H, relayH(id), H.player);
  flushFx();
  stepFor(H, WAVE_WARN + 0.5);   // two down: the wave comes
  relay(); relay(0.5);
  const wave = Gs.mechs.filter(m => m.eid && m.remote && m.alive);
  assert.ok(wave.some(m => m.eid > 2), 'the wave reached the guest');
  const nGuest = Gs.mechs.length;
  // The host's socket closes; the relay names the guest host.
  becomeHost(Gs);
  assert.equal(Gs.role, 'host');
  assert.ok(Gs.mechs.filter(m => m.eid).every(m => !m.remote), 'the enemies are its own now');
  const w = Gs.mechs.find(m => m.eid > 2), from = [w.x, w.z];
  stepFor(Gs, 2);
  assert.ok(Math.hypot(w.x - from[0], w.z - from[1]) > 1, 'the wave enemy keeps walking');
  assert.equal(Gs.mechs.length, nGuest, 'no second wave');
  const out = [];
  hostTick(Gs, 0.5, m => out.push(m));
  assert.ok(out.some(m => m.t === 'es') && out.some(m => m.t === 'obj'), 'and it sends the world now');
  destroyEntity(Gs, relayG('relay3'), Gs.player);
  stepFor(Gs, 0.2);
  assert.equal(Gs.objectives[0].state, 'done', 'its own objectives tick');
  assert.equal(Gs.state, 'over'); assert.equal(Gs.won, true);
  out.length = 0;
  hostTick(Gs, 0.01, m => out.push(m));
  assert.deepEqual(out.find(m => m.t === 'over'), { t: 'over', won: 1 });
});

test('the end reaches the guest: over, won', () => {
  const { H, Gs, relay } = pair();
  H.state = 'over'; H.won = true;
  relay();
  assert.equal(Gs.state, 'over'); assert.equal(Gs.won, true);
});
