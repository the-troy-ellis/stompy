import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M, frustumPlanes, sphereVisible } from '../src/util/math.js';

// A camera at the origin looking down +z, 60° tall, 16:9, 0.5 m to 1000 m.
const VP = M.mul(M.persp(Math.PI / 3, 16 / 9, 0.5, 1000), M.lookAt([0, 0, 0], [0, 0, 1]));
const P = frustumPlanes(VP);

test('a sphere ahead is seen; behind, far off to the side, beyond the far plane it is not', () => {
  assert.ok(sphereVisible(P, 0, 0, 50, 1), 'dead ahead');
  assert.ok(!sphereVisible(P, 0, 0, -50, 1), 'behind');
  assert.ok(!sphereVisible(P, 200, 0, 50, 1), 'far to the side');
  assert.ok(!sphereVisible(P, 0, 0, 1200, 1), 'past the far plane');
  assert.ok(!sphereVisible(P, 0, 100, 50, 1), 'high overhead');
});

test('a big sphere just outside the edge still counts: culling never pops a mech whose arm pokes in', () => {
  const edge = Math.tan(Math.PI / 6) * 16 / 9 * 50;   // the right edge at 50 m
  assert.ok(!sphereVisible(P, edge + 3, 0, 50, 1));
  assert.ok(sphereVisible(P, edge + 3, 0, 50, 6), 'its radius reaches in');
  assert.ok(sphereVisible(P, 0, 0, -0.5, 1.5), 'straddling the camera');
});

test('the planes agree with projecting the point: inside the frustum exactly when inside clip space', () => {
  const clip = p => { const v = [0, 0, 0, 0]; for (let r = 0; r < 4; r++) v[r] = VP[r] * p[0] + VP[4 + r] * p[1] + VP[8 + r] * p[2] + VP[12 + r]; return v; };
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const p = [Math.sin(i * 1.7) * 120, Math.cos(i * 2.3) * 60, Math.sin(i * 0.9) * 300 + 150], c = clip(p);
    const inside = c[3] > 0 && Math.abs(c[0]) <= c[3] && Math.abs(c[1]) <= c[3] && Math.abs(c[2]) <= c[3];
    if (Math.min(Math.abs(c[3] - Math.abs(c[0])), Math.abs(c[3] - Math.abs(c[1]))) < 1e-3) continue;   // on an edge
    assert.equal(sphereVisible(P, p[0], p[1], p[2], 0), inside, `point ${p.map(v => v.toFixed(1))}`);
    n++;
  }
  assert.ok(n > 300);
});
