// The forest, part 4 (docs/specs/39-forest.md): fighting up close. A foe
// among trees that can't see you holds still (HARD all, EASY none) until
// it's found or tired of waiting; foes hide in the woods when hot or hurt;
// snipers look for clearings; and a foe you hear but can't see gets HEARD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { think, ambushing } from '../src/sim/ai.js';
import { findCover, findRidge } from '../src/sim/ai/behaviours.js';
import { audible } from '../src/sim/sight.js';
import { TREES } from '../src/data/forest.js';
import { BX, BZ } from '../src/world/terrain.js';

const C = TREES.cell;
const forest = (diff = 'hard') => {
  const G = createGame({ fx: recordFx(), seed: 7 });
  G.diff = diff;
  startMatch(G, { name: 'Forest', pal: 'forest', intel: '', foes: ['jackal'] }, 7, false, 'kestrel');
  const P = G.player, e = G.mechs.find(m => m !== P);
  G.trees.dense.fill(Math.ceil(G.trees.full));   // thick woods everywhere: the tests lay their own
  Object.assign(e, { x: P.x + 120, z: P.z, y: G.ter.height(P.x + 120, P.z) });
  Object.assign(e.ai, { aware: true, state: 'engage', belief: { x: P.x, y: P.y, z: P.z, vx: 0, vz: 0, at: G.time }, lastSeen: G.time, seen: false, lookT: 0 });
  return { G, P, e };
};
const run = (G, e, s) => { for (let k = 0; k < s * 20; k++) { think(G, e, 0.05); G.time += 0.05; } };
const cellOf = (T, x, z) => Math.floor((x + BX) / C) + T.nx * Math.floor((z + BZ) / C);

test('HARD: a foe among trees that can\'t see you holds still', () => {
  const { G, e } = forest('hard');
  run(G, e, 2);
  assert.equal(e.ai.seen, false, 'the woods hide you');
  assert.ok(ambushing(G, e, false));
  assert.equal(e.throttle, 0);
});

test('EASY: it comes on through the trees', () => {
  const { G, e } = forest('easy');
  run(G, e, 2);
  assert.equal(e.ai.seen, false);
  assert.ok(e.throttle > 0);
});

test('out of the woods it doesn\'t wait', () => {
  const { G, e } = forest('hard');
  G.trees.dense[cellOf(G.trees, e.x, e.z)] = 0;   // a clearing where it stands
  assert.equal(ambushing(G, e, false), false);
  run(G, e, 1);
  assert.ok(e.throttle > 0);
});

test('a hit means it\'s been found; and past TREES.wait it goes looking', () => {
  const { G, e } = forest('hard');
  run(G, e, 1);
  e.ai.hitAt = G.time;
  assert.equal(ambushing(G, e, false), false, 'hit');
  G.time += 4;
  assert.ok(ambushing(G, e, false), 'settled again');
  e.ai.lastSeen = G.time - TREES.wait - 1;
  assert.equal(ambushing(G, e, false), false, 'tired of waiting');
});

test('a foe that sees you fights as ever', () => {
  const { G, e } = forest('hard');
  assert.equal(ambushing(G, e, true), false);
});

test('hot, it hides in the woods even with no hill about', () => {
  const { G, P, e } = forest('hard');
  Object.assign(e, { x: P.x + 40, z: P.z });
  const c = findCover(G, e, P);
  assert.ok(c, 'somewhere in the woods');
  assert.ok(Math.hypot(c.x - P.x, c.z - P.z) > 60, 'deep enough in to be hidden');
});

test('snipers look for clearings: a ridge over you in the open, none through thick woods', () => {
  const { G, P, e } = forest('hard');
  Object.assign(P, { x: -600, z: -600, y: G.ter.height(-600, -600) });   // under seed 7's hills
  G.trees.dense.fill(0);
  assert.ok(findRidge(G, e, P), 'in the open');
  G.trees.dense.fill(Math.ceil(G.trees.full));
  assert.equal(findRidge(G, e, P), null, 'in the woods');
});

test('HEARD: a foe on the move that the woods hide; not one standing still, nor one in plain view', () => {
  const { G, P, e } = forest('hard');
  const eye = [P.x, P.y + 8, P.z];
  e.speed = 5;
  assert.ok(audible(G, eye, e), 'heard');
  e.speed = 0;
  assert.ok(!audible(G, eye, e), 'still: silent');
  e.speed = 5;
  G.trees.dense.fill(0);
  assert.ok(!audible(G, eye, e), 'in view: seen, not heard');
  Object.assign(e, { x: P.x + TREES.hear + 50 });
  G.trees.dense.fill(Math.ceil(G.trees.full));
  assert.ok(!audible(G, eye, e), 'too far');
});
