// Territory (docs/specs/33-production.md § Beacons and territory): nodes link
// within range, three linked to each other make a triangle, and the land is
// every triangle together; more nodes overlap, so one lost loses less.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { territory, inTri, inTerritory } from '../src/sim/territory.js';

const at = (...xz) => xz.map(([x, z]) => ({ x, z }));

test('two nodes make a link and no land; three linked make a triangle', () => {
  const two = at([0, 0], [100, 0]);
  assert.deepEqual(territory(two, 200), { links: [[0, 1]], tris: [] });
  assert.equal(inTerritory(two, territory(two, 200), 50, 0), false, 'a line is no land');
  const three = at([0, 0], [100, 0], [0, 100]), t = territory(three, 200);
  assert.deepEqual(t.tris, [[0, 1, 2]]);
  assert.ok(inTerritory(three, t, 20, 20));
  assert.ok(!inTerritory(three, t, 80, 80), 'past the long side');
});

test('nodes too far apart don\'t link, so three far apart make no triangle', () => {
  const far = at([0, 0], [300, 0], [0, 300]), t = territory(far, 200);
  assert.deepEqual(t.links, []);
  assert.deepEqual(t.tris, []);
});

test('only three all linked to each other make a triangle', () => {
  const chain = at([0, 0], [150, 0], [300, 0], [150, 120]), t = territory(chain, 200);   // 0 and 2 are 300 apart
  assert.deepEqual(t.tris, [[0, 1, 3], [1, 2, 3]]);
});

test('more nodes overlap: losing one keeps the middle covered', () => {
  const square = at([0, 0], [150, 0], [150, 150], [0, 150]), mid = [75, 75];
  const t = territory(square, 250);
  assert.equal(t.tris.length, 4, 'every three of the four');
  assert.ok(inTerritory(square, t, ...mid));
  for (let lost = 0; lost < 4; lost++) {
    const left = square.filter((_, i) => i !== lost), u = territory(left, 250);
    assert.ok(inTerritory(left, u, ...mid), `still covered without node ${lost}`);
  }
  const three = at([0, 0], [150, 0], [0, 150]), u = territory(three.slice(1), 250);
  assert.ok(!inTerritory(three.slice(1), u, 20, 20), 'with only three, one lost loses it all');
});

test('a triangle\'s edges and corners count as inside', () => {
  const [a, b, c] = at([0, 0], [10, 0], [0, 10]);
  assert.ok(inTri(a, b, c, 0, 0) && inTri(a, b, c, 5, 0) && inTri(a, b, c, 5, 5));
  assert.ok(!inTri(a, b, c, -0.1, 5) && !inTri(a, b, c, 6, 6));
});
