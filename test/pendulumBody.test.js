import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/state.js';
import { update, noInput } from '../src/sim/update.js';
import { recordFx } from '../src/sim/fx.js';
import { startWalkView } from '../src/sim/walkView.js';
import { BODY } from '../src/data/walk.js';

// The pendulum body (sim/gait.js, data/walk.js BODY): one mech walking at
// `thr` for `secs`, `each` called every frame after the first second.
function walk(model, { chassis = 'kestrel', thr = 1, secs = 6, each = () => {} } = {}) {
  const was = BODY.model;
  BODY.model = model;
  try {
    const G = createGame({ fx: recordFx(), seed: 1 });
    G.mode = 'sp';
    startWalkView(G, chassis);
    G.walk.thr = thr;
    for (let f = 0; f < secs * 60; f++) { G.clock += 1000 / 60; update(G, noInput(), 1 / 60); if (f > 60) each(G.player, f); }
    return G;
  } finally { BODY.model = was; }
}
const range = a => Math.max(...a) - Math.min(...a);

test('pendulum body: drawn only; the mech goes where it would under the old body', () => {
  const a = walk('old').player, b = walk('pendulum').player;
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9, `${a.z} vs ${b.z}`);
});

test('pendulum body: planted feet never slide', () => {
  let prev = null, worst = 0;
  walk('pendulum', { each: P => {
    if (prev) P.feet.forEach((f, i) => { if (!f.lifted && !prev[i].lifted) worst = Math.max(worst, Math.hypot(f.pos[0] - prev[i].pos[0], f.pos[2] - prev[i].pos[2])); });
    prev = P.feet.map(f => ({ lifted: f.lifted, pos: [...f.pos] }));
  } });
  assert.ok(worst < 1e-9, `a planted foot moved ${worst}`);
});

test('pendulum body: the hull rides higher over an upright leg, and rises and falls more than the old bob', () => {
  const rows = [];
  walk('pendulum', { each: P => rows.push([P.pDrop, P.bob]) });
  const old = [];
  walk('old', { each: P => old.push(P.bob) });
  const tall = rows.filter(r => r[0] < 0.05).map(r => r[1]), low = rows.filter(r => r[0] > 0.3).map(r => r[1]);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(tall.length && low.length);
  assert.ok(mean(tall) > mean(low) + 0.1, `over the leg ${mean(tall)}, between steps ${mean(low)}`);
  const steady = rows.slice(180).map(r => r[1]), oldSteady = old.slice(180);   // at full speed, after pulling away
  assert.ok(range(steady) > range(oldSteady) * 1.4, `${range(steady)} vs ${range(oldSteady)}`);
});

test('pendulum body: the torso follows the hull late', () => {
  const hull = [], torso = [];
  walk('pendulum', { chassis: 'puncher', each: P => { hull.push(P.bob); torso.push(P.bob + P.torsoDrop * P.ch.scale); } });
  const m = a => a.reduce((x, y) => x + y, 0) / a.length, mh = m(hull), mt = m(torso);
  const corr = l => { let c = 0; for (let i = 0; i + l < hull.length; i++) c += (hull[i] - mh) * (torso[i + l] - mt); return c; };
  const best = [0, 1, 2, 3, 4, 5, 6, 8, 10].reduce((b, l) => (corr(l) > corr(b) ? l : b), 0);
  assert.ok(best >= 2, `the torso is ${best} frames behind`);
  assert.ok(range(torso) > range(hull) * 0.6, 'it still goes with the hull');
});

test('pendulum body: back under the old body, the torso sits where it always did', () => {
  const G = walk('pendulum', { secs: 3 });
  BODY.model = 'old';
  try { G.clock += 1000 / 60; update(G, noInput(), 1 / 60); } finally { BODY.model = 'old'; }
  assert.equal(G.player.torsoDrop, null);
  assert.equal(G.player.torsoNod, 0);
});

test('pendulum body: standing still, nothing bobs', () => {
  const bobs = [];
  walk('pendulum', { thr: 0, secs: 4, each: P => bobs.push(P.bob) });
  assert.ok(range(bobs.slice(60)) < 1e-3, `${range(bobs.slice(60))}`);
});
