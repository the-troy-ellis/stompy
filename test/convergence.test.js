import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRoom } from './fakeRelay.js';
import { damage } from '../src/sim/combat.js';
import { damageEntity } from '../src/sim/entities.js';
import { MISSIONS } from '../src/data/missions.js';

// Acceptance 6 (spec 09): a host and a guest through an in-memory relay reach
// the same objective states and enemy hp after a scripted fight; and
// acceptance 4's traffic, measured: under 20 kB/s per pilot with four of
// them through mission 5 (SURVIVE), its three waves and their extras.
const enemies = G => G.mechs.filter(m => m.eid).sort((a, b) => a.eid - b.eid);
const hpOf = m => Object.values(m.hp).map(v => Math.round(Math.max(0, v)));

test('acceptance 6: after a scripted fight on mission 2, host and guest agree on every enemy and every objective', () => {
  const room = fakeRoom(1, 2), [H, Gs] = room.pilots;
  // The guest knocks one relay down and hurts each enemy it can see; the
  // host puts a burst into the first enemy; then everyone stands still.
  room.run(1);
  room.run(3, 1 / 20, (G, t) => {
    if (G !== Gs || t > 1) return;
    const relay = G.entities.find(e => e.id === 'relay1');
    if (relay.alive) damageEntity(G, relay, 5, G.player, null);
    for (const e of enemies(G)) if (e.alive) damage(G, e, [e.x, e.y + 5, e.z], 0.6, G.player);
  });
  room.run(2, 1 / 20, (G, t) => { if (G === H && t < 0.5) { const e = enemies(G)[0]; if (e.alive) damage(G, e, [e.x, e.y + 5, e.z], 1.5, G.player); } });
  room.run(2);   // settle: the last reports arrive
  const host = enemies(H), guest = enemies(Gs);
  assert.ok(host.length >= 2);
  assert.deepEqual(guest.map(e => e.eid), host.map(e => e.eid), 'the same enemies');
  assert.ok(host.some(e => hpOf(e).join() !== hpOf({ hp: e.max }).join()), 'the fight did damage');
  for (let i = 0; i < host.length; i++) {
    assert.equal(guest[i].alive, host[i].alive, `enemy ${host[i].eid} alive on both or neither`);
    assert.deepEqual(hpOf(guest[i]), hpOf(host[i]), `enemy ${host[i].eid}'s armour`);
  }
  assert.equal(H.entities.find(e => e.id === 'relay1').alive, false, 'the guest\'s hits felled the relay on the host');
  assert.deepEqual(Gs.entities.map(e => [e.id, e.alive]), H.entities.map(e => [e.id, e.alive]), 'the same entities standing');
  assert.deepEqual(Gs.objectives.map(o => [o.state, o.done ?? null]), H.objectives.map(o => [o.state, o.done ?? null]), 'the same objective states');
});

test('acceptance 4: four pilots through all of mission 5 (SURVIVE) stay under 20 kB/s each, every 10 s of it', () => {
  const n = MISSIONS.findIndex(m => m.key === 'm05'), room = fakeRoom(n, 4), windows = [];
  let last = room.bytes.slice();
  for (let s = 0; s < 150; s += 10) {
    room.run(10, 1 / 15);
    windows.push(room.bytes.map((b, i) => (b - last[i]) / 10));
    last = room.bytes.slice();
  }
  const worst = room.bytes.map((_, i) => Math.max(...windows.map(w => w[i])));
  console.log(`  worst 10 s, B/s per pilot: ${worst.map(Math.round).join(', ')} (host first)`);
  assert.ok(worst.every(b => b < 20000), `${worst.map(Math.round)}`);
  assert.ok(worst[1] > worst[0], 'guests take the host\'s world on top');
  assert.ok(enemies(room.guests[0]).length >= 15, 'every wave (and the extra pilots\' extras) reached the guests');
});
