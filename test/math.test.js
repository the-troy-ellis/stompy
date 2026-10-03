import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M, TAU, chain, clampN, cross, dot, len, norm, wrapA } from '../src/util/math.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('wrapA keeps angles in (-pi, pi]', () => {
  near(wrapA(0), 0); near(wrapA(TAU), 0); near(wrapA(Math.PI * 1.5), -Math.PI / 2); near(wrapA(-Math.PI * 1.5), Math.PI / 2);
});
test('clampN clamps', () => { assert.equal(clampN(5, 0, 1), 1); assert.equal(clampN(-5, 0, 1), 0); assert.equal(clampN(0.5, 0, 1), 0.5); });
test('M.mul matches a known product and chain applies right to left', () => {
  const p = M.apply(chain(M.T(10, 0, 0), M.S(2)), [1, 1, 1]);   // scale then translate
  assert.deepEqual(p, [12, 2, 2]);
  const q = M.apply(M.mul(M.RY(Math.PI / 2), M.id()), [0, 0, 1]);
  near(q[0], 1); near(q[2], 0);
});
test('lookAt is orthonormal', () => {
  const m = M.lookAt([3, 4, 5], [0, 0, 0]);
  const x = [m[0], m[4], m[8]], y = [m[1], m[5], m[9]], z = [m[2], m[6], m[10]];
  for (const v of [x, y, z]) near(len(v), 1);
  near(dot(x, y), 0); near(dot(y, z), 0); near(len(cross(x, y)), 1);
  near(len(norm([3, 0, 4])), 1);
});
