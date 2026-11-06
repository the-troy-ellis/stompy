// The forest, part 3 (docs/specs/39-forest.md): the woods hide you. Sight
// through woodland fades with how much of it is in between, from a density
// grid of 16 m cells that felled trees come off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { trunkOf, woodsAt } from '../src/world/forest.js';
import { fellTree } from '../src/sim/pieces.js';
import { woodsBetween, woodsCut, sees, inView, sightGrid } from '../src/sim/sight.js';
import { canSee } from '../src/sim/ai/perception.js';
import { BX, BZ } from '../src/world/terrain.js';
import { TREES } from '../src/data/forest.js';

const forest = () => {
  const G = createGame({ fx: recordFx(), seed: 7 });
  startMatch(G, { name: 'Forest', pal: 'forest', intel: '', foes: ['jackal'] }, 7, false, 'kestrel');
  return G;
};
const C = TREES.cell;
const cellOf = (T, x, z) => Math.floor((x + BX) / C) + T.nx * Math.floor((z + BZ) / C);
// Open the whole map, then make thick woods along z = z0 from x0 to x1:
// the woods' layout is the seed's, so the tests lay their own.
const lay = (T, z0, x0, x1) => {
  T.dense.fill(0);
  for (let x = x0 + 0.5; x < x1; x += 1) T.dense[cellOf(T, x, z0)] = Math.ceil(T.full);
};
// High over the ground, so the hills stay out of it.
const at = (x, z) => [x, 400, z];
// A cell's middle, so lines along it stay in its row.
const mid = v => (Math.floor((v + BX) / C) + 0.5) * C - BX;

test('the density grid counts each cell\'s standing grown trees, and a falling one comes off', () => {
  const G = forest(), T = G.trees;
  let grown = 0;
  for (let i = 0; i < T.n; i++) if (trunkOf(T, i)) grown++;
  assert.equal(T.dense.reduce((a, b) => a + b, 0), grown, 'saplings don\'t count');
  let i = 0;
  while (!trunkOf(T, i)) i++;
  const c = cellOf(T, T.x[i], T.z[i]), was = T.dense[c];
  fellTree(G, i, 0, null);
  assert.equal(T.dense[c], was - 1);
  assert.ok(woodsAt(T, 1e6, 0) === 0, 'off the map: open');
});

test('sight through 60 m of woods is cut to under half; across open ground it isn\'t', () => {
  const G = forest(), T = G.trees, z = mid(0), x0 = mid(0) - C / 2;
  T.dense.fill(0);
  assert.equal(woodsBetween(G, at(x0, z), at(x0 + 100, z)), 0);
  assert.equal(woodsCut(G, at(x0, z), at(x0 + 100, z)), 1);
  assert.ok(sees(G, at(x0, z), at(x0 + 100, z), 150));
  lay(T, z, x0 + C, x0 + 5 * C);   // four cells, 64 m, from 16 m out
  const m = woodsBetween(G, at(x0, z), at(x0 + 100, z));
  assert.ok(Math.abs(m - 4 * C) <= 8, `${m} m of woods`);
  assert.ok(woodsCut(G, at(x0, z), at(x0 + 100, z)) < 0.45);
  assert.ok(!sees(G, at(x0, z), at(x0 + 100, z), 150), 'hidden at 100 m');
  assert.ok(sees(G, at(x0, z), at(x0 + 40, z), 150), 'seen at 40 m: only a few metres of it in between');
});

test('a mech just inside the woods\' edge isn\'t hidden by them', () => {
  const G = forest(), T = G.trees, z = mid(0), x0 = mid(0) - C / 2;
  lay(T, z, x0 + 96, x0 + 96 + 4 * C);   // the woods start at 96 m out
  assert.ok(sees(G, at(x0, z), at(x0 + 98, z), 150), 'two metres in');
  assert.ok(!sees(G, at(x0, z), at(x0 + 96 + 3 * C, z), 150), 'three cells in');
});

test('a felled lane lets sight through', () => {
  const G = forest(), T = G.trees;
  // A real strip of thick woods, six cells along a row (seed 7's).
  let row = -1, col = -1;
  for (let cz = 0; cz < T.nz && row < 0; cz++) for (let cx = 0, run = 0; cx < T.nx; cx++) {
    run = T.dense[cx + T.nx * cz] >= 3 ? run + 1 : 0;
    if (run === 6) { row = cz; col = cx - 5; break; }
  }
  assert.ok(row >= 0, 'a thick strip');
  const z = (row + 0.5) * C - BZ, a = at(col * C - BX, z), b = at((col + 6) * C - BX, z);
  assert.ok(!sees(G, a, b, 150), 'hidden through 96 m of woods');
  for (let i = 0; i < T.n; i++) {
    const cx = Math.floor((T.x[i] + BX) / C), cz = Math.floor((T.z[i] + BZ) / C);
    if (cz === row && cx >= col && cx < col + 6 && trunkOf(T, i)) fellTree(G, i, Math.PI / 2, null);
  }
  assert.equal(woodsBetween(G, a, b), 0);
  assert.ok(sees(G, a, b, 150), 'seen down the lane');
});

test('a foe can\'t see you through the woods, nor you lock it', () => {
  const G = forest(), T = G.trees, P = G.player, e = G.mechs.find(m => m !== P);
  // Both on the same patch of ground, 100 m apart, on a line along a row.
  const z = mid(P.z), x = mid(P.x) - C / 2;
  for (const [m, dx] of [[P, 0], [e, 100]]) Object.assign(m, { x: x + dx, z, y: G.ter.height(x + dx, z) + 200 });   // over the hills
  T.dense.fill(0);
  assert.ok(canSee(G, e, P), 'seen across the open');
  assert.ok(inView(G, [P.x, P.y + 8, P.z], e));
  lay(T, z, x + C, x + 5 * C);
  assert.ok(!canSee(G, e, P), 'hidden by the woods');
  assert.ok(!inView(G, [P.x, P.y + 8, P.z], e), 'no brackets, no lock');
});

test('the editor\'s sight grid shades the woods too', () => {
  const G = forest(), T = G.trees, P = G.player, z = mid(P.z), x = mid(P.x);
  const eye = [x, G.ter.height(x, z) + 300, z];
  T.dense.fill(0);
  const open = sightGrid(G, eye, 140, { cell: 16 }).filter(c => c.seen).length;
  T.dense.fill(Math.ceil(T.full));
  const woods = sightGrid(G, eye, 140, { cell: 16 }).filter(c => c.seen).length;
  assert.ok(woods < open / 3, `${woods} seen in the woods, ${open} in the open`);
});
