// Falling ground (docs/specs/18-voxel-ground.md § Falling ground, acceptance
// 7 and 11): ground nothing holds up comes down, as a heap or in pieces; it
// crushes what it lands on and carries what stands on it; every client works
// out the same falls from the relay's order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { dig, applyDigList } from '../src/sim/dig.js';
import { cornerIndex, ISLAND_MAX, SHATTER, VS, Y0, NX, NZ } from '../src/world/voxels.js';
import { initFeet } from '../src/sim/gait.js';
import { CRUSH } from '../src/data/weapons.js';

const game = () => { const G = createTestGame(); for (const e of foes(G)) { freeze(e); e.x = 900; e.z = 900; } return G; };
// A ball of rock on a one-cell stem at (x, z): cut the stem and the ball falls two cells.
function mushroom(G, x = 0, z = 0) {
  G.ter.block(x - 4, x + 4, z - 4, z + 4, 30);
  G.ter.build([x, 40, z], 14);
  G.ter.dirty.clear();
}
const cut = (G, x = 0, z = 0) => dig(G, [x, 8, z], 7);
const ci = (x, y, z) => cornerIndex(Math.round((x + 1152) / VS), Math.round((y - Y0) / VS), Math.round((z + 1152) / VS));

test('a ball whose stem is blown out falls two cells and lands as a heap', () => {
  const G = game();
  mushroom(G);
  assert.equal(G.falls.length, 0);
  cut(G);
  assert.equal(G.falls.length, 1, 'it comes down');
  const f = G.falls[0];
  assert.ok(f.n >= SHATTER && f.heap, `a heap: ${f.n} corners`);
  assert.equal(f.drop, 2);
  assert.ok(!G.ter.solid(0, 44, 0), 'the grid has it gone from up there at once');
  assert.ok(G.ter.D[ci(0, 4, 0)] > 128 && G.ter.D[ci(0, 12, 0)] > 128, 'and in its heap, two cells down: the stem\'s top where its foot was');
  assert.ok(G.ter.D[ci(0, 52, 0)] <= 128, 'the ball\'s crown is lower too');
  stepFor(G, 2);
  assert.equal(G.falls.length, 0, 'drawn falling, then landed');
});

test('ground the land holds up does not fall; a dig in a hillside drops nothing', () => {
  const G = createTestGame({ flat: false });
  for (let i = 0; i < 8; i++) dig(G, [300 + i * 9, G.ter.height(300 + i * 9, 300), 300], 7);
  assert.equal(G.falls.length, 0);
});

test('an unheld island past 4,096 corners counts as land; a small one shatters', () => {
  const G = game(), D = G.ter.D, j = 20;
  const slab = (n, i0) => { for (let k = 100; k < 100 + n; k++) for (let i = i0; i < i0 + n; i++) D[cornerIndex(i, j, k)] = 200; };
  slab(70, 20);   // 4,900 corners floating
  assert.ok(70 * 70 > ISLAND_MAX);
  assert.deepEqual(G.ter.islands([20, 30, j, j, 100, 110]), [], 'too big to be anything but land');
  slab(40, 120);   // 1,600: an island
  const isl = G.ter.islands([120, 125, j, j, 100, 105]);
  assert.equal(isl.length, 1);
  assert.equal(isl[0].length, 1600);
  for (let i = 200; i < 202; i++) for (let k = 200; k < 202; k++) D[cornerIndex(i, j, k)] = 200;   // four corners
  const tiny = G.ter.fall(G.ter.islands([200, 201, j, j, 200, 201])[0]);
  assert.equal(tiny.heap, false, 'under 8 corners: it shatters');
  assert.ok(D[cornerIndex(200, j, 200)] <= 128 && D[cornerIndex(200, j - tiny.drop, 200)] <= 128 || tiny.drop === 0, 'and leaves nothing behind');
  assert.ok(NX > 202 && NZ > 202);
});

test('a mech under it takes the crush; one standing on it rides it down', () => {
  const G = game(), P = G.player, e = createTestGame({ foes: ['jackal'] }).mechs[1];
  mushroom(G);
  Object.assign(P, { x: 8, z: 0, yaw: 0 }); P.y = G.ter.groundBelow(8, 3, 0); initFeet(G, P);
  e.team = 1; e.ai.aware = false; freeze(e);
  G.mechs.push(e);
  Object.assign(e, { x: 0, z: 0 }); e.y = G.ter.groundBelow(0, 70, 0); initFeet(G, e);
  const hp = P.hp.T, top = e.y;
  cut(G);
  const n = G.falls[0].n;
  stepFor(G, 3);
  assert.equal(hp - P.hp.T, Math.min(CRUSH.max, CRUSH.perCell * n), `crushed for ${hp - P.hp.T} (${n} corners)`);
  assert.ok(e.y < top - 10 && e.y > 0, `the rider came down with it: ${top.toFixed(1)} -> ${e.y.toFixed(1)}`);
  assert.ok(Math.abs(e.y - G.ter.groundBelow(e.x, e.y + 2, e.z)) < 0.6, 'and stands on the heap');
});

test('every client finds the same falls: the digger, a pilot with digs of its own in flight, and a late joiner', () => {
  const A = game(), B = game();
  for (const G of [A, B]) { G.mode = 'mp'; mushroom(G); }
  let seq = 0;
  const relay = l => l.map(d => [++seq, ...d]);
  cut(A);                                   // A cuts the stem: predicted, no fall yet
  dig(B, [200, 0, -100], 6);                // B digs elsewhere at the same time
  assert.equal(A.falls.length, 0, 'a fall waits for the relay order');
  const a = relay(A.pendingDigs.splice(0)), b = relay(B.pendingDigs.splice(0));
  applyDigList(B, a); applyDigList(A, a);   // the relay's order: A's first...
  applyDigList(A, b); applyDigList(B, b);   // ...then B's
  assert.equal(A.falls.length, 1); assert.equal(B.falls.length, 1);
  assert.equal(A.ter.hash(), B.ter.hash());
  assert.equal(A.ter.hash(), A.terC.hash(), 'nothing left unconfirmed');
  const C = game(); C.mode = 'mp'; mushroom(C);
  applyDigList(C, [...a, ...b], true);
  assert.equal(C.ter.hash(), A.ter.hash(), 'the late joiner too');
  assert.equal(C.falls.length, 0, 'a replayed fall has already landed');
});
