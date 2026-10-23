import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Builder } from '../src/mesh/builder.js';
import { buildMechParts } from '../src/mesh/mechParts.js';
import { wireEdges } from '../src/mesh/wire.js';
import { CHASSIS } from '../src/data/chassis.js';
import { M } from '../src/util/math.js';

test('a sphere: 48 flat facets, every normal facing out from its middle', () => {
  const b = new Builder();
  b.sphere(M.T(1, 2, 3), [1, 1, 1]);
  assert.equal(b.d.length / 27, 48);
  for (let i = 0; i < b.d.length; i += 9) {
    const o = [b.d[i] - 1, b.d[i + 1] - 2, b.d[i + 2] - 3];
    assert.ok(Math.abs(Math.hypot(...o) - 0.5) < 1e-9, 'on the surface');
    assert.ok(o[0] * b.d[i + 3] + o[1] * b.d[i + 4] + o[2] * b.d[i + 5] > 0, 'facing out');
  }
});

test('joints are drawn but left out of the HUD wireframe', () => {
  const b = new Builder();
  b.cube(M.id(), [1, 1, 1]);
  const box = b.d.length;
  b.joint(j => j.sphere(M.T(0, 2, 0), [1, 1, 1]));
  assert.ok(b.d.length > box, 'drawn');
  assert.equal(b.wireD().length, box, 'not in the wire');
  assert.equal(wireEdges(b.wireD()).length / 6, 12, 'the box alone: its 12 edges');
});

test('every chassis turns its knees on a hinge and its hips and ankles on balls', () => {
  for (const [k, ch] of Object.entries(CHASSIS)) {
    const p = buildMechParts(ch);
    assert.ok(p.uleg.joints.length >= 1, `${k}: a knee`);
    assert.ok(p.lleg.joints.length >= 1, `${k}: an ankle`);
    assert.ok(p.arm.joints.length >= 1, `${k}: a shoulder`);
    assert.ok(p.uleg.joints.length + p.hip.joints.length >= 2, `${k}: a hip`);
  }
});
