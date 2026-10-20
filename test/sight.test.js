// Line of sight over the terrain (docs/specs/15-mission-editor.md § Tests):
// a foe on a ridge sees more than the same foe in a gully, and the AI and the
// editor ask the same question.
import { makeGround } from '../src/world/voxels.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sightGrid, blocked } from '../src/sim/sight.js';
import { canSee } from '../src/sim/ai/perception.js';
import { createTestGame } from './helpers.js';

// A ridge running north-south through x = 0, 60 m high, and a gully beside it.
const ridge = (x, z) => 60 * Math.exp(-(x * x) / (2 * 90 * 90)) - 25 * Math.exp(-((x - 260) ** 2) / (2 * 40 * 40)) + 0 * z;
const G = { ter: makeGround(1, { height: ridge }) };
const eye = (x, z) => [x, ridge(x, z) + 7, z];
const share = cells => cells.filter(c => c.seen).length / cells.length;

test('a foe on the ridge sees more than the same foe in the gully', () => {
  const top = sightGrid(G, eye(0, 0), 600), low = sightGrid(G, eye(260, 0), 600);
  assert.ok(top.length > 1000 && Math.abs(top.length - low.length) < 20, `grids of ${top.length} and ${low.length} cells`);
  assert.ok(share(top) > 0.6, `the ridge sees ${share(top)}`);   // not all: the gully's floor hides below the slope
  assert.ok(share(low) < share(top) - 0.25, `the gully sees ${share(low)}, the ridge ${share(top)}`);
  assert.ok(!low.find(c => c.x < -150 && Math.abs(c.z) < 30).seen, 'from the gully, the far side of the ridge is hidden');
});

test('the grid keeps inside the range', () => {
  for (const c of sightGrid(G, eye(0, 0), 300, { cell: 25 })) assert.ok(Math.hypot(c.x, c.z) <= 300);
});

test('the AI sees the player by the same test', () => {
  const g = createTestGame({ flat: true });
  const P = g.player, e = g.mechs.find(m => m.team === 1);
  e.x = P.x + 200; e.z = P.z; e.y = 0;
  assert.equal(canSee(g, e, P), true);
  assert.equal(blocked(g, [0, 5, 0], [200, 5, 0]), false);
  g.ter.block(P.x + 90, P.x + 110, -1150, 1150, 40);   // a wall between them
  assert.equal(canSee(g, e, P), false);
  assert.equal(blocked(g, [P.x, 5, 0], [P.x + 200, 5, 0]), true);
});
