import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/net/protocol.js';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';

const roundTrip = m => { const back = P.parse(JSON.stringify(m)); assert.deepEqual(back, m); return back; };

test('every builder survives JSON and parse rejects junk', () => {
  roundTrip(P.hello('PILOT', 3));
  roundTrip(P.fxBeam('laser', [1.234, 2, 3], [4, 5, 6.789]));
  roundTrip(P.fxShell([0, 0, 0], [1, 2, 3]));
  roundTrip(P.fxMissiles([0, 1, 2], [0, 0, 1], 4, 9));
  roundTrip(P.fxGuide(9, [1, 1, 1], [0, 1, 0]));
  roundTrip(P.fxDetonate(9));
  roundTrip(P.fxFusion([0, 0, 0], 2, [10, 0, 0]));
  roundTrip(P.hit(2, 3.14159, [1, 2, 3]));
  roundTrip(P.hit(2, 8, [1, 2, 3], false, { kb: [3.456, -1], me: 1 }));
  roundTrip(P.fxPunch());
  roundTrip(P.died(0));
  roundTrip(P.died(3, true));
  assert.equal(P.parse('nope'), null);
  assert.equal(P.parse('42'), null);
  assert.equal(P.parse('{"x":1}'), null);
  assert.equal(P.hello('A', 0).v, P.PROTOCOL);
});

test('a fusion hit is always the capped 40 with the fu flag', () => {
  assert.deepEqual(P.hit(5, 999, [0, 0, 0], true), { t: 'hit', to: 5, amt: 40, p: [0, 0, 0], fu: 1 });
});

test('a hit carries knockback and the melee flags only when they are set', () => {
  assert.deepEqual(P.hit(2, 8, [0, 0, 0], false, { kb: [3.456, -1], me: 1 }), { t: 'hit', to: 2, amt: 8, p: [0, 0, 0], kb: [3.46, -1], me: 1 });
  assert.deepEqual(P.hit(2, 6, [0, 0, 0], false, { kb: [0, 0], st: 1 }), { t: 'hit', to: 2, amt: 6, p: [0, 0, 0], st: 1 });
  assert.deepEqual(P.hit(2, 6, [0, 0, 0], false, { amt: 6, p: [0, 0, 0] }), { t: 'hit', to: 2, amt: 6, p: [0, 0, 0] });
  assert.deepEqual(P.died(3, true), { t: 'died', by: 3, me: 1 });
  assert.ok(P.PROTOCOL >= 2);
});

test('the state message carries the punch phase', () => {
  const G = createTestGame();
  stepFor(G, 1);
  assert.equal(P.stateMessage(G.player, 1).pu, 0);
  stepFor(G, 1 / 60, input({ punch: true }));
  assert.equal(P.stateMessage(G.player, 1).pu, 1);
  stepFor(G, 0.5);
  assert.equal(P.stateMessage(G.player, 1).pu, 2);
  stepFor(G, 1);
  assert.equal(P.stateMessage(G.player, 1).pu, 0);
});

test('the state message carries speed and scan progress under different keys', () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 120, yaw: Math.PI }); initFeet(G, e); freeze(e);
  G.player.pitch = -0.05;
  stepFor(G, 1);
  stepFor(G, 1.5, input({ thrUp: true, held: { fusion: true } }));
  const s = P.stateMessage(G.player, 1);
  assert.ok(s.sp > 1, `speed ${s.sp}`);
  assert.ok(s.sq > 0.3 && s.sq <= 1, `scan ${s.sq}`);
  assert.equal(s.sc, e.netId);
  assert.equal(s.hp.length, 5);
  assert.equal(s.ch, 'kestrel');
  // No key is written twice: JSON keeps the last, which is how the old `sp` bug hid.
  const src = P.stateMessage.toString();
  const keys = [...src.matchAll(/\b([a-z]{1,3}):/g)].map(m => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'duplicate key in stateMessage');
});

test('the state message carries the loadout only when asked', async () => {
  const G = createTestGame();
  assert.equal('lo' in P.stateMessage(G.player, 1), false);
  const s = P.stateMessage(G.player, 1, true);
  assert.deepEqual(s.lo, G.player.loadout);
  roundTrip(s);
  assert.ok(P.PROTOCOL >= 3);
});

test('the relay speaks the same protocol version as the game, and every state field is one it rebuilds', async () => {
  const { readFileSync } = await import('node:fs');
  const py = readFileSync(new URL('../server/server.py', import.meta.url), 'utf8');
  assert.equal(+py.match(/^PROTOCOL = (\d+)/m)[1], P.PROTOCOL, 'server/server.py PROTOCOL');
  // clean_state keeps a whitelist: a field the game sends that it doesn't know would vanish on the way.
  const kept = new Set([...py.slice(py.indexOf('def clean_state'), py.indexOf('def fx_allowed')).matchAll(/"(\w+)":/g)].map(m => m[1]));
  const sent = Object.keys(P.stateMessage({ type: 'kestrel', x: 0, y: 0, z: 0, yaw: 0, twist: 0, pitch: 0, speed: 0, hp: { LA: 1, RA: 1, T: 1, LL: 1, RL: 1 } }, 1));
  for (const k of sent) assert.ok(kept.has(k), `the relay drops ${k}`);
});
