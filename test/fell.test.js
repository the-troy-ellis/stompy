// The forest, part 2 (docs/specs/39-forest.md): saplings fold under any
// mech, heavy mechs shove trees over, a punch, a shot, a beam or a blast
// fells one, and it falls as one piece away from the hit and crushes what
// it lands on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { trunkOf } from '../src/world/forest.js';
import { pushOutOfTrees, hurtTree, fellNear } from '../src/sim/trees.js';
import { fellTree, stepPieces } from '../src/sim/pieces.js';
import { rayHit } from '../src/sim/geom.js';
import { meleeTarget } from '../src/sim/melee.js';
import { TREES } from '../src/data/forest.js';
import { geoOf } from '../src/data/geo.js';

const forest = (pilot = 'kestrel') => {
  const G = createGame({ fx: recordFx(), seed: 7 });
  startMatch(G, { name: 'Forest', pal: 'forest', intel: '', foes: ['jackal'] }, 7, false, pilot);
  for (const m of G.mechs) if (m !== G.player) m.alive = false;   // just you, unless a test adds one
  return G;
};
const rad = m => geoOf(m).radius * m.ch.scale;
const said = G => G.fx.calls('say').map(c => c.args[0]);
const firstTree = (T, ok = () => true) => { for (let i = 0; i < T.n; i++) if (trunkOf(T, i) > 0 && ok(i)) return i; return -1; };
const firstSapling = T => { for (let i = 0; i < T.n; i++) if (!trunkOf(T, i)) return i; return -1; };
const fallen = (G, s = 10) => { for (let k = 0; k < s * 20; k++) stepPieces(G, 0.05); };

test('a sapling folds flat under any mech that walks into it', () => {
  const G = forest('jackal'), T = G.trees, P = G.player, i = firstSapling(T);
  Object.assign(P, { x: T.x[i] + 0.5, z: T.z[i], y: T.y[i] });
  pushOutOfTrees(G, rad);
  assert.equal(T.state[i], 2);
});

test('a tree stops a light mech; a heavy one on the move shoves it over the way it\'s going, slowed', () => {
  const L = forest('kestrel'), T = L.trees, P = L.player, i = firstTree(T);
  Object.assign(P, { x: T.x[i] - 2, z: T.z[i], y: T.y[i], speed: 8 });
  pushOutOfTrees(L, rad);
  assert.equal(T.state[i], 0, 'standing');
  assert.ok(Math.hypot(P.x - T.x[i], P.z - T.z[i]) >= rad(P) + trunkOf(T, i) - 1e-6, 'pushed off');
  const H = forest('warden'), U = H.trees, W = H.player, j = firstTree(U);
  Object.assign(W, { x: U.x[j] - 2, z: U.z[j], y: U.y[j], speed: 8 });
  pushOutOfTrees(H, rad);
  assert.equal(U.state[j], 1, 'falling');
  assert.ok(Math.abs(W.speed - 8 * TREES.shove) < 1e-9, 'slowed');
  fallen(H);
  assert.equal(U.state[j], 2);
  assert.ok(Math.cos(U.fall[j] / 256 * 2 * Math.PI - Math.PI / 2) > 0.9, 'over toward +x, the way it was pushed');
});

test('a tree takes TREES.hp before it falls; a sapling folds at once', () => {
  const G = forest(), T = G.trees, i = firstTree(T), s = firstSapling(T);
  hurtTree(G, i, TREES.hp - 1, G.player, 0);
  assert.equal(T.state[i], 0);
  hurtTree(G, i, 1, G.player, 0);
  assert.equal(T.state[i], 1);
  hurtTree(G, s, 0.1, G.player, 0);
  assert.equal(T.state[s], 2);
});

test('a falling tree lands after its time, crushes a mech along its length, and says Timber. when yours lands on a foe', () => {
  const G = forest(), T = G.trees, P = G.player, i = firstTree(T, j => T.h[j] > 18);
  const foe = G.mechs.find(m => m.team !== 0);
  foe.alive = true; Object.assign(foe, { x: T.x[i], z: T.z[i] + T.h[i] * 0.6, y: T.y[i] });
  const hp = Object.values(foe.hp).reduce((a, b) => a + b, 0);
  fellTree(G, i, 0, P);
  stepPieces(G, 0.1);
  assert.equal(T.state[i], 1, 'still falling');
  fallen(G);
  assert.equal(T.state[i], 2);
  assert.ok(Object.values(foe.hp).reduce((a, b) => a + b, 0) < hp, 'crushed');
  assert.ok(said(G).includes('Timber.'));
});

test('at most TREES.pieces fall at once: the oldest lands now', () => {
  const G = forest(), T = G.trees, picks = [];
  for (let i = 0; i < T.n && picks.length < TREES.pieces + 1; i++) if (trunkOf(T, i)) picks.push(i);
  for (const i of picks) fellTree(G, i, 0, null);
  assert.equal(G.pieces.length, TREES.pieces);
  assert.equal(T.state[picks[0]], 2, 'the first is down');
});

test('a blast fells the trees round it, outward', () => {
  const G = forest(), T = G.trees, i = firstTree(T), p = [T.x[i] - 3, T.y[i] + 2, T.z[i]];
  fellNear(G, p, TREES.blastR, null);
  fallen(G);
  assert.equal(T.state[i], 2);
  assert.ok(Math.cos(T.fall[i] / 256 * 2 * Math.PI - Math.PI / 2) > 0.7, 'away from the blast (+x)');
});

test('a shot finds a trunk in its way; a punch finds the tree in front', () => {
  const G = forest(), T = G.trees, P = G.player, i = firstTree(T);
  const o = [T.x[i] - 20, T.y[i] + 3, T.z[i]], hit = rayHit(G, o, [1, 0, 0], 40, P);
  assert.equal(hit?.tree, i);
  Object.assign(P, { x: T.x[i] - rad(P) - trunkOf(T, i) - 1, z: T.z[i], y: T.y[i], yaw: Math.PI / 2, twist: 0 });
  assert.equal(meleeTarget(G, P)?.tree, i);
});
