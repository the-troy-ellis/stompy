// Digs over the wire (docs/specs/18-voxel-ground.md § Sync): the owner of a
// blast digs it and queues it; everyone applies what the relay echoes, in any
// order, own digs included; a late joiner replays the room's list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { dig, applyDigList, ownsDigs } from '../src/sim/dig.js';
import { damage, DEATH_BEAT } from '../src/sim/combat.js';
import { digsMsg, DIGS_MAX } from '../src/net/protocol.js';

const arena = () => { const G = createTestGame(); for (const e of foes(G)) freeze(e); G.mode = 'mp'; return G; };
const shell = (G, at, owner, ghost) => G.shots.push({ kind: 'shell', type: 'ppc', p: [at[0], 6, at[1]], v: [0, -300, 0], owner, dmg: ghost ? 0 : 1, life: 1, ghost });
// What the relay does with a client's digs: numbers them, in arrival order.
let seq = 0;
const relay = l => l.map(d => [++seq, ...d]);

test('the shooter digs its own shot and queues it; another pilot\'s shell (a ghost) only explodes', () => {
  const G = arena(), P = G.player, before = G.ter.hash();
  shell(G, [0, 50], foes(G)[0], true);
  stepFor(G, 0.2);
  assert.equal(G.ter.hash(), before, 'a ghost digs nothing here');
  assert.equal(G.pendingDigs.length, 0);
  shell(G, [0, 50], P, false);
  stepFor(G, 0.2);
  assert.notEqual(G.ter.hash(), before, 'our own shot digs at once');
  assert.equal(G.pendingDigs.length, 1);
  const [op, x, y, z, r] = G.pendingDigs[0];
  assert.deepEqual([op, x, z, r], [0, 0, 50, 4]);
  assert.ok(y % 0.25 === 0, 'positions go out to 0.25 m');
  assert.deepEqual(digsMsg(G.pendingDigs), { t: 'digs', l: G.pendingDigs });
  assert.ok(DIGS_MAX >= 32);
});

test('single player digs and sends nothing; a missile popping in the air digs nothing', () => {
  const G = createTestGame();
  dig(G, [0, 0, 30], 4);
  assert.equal(G.pendingDigs.length, 0);
  const A = arena(), before = A.ter.hash();
  dig(A, [0, 40, 30], 2);
  assert.equal(A.ter.hash(), before);
  assert.equal(A.pendingDigs.length, 0, 'nothing to send either');
});

test('who owns a blast: your own; as co-op host the enemies\' too; as a guest only yours', () => {
  const G = createTestGame(), e = foes(G)[0];
  assert.ok(ownsDigs(G, e) && ownsDigs(G, null), 'single player: everything');
  G.mode = 'mp';
  assert.ok(ownsDigs(G, G.player) && !ownsDigs(G, Object.assign({}, e, { remote: true })));
  G.mode = 'coop'; G.role = 'host';
  assert.ok(ownsDigs(G, e) && ownsDigs(G, null));
  G.role = 'guest'; e.remote = true;
  assert.ok(ownsDigs(G, G.player) && !ownsDigs(G, e) && !ownsDigs(G, null));
});

test('a remote pilot\'s death digs nothing here: its own client sends the crater', () => {
  const G = arena(), e = foes(G)[0];
  e.remote = true;
  const before = G.ter.hash();
  damage(G, e, [e.x, e.y + 5, e.z], 1000, G.player);
  stepFor(G, DEATH_BEAT + 0.5);
  assert.equal(G.ter.hash(), before);
});

test('every client ends with the same ground: own digs echoed, others\' in any order, and a late joiner', () => {
  const A = arena(), B = arena();
  const fromA = [[0, 10, 0, 40, 4], [0, 12, 0, 42, 7], [0, -30, 0, 60, 2.5]], fromB = [[0, 11, 0, 41, 6], [0, 200, 0, -50, 3.5]];
  for (const d of fromA) dig(A, d.slice(1, 4), d[4]);   // each digs its own at once...
  for (const d of fromB) dig(B, d.slice(1, 4), d[4]);
  const echoA = relay(A.pendingDigs.splice(0)), echoB = relay(B.pendingDigs.splice(0));
  applyDigList(A, echoB); applyDigList(A, echoA);   // ...then everything the relay echoes, in whatever order it lands
  applyDigList(B, echoA); applyDigList(B, echoB);
  assert.equal(A.ter.hash(), B.ter.hash());
  const C = arena();
  applyDigList(C, [...echoA, ...echoB]);   // the room's list, in welcome
  assert.equal(C.ter.hash(), A.ter.hash(), 'the late joiner too');
  assert.equal(C.digSeq, seq, 'and knows the last number');
  const h = A.ter.hash();
  applyDigList(A, echoA);
  assert.equal(A.ter.hash(), h, 'a dig applied twice changes nothing');
});

test('junk off the wire is skipped', () => {
  const G = arena(), before = G.ter.hash();
  applyDigList(G, 'nope');
  applyDigList(G, [[1, 0, 0, 0, 0], [2, 0, NaN, 0, 0, 3], [3, 0, 0, 0, 0, 99], [4, 1, 0, 0, 0, 3], null]);
  assert.equal(G.ter.hash(), before);
});
