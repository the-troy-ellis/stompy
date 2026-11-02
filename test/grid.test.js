// The ground's corners in chunks (docs/specs/35-bigger-maps.md part 3): the
// same bytes as one big array, all-rock and all-air chunks shared until written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid, ROCK, AIR } from '../src/world/grid.js';

const PX = 40, PY = 20, PZ = 35, idx = (i, j, k) => i + PX * (j + PY * k);
// A little world: rock below j 8 (one whole row of chunks), air above j 9, a ramp between.
const fill = (c, i0, j0, k0) => { for (let k = k0; k < k0 + 16; k++) for (let j = j0; j < j0 + 8; j++) for (let i = i0; i < i0 + 16; i++) c[Grid.local(i, j, k)] = j < 8 ? 255 : j > 9 ? 1 : 100 + i; };

test('it holds the same bytes as a plain array, read either way', () => {
  const g = new Grid(PX, PY, PZ, fill), plain = new Uint8Array(PX * PY * PZ);
  for (let k = 0; k < PZ; k++) for (let j = 0; j < PY; j++) for (let i = 0; i < PX; i++) plain[idx(i, j, k)] = j < 8 ? 255 : j > 9 ? 1 : 100 + i;
  for (let k = 0; k < PZ; k++) for (let j = 0; j < PY; j++) for (let i = 0; i < PX; i++) {
    assert.equal(g.at(i, j, k), plain[idx(i, j, k)]);
    assert.equal(g.get(idx(i, j, k)), plain[idx(i, j, k)]);
  }
  assert.equal(g.length, plain.length);
});

test('all-rock and all-air chunks are shared until written, then copied', () => {
  const g = new Grid(PX, PY, PZ, fill), before = g.bytes;
  assert.ok(g.C.includes(ROCK) && g.C.includes(AIR), 'some of each');
  assert.ok(before < PX * PY * PZ, `${before} bytes of their own`);
  g.put(3, 15, 3, 1);   // air into air: nothing to copy
  assert.equal(g.bytes, before);
  g.set(idx(3, 17, 3), 200);   // rock in the air: that chunk gets its own bytes
  assert.equal(g.bytes, before + 2048);
  assert.equal(g.at(3, 17, 3), 200);
  assert.equal(AIR[Grid.local(3, 17, 3)], 1, 'the shared chunk is untouched');
  assert.equal(g.at(4, 17, 3), 1, 'its neighbours still air');
});

test('a clone shares nothing it could write to', () => {
  const a = new Grid(PX, PY, PZ, fill), b = a.clone();
  b.put(20, 9, 20, 9); b.put(5, 2, 5, 7);
  assert.equal(a.at(20, 9, 20), 120); assert.equal(a.at(5, 2, 5), 255);
  assert.equal(b.at(20, 9, 20), 9); assert.equal(b.at(5, 2, 5), 7);
});
