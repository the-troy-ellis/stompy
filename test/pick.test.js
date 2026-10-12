// Picking on the ground (docs/specs/15-mission-editor.md § Tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNearest, pickInside, inside } from '../src/sim/pick.js';
import { BOUND } from '../src/world/terrain.js';

const things = [
  { id: 'tank', x: 0, z: 0, r: 5 },
  { id: 'truck', x: 7, z: 0, r: 2.2 },
  { id: 'foe', x: 100, z: 100, r: 6 },
  { id: 'edge', x: BOUND, z: -BOUND, r: 3 },
];

test('a tap picks the nearest thing it reaches, and nothing when it reaches none', () => {
  assert.equal(pickNearest(things, 1, 1)?.id, 'tank');
  assert.equal(pickNearest(things, 6.5, 0.5)?.id, 'truck', 'the truck beside the tank');
  assert.equal(pickNearest(things, 103, 98)?.id, 'foe');
  assert.equal(pickNearest(things, 50, 50), null);
  assert.equal(pickNearest(things, -30, 50, 80)?.id, 'tank', 'a fat finger reaches further');
  assert.equal(pickNearest([], 0, 0, 100), null);
});

test('a tap at the map edge still picks what stands there', () => {
  assert.equal(pickNearest(things, BOUND + 2, -BOUND - 1)?.id, 'edge');
  assert.equal(pickNearest(things, BOUND + 40, -BOUND, 10), null);
});

test('a box picks every centre inside it, turned or not', () => {
  assert.deepEqual(pickInside(things, [[-10, -10], [10, -10], [10, 10], [-10, 10]]).map(t => t.id), ['tank', 'truck']);
  const turned = [[0, -20], [20, 0], [0, 20], [-20, 0]];   // a diamond: the box on a screen turned 45°
  assert.deepEqual(pickInside(things, turned).map(t => t.id), ['tank', 'truck']);
  assert.ok(!inside(turned, 15, 15), 'a corner of the square is outside the diamond');
  assert.deepEqual(pickInside(things, [[BOUND - 5, -BOUND - 5], [BOUND + 5, -BOUND - 5], [BOUND + 5, -BOUND + 5], [BOUND - 5, -BOUND + 5]]).map(t => t.id), ['edge']);
  assert.deepEqual(pickInside(things, [[1, 1], [2, 1], [2, 2]]), [], 'a sliver has nothing in it');
});
