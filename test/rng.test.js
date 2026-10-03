import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/sim/rng.js';

test('same seed, same sequence; different seed, different', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const sa = Array.from({ length: 20 }, () => a.next()), sb = Array.from({ length: 20 }, () => b.next()), sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, sc);
});
test('range, int, pick and chance stay in bounds and are roughly uniform', () => {
  const r = makeRng(7);
  let sum = 0;
  for (let i = 0; i < 5000; i++) { const v = r.range(2, 5); assert.ok(v >= 2 && v < 5); sum += v; }
  assert.ok(Math.abs(sum / 5000 - 3.5) < 0.1);
  for (let i = 0; i < 100; i++) { const k = r.int(3); assert.ok(k >= 0 && k < 3 && Number.isInteger(k)); }
  assert.ok(['a', 'b'].includes(r.pick(['a', 'b'])));
  assert.equal(r.chance(0), false); assert.equal(r.chance(1), true);
  assert.ok([1, -1].includes(r.sign()));
});
