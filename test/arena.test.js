import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M, chain, makeMatrixArena } from '../src/util/math.js';
import { limb } from '../src/sim/gait.js';
import { norm, sub, mul, dot, len, cross } from '../src/util/math.js';

const same = (a, b) => { for (let i = 0; i < 16; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6, `[${i}] ${a[i]} vs ${b[i]}`); };

test('the arena builds the same matrices as M, from a pool it reuses each frame', () => {
  const A = makeMatrixArena(64);
  same(A.T(1, 2, 3), M.T(1, 2, 3)); same(A.S(2, 3, 4), M.S(2, 3, 4));
  for (const r of ['RX', 'RY', 'RZ']) same(A[r](0.7), M[r](0.7));
  same(A.chain(A.T(1, 2, 3), A.RY(0.4), A.RX(-0.2), A.S(1.5)), chain(M.T(1, 2, 3), M.RY(0.4), M.RX(-0.2), M.S(1.5)));
  const used = A.used;
  A.reset();
  const again = A.T(0, 0, 0);
  assert.equal(A.used, 1, 'reset starts the pool over');
  assert.ok(used > 1 && again instanceof Float32Array);
});

test('the arena chain takes up to ten matrices without allocating a list', () => {
  const A = makeMatrixArena(64), ms = Array.from({ length: 10 }, (_, i) => [A.RY(i * 0.1), M.RY(i * 0.1)]);
  same(A.chain(...ms.map(m => m[0])), chain(...ms.map(m => m[1])));
});

test('limb hangs a leg the same way as before, into the matrix it is given', () => {
  // The old version, kept here as the reference.
  const old = (P, Q, pole, s) => {
    const y = norm(sub(P, Q)); let z = sub(pole, mul(y, dot(pole, y)));
    z = len(z) < 1e-4 ? [0, 0, 1] : norm(z); const x = cross(y, z);
    return new Float32Array([x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, P[0], P[1], P[2], 1]);
  };
  const out = new Float32Array(16);
  for (const [P, Q, pole, s] of [[[0, 5, 0], [0.5, 2, 1], [0, 0, 1], 1.2], [[1, 4, 2], [1, 0, 2], [0, 1, 0], 0.9], [[3, 6, -1], [2, 3, 0], [0.3, 0.9, 0.3], 1]]) {
    assert.equal(limb(P, Q, pole, s, out), out);
    same(out, old(P, Q, pole, s));
  }
});
