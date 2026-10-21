// The DIGS AND FALLS overlay's log (docs/specs/19-debug-menu.md § Tuning and
// overlays): G.digLog holds each dig's box, each fall's box, and each
// overhang the torque rule weighed, for 10 s, and stays null (costing
// nothing) while the overlay is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { makeGround } from '../src/world/voxels.js';
import { polar } from '../src/sim/placement.js';
import { dig, DIG_LOG_S } from '../src/sim/dig.js';

const ARCH = [{ kind: 'arch', at: [0, 300] }], a = polar([0, 300]);
const game = () => {
  const G = createTestGame();
  for (const e of foes(G)) { freeze(e); e.x = 900; e.z = 900; }
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks: ARCH } });
  return G;
};
const cutLeg = G => {   // as test/torque.test.js: the +x leg cut through, then one dig there runs the rules
  for (const y of [0, 6, 12, 18]) for (const dz of [-8, 0, 8]) for (const dx of [-6, 0, 6]) G.ter.carve([a.x + 46 + dx, y, a.z + dz], 7);
  dig(G, [a.x + 46, G.ter.groundBelow(a.x + 46, 2, a.z), a.z], 4);
};

test('with the overlay off there is no log, and digging keeps none', () => {
  const G = game();
  assert.equal(G.digLog ?? null, null);
  cutLeg(G);
  assert.equal(G.digLog ?? null, null);
});

test('with it on, a dig logs its box, the break its fall, and each overhang weighed its load and section', () => {
  const G = game();
  G.digLog = [];
  cutLeg(G);
  const kinds = k => G.digLog.filter(e => e.kind === k);
  const [d] = kinds('dig');
  assert.ok(d && d.box[0] < a.x + 46 && d.box[3] > a.x + 46, 'the dig, boxed round where it hit');
  assert.ok(kinds('fall').length >= 1, 'the crown that fell');
  const w = kinds('weigh');
  assert.ok(w.some(e => e.broke), 'an overhang that broke');
  for (const e of w) assert.ok(e.load > 0 && e.section > 0 && Number.isFinite(e.x + e.y + e.z), 'each with its load, section and middle');
});

test('the log keeps the last ten seconds', () => {
  const G = game();
  G.digLog = [];
  dig(G, [0, 0, 0], 4);
  assert.equal(G.digLog.length, 1);
  stepFor(G, DIG_LOG_S + 0.5);
  dig(G, [40, 0, 0], 4);
  assert.equal(G.digLog.length, 1, 'the old one went');
  assert.ok(G.digLog[0].box[0] > 30);
});
