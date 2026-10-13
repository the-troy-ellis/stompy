// The HUD's wireframe edges (src/mesh/wire.js): a box is twelve edges, not
// eighteen with the face diagonals, and a cylinder keeps its rings and sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireEdges } from '../src/mesh/wire.js';
import { Builder } from '../src/mesh/builder.js';
import { buildMechParts } from '../src/mesh/mechParts.js';
import { CHASSIS } from '../src/data/chassis.js';
import { M } from '../src/util/math.js';

const segs = w => w.length / 6;

test('a box is its twelve edges', () => {
  const b = new Builder(); b.cube(M.S(2, 1, 3), [1, 1, 1]);
  assert.equal(segs(wireEdges(b.d)), 12);
});

test('a tapered box keeps its twelve edges, and an 8-sided cylinder its rings and sides', () => {
  const b = new Builder(); b.cube(M.id(), [1, 1, 1], 0.6, 0.6);
  assert.equal(segs(wireEdges(b.d)), 12);
  const c = new Builder(); c.cyl(M.id(), [1, 1, 1], 8);
  assert.equal(segs(wireEdges(c.d)), 24, 'two rings of 8 and 8 sides');
});

test('every chassis part has a wireframe, far lighter than its triangles', () => {
  for (const [k, ch] of Object.entries(CHASSIS)) {
    let tris = 0, lines = 0;
    for (const b of Object.values(buildMechParts(ch))) {
      if (!b?.d) continue;
      tris += b.d.length / 27; lines += segs(wireEdges(b.d));
    }
    assert.ok(lines > 20, `${k}: ${lines} edges`);
    assert.ok(lines < tris * 1.6, `${k}: ${lines} edges for ${tris} triangles`);
  }
});
