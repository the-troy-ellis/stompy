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
  roundTrip(P.died(0));
  assert.equal(P.parse('nope'), null);
  assert.equal(P.parse('42'), null);
  assert.equal(P.parse('{"x":1}'), null);
  assert.equal(P.hello('A', 0).v, P.PROTOCOL);
});

test('a fusion hit is always the capped 40 with the fu flag', () => {
  assert.deepEqual(P.hit(5, 999, [0, 0, 0], true), { t: 'hit', to: 5, amt: 40, p: [0, 0, 0], fu: 1 });
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
