import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGround, cornerIndex, VS, Y0, NX, NY, NZ, CX, CY } from '../src/world/voxels.js';
import { makeTerrain, HALF } from '../src/world/terrain.js';
import { MISSIONS } from '../src/data/missions.js';
import { flatZones, polar } from '../src/sim/placement.js';

let s = 1;
const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const same = (a, b) => a.D.length === b.D.length && a.D.every((v, i) => v === b.D[i]);

test('every mission keeps its hills: the top is within 2 m of the old height at 1,000 points', () => {
  MISSIONS.forEach((def, n) => {
    const seed = def.seed ?? 7 + n * 13, opts = { zones: flatZones(def) }, ground = makeGround(seed, opts, def), old = makeTerrain(seed, opts);
    let worst = 0;
    for (let k = 0; k < 1000; k++) {
      const x = (r() * 2 - 1) * (HALF - 100), z = (r() * 2 - 1) * (HALF - 100);
      worst = Math.max(worst, Math.abs(ground.height(x, z) - old.height(x, z)));
    }
    assert.ok(worst < 2, `mission ${n}: ${worst.toFixed(2)} m`);
  });
});

test('a flat ground is level, and building it is the same every time', () => {
  const a = makeGround(5, { flat: true }), b = makeGround(5, { flat: true });
  for (let k = 0; k < 50; k++) assert.ok(Math.abs(a.height((r() * 2 - 1) * 900, (r() * 2 - 1) * 900)) < 0.05);
  assert.ok(same(a, b));
  assert.ok(!same(makeGround(7), makeGround(8)));
  assert.equal(a.dirty.size, 0, 'nothing to rebuild on a fresh ground');
});

test('carving is the same in any order; it marks the chunks it touched and lowers the top', () => {
  const holes = [[[10, 2, 10], 6], [[14, 0, 6], 5], [[-30, 0, 40], 7], [[18, -4, 12], 4]];
  const a = makeGround(3, { flat: true }), b = makeGround(3, { flat: true });
  holes.forEach(([p, rr]) => a.carve(p, rr));
  [...holes].reverse().forEach(([p, rr]) => b.carve(p, rr));
  assert.ok(same(a, b));
  assert.ok(a.height(-30, 40) < -4, 'a crater where the blast was (8 m cells round it off)');
  assert.ok(a.solid(-30, -10, 40) && !a.solid(-30, -3, 40));
  assert.ok(a.dirty.size >= 1 && a.dirty.size <= 8);
  for (const id of a.dirty) assert.ok(id >= 0 && id < CX * CY * CX);
});

test('bedrock and the edges hold, whatever is dug or built', () => {
  const g = makeGround(3, { flat: true });
  g.carve([0, Y0 + VS, 0], 40);
  for (let i = NX / 2 - 3; i <= NX / 2 + 3; i++) for (let j = 0; j <= 1; j++) assert.equal(g.D[cornerIndex(i, j, NZ / 2)], 255, 'bedrock');
  assert.ok(g.groundBelow(0, 50, 0) > Y0 + VS);
  g.build([-HALF + 4, 20, 0], 30);
  g.build([0, Y0 + NY * VS - 4, 0], 30);
  for (let j = 0; j <= NY; j++) assert.ok(g.D[cornerIndex(0, j, NZ / 2)] === (j <= 1 ? 255 : 1), 'the edge stays air');
  for (let i = 0; i <= NX; i += 16) assert.equal(g.D[cornerIndex(i, NY, NZ / 2)], 1, 'and so does the top');
});

test('strokes replay to the same bytes; smooth softens a step', () => {
  const strokes = [[0, 120.5, 4, -310, 10], [1, 100, 6, -300, 8], [2, 118, 4, -305, 14]];
  const a = makeGround(9, {}, { ground: { strokes } }), b = makeGround(9, {}, { ground: { strokes } });
  assert.ok(same(a, b));
  assert.ok(!same(a, makeGround(9)));
  const g = makeGround(9, { flat: true });
  g.build([0, 0, 0], 12);
  const before = g.height(9, 0);
  g.smooth([0, 0, 0], 20);
  assert.notEqual(g.height(9, 0).toFixed(3), before.toFixed(3));
});

test("under a mesa's lip: height is the top, groundBelow is the ground under it", () => {
  const def = { ground: { landmarks: [{ kind: 'mesa', at: [0, 400], r: 60, top: 80, lip: 24 }] } };
  const g = makeGround(3, { flat: true }, def), c = polar([0, 400]);
  const x = c.x, z = c.z + 60 + 12;   // past the column, under the lip
  assert.ok(g.height(x, z) > 70, `the lip's top: ${g.height(x, z).toFixed(1)}`);
  assert.ok(Math.abs(g.groundBelow(x, 20, z)) < 1, `the ground under it: ${g.groundBelow(x, 20, z).toFixed(1)}`);
  assert.ok(g.solid(x, 75, z) && !g.solid(x, 30, z));
});

test('a ray meets an arch at its top and passes under it', () => {
  const def = { ground: { landmarks: [{ kind: 'arch', at: [0, 300], r: 46, thick: 9, face: 0 }] } };
  const g = makeGround(3, { flat: true }, def), c = polar([0, 300]), cy = -9 * 0.6;
  const under = g.ray([c.x, cy + 20, c.z - 100], [0, 0, 1], 200), over = g.ray([c.x, cy + 46, c.z - 100], [0, 0, 1], 200);
  assert.equal(under, null, 'the opening is open');
  assert.ok(over != null && Math.abs(over - 100) < 12, `the top stops it about where it stands: ${over}`);
  assert.ok(g.ray([0, 50, 0], [0, -1, 0], 100) - 50 < 0.5, 'and straight down meets the ground');
});

test('a tunnel goes through a hill, and a cave opens on its face', () => {
  const def = { ground: { landmarks: [{ kind: 'mesa', at: [0, 400], r: 80, top: 60, lip: 0 }, { kind: 'tunnel', from: [0, 300, 12], to: [0, 500, 12], r: 10 }] } };
  const g = makeGround(3, { flat: true }, def), c = polar([0, 400]);
  assert.ok(!g.solid(c.x, 12, c.z) && g.solid(c.x, 40, c.z), 'hollow inside, rock above');
  assert.ok(g.height(c.x, c.z) > 55, "and the top is the mesa's");
  assert.equal(g.ray([c.x, 12, c.z - 150], [0, 0, 1], 300), null, 'you can see down it');
});
