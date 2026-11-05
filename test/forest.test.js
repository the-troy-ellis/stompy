// The forest, part 1 (docs/specs/39-forest.md): the tree field from the seed,
// thick woods with clearings and roads, nothing on the start, trunks that
// stop mechs and saplings that don't, trees that ride dug ground down, and
// foes that can't see far into the mist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { cellsNear, trunkOf } from '../src/world/forest.js';
import { pushOutOfTrees } from '../src/sim/trees.js';
import { TREES, TREE_KINDS } from '../src/data/forest.js';
import { sightOf } from '../src/sim/ai/perception.js';
import { dig } from '../src/sim/dig.js';
import { BX, BZ } from '../src/world/terrain.js';

const forest = (seed = 7) => {
  const G = createGame({ fx: recordFx(), seed });
  startMatch(G, { name: 'Forest', pal: 'forest', intel: '', foes: ['jackal'] }, seed, false, 'kestrel');
  return G;
};

test('a forest match plants its trees from the seed: the same for a seed, thick, every kind, in their cells', () => {
  const a = forest(7).trees, b = forest(7).trees, c = forest(8).trees;
  assert.ok(a.n > 20000, `${a.n} trees`);
  assert.equal(a.n, b.n);
  assert.deepEqual([...a.x.subarray(0, 50)], [...b.x.subarray(0, 50)]);
  assert.notDeepEqual([...a.x.subarray(0, 50)], [...c.x.subarray(0, 50)], 'another seed, other woods');
  for (let k = 0; k < TREE_KINDS.length; k++) assert.ok(a.kind.some(v => v === k), TREE_KINDS[k]);
  for (let cz = 0; cz < a.nz; cz += 13) for (let cx = 0; cx < a.nx; cx += 11) {
    const cell = cx + a.nx * cz;
    for (let i = a.start[cell]; i < a.start[cell + 1]; i++) {
      assert.equal(Math.floor((a.x[i] + BX) / TREES.cell), cx);
      assert.equal(Math.floor((a.z[i] + BZ) / TREES.cell), cz);
    }
  }
});

test('the start is clear, and so is every mech\'s footing; other biomes have no trees', () => {
  const G = forest(), T = G.trees, P = G.player;
  for (let i = 0; i < T.n; i++) assert.ok(Math.hypot(T.x[i] - P.x, T.z[i] - P.z) >= 45 - 1e-6 || i < 0);
  for (const m of G.mechs) for (let i = 0; i < T.n; i++) if (Math.hypot(T.x[i] - m.x, T.z[i] - m.z) < 10 - 1e-6) assert.fail('a tree on a mech');
  const D = createGame({ fx: recordFx(), seed: 7 });
  startMatch(D, { name: 'Dusk', pal: 'dusk', intel: '', foes: ['jackal'] }, 7, false, 'kestrel');
  assert.equal(D.trees, null);
});

test('clearings: some of the woods\' cells are empty, most are not', () => {
  const T = forest().trees;
  let empty = 0, total = 0;
  for (let c = 0; c < T.nx * T.nz; c++) { total++; if (T.start[c] === T.start[c + 1]) empty++; }
  assert.ok(empty / total > 0.1 && empty / total < 0.6, `${(100 * empty / total).toFixed(0)}% of cells empty`);
});

test('a trunk stops a mech; a sapling doesn\'t', () => {
  const G = forest(), T = G.trees, P = G.player, rad = () => 2.4;
  const tree = [...Array(T.n).keys()].find(i => trunkOf(T, i) > 0), sap = [...Array(T.n).keys()].find(i => trunkOf(T, i) === 0);
  Object.assign(P, { x: T.x[tree] + 0.5, z: T.z[tree], y: T.y[tree] });
  pushOutOfTrees(G, rad);
  assert.ok(Math.hypot(P.x - T.x[tree], P.z - T.z[tree]) >= rad() + trunkOf(T, tree) - 1e-6, 'pushed off the trunk');
  Object.assign(P, { x: T.x[sap] + 0.5, z: T.z[sap], y: T.y[sap] });
  const near = [0, 0, 0, 0]; cellsNear(T, P.x, P.z, 4, near);
  const x0 = P.x;
  pushOutOfTrees(G, rad);
  const blocked = [...Array(T.n).keys()].some(i => trunkOf(T, i) > 0 && Math.hypot(T.x[i] - x0, T.z[i] - T.z[sap]) < rad() + trunkOf(T, i));
  if (!blocked) assert.equal(P.x, x0, 'a sapling alone doesn\'t push');
});

test('a dig under a tree lets it down onto what\'s left', () => {
  const G = forest(), T = G.trees, i = 1234, y0 = T.y[i];
  for (let k = 0; k < 4; k++) dig(G, [T.x[i], y0 - 2 - k * 3, T.z[i]], 6);
  assert.ok(T.y[i] < y0 - 3, `it sank ${(y0 - T.y[i]).toFixed(1)} m`);
});

test('foes can\'t see much past the forest\'s mist; elsewhere their sight is as it was', () => {
  const G = forest();
  assert.ok(sightOf(G, G.player) <= G.pal.fog[1] * 1.1 + 1e-6, `${sightOf(G, G.player)} m`);
  const D = createGame({ fx: recordFx(), seed: 7 });
  D.diff = 'normal';
  startMatch(D, { name: 'Dusk', pal: 'dusk', intel: '', foes: ['jackal'] }, 7, false, 'kestrel');
  assert.equal(sightOf(D, D.player), 600);
});
