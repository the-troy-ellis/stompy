import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { destroyEntity } from '../src/sim/entities.js';
import { objectivePoint } from '../src/sim/objectives.js';
import { polar } from '../src/sim/placement.js';
import { objectiveLine, fmtClock, fmtDist, markerEdge } from '../src/render/hud.js';

function mission(def) {
  const G = createGame({ fx: recordFx(), seed: 9 });
  startMatch(G, { name: 'Test', pal: 'dusk', intel: '', foes: ['jackal'], ...def }, 9, false, 'kestrel', { terrainOpts: { flat: true } });
  for (const e of foes(G)) { freeze(e); Object.assign(e, { x: 900, z: -900 }); }
  return G;
}
const said = (G, line) => G.fx.calls('say').some(c => c.args[0] === line);

test('the objective line reads as the spec shows, and never runs past 24 characters', () => {
  assert.equal(fmtClock(102), '1:42'); assert.equal(fmtClock(59.2), '1:00'); assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtDist(640.4), '640 m'); assert.equal(fmtDist(1234), '1.2 km');
  const L = o => objectiveLine(o);
  assert.equal(L({ def: { type: 'destroy', label: 'RELAY' }, done: 2, total: 3, targets: [] }), 'DESTROY RELAY 2/3');
  assert.equal(L({ def: { type: 'survive', seconds: 150 }, left: 102 }), 'SURVIVE 1:42');
  assert.equal(L({ def: { type: 'escort' }, dist: 640 }), 'ESCORT 640 m');
  assert.equal(L({ def: { type: 'extract', within: 180 }, dist: 1200, left: 161 }), 'EXTRACT 1.2 km 2:41');
  assert.equal(L({ def: { type: 'eliminate' }, left: 1, total: 3 }), 'ELIMINATE 2/3');
  const long = L({ def: { type: 'destroy', label: 'EXTREMELY LONG STRUCTURE NAME' }, done: 1, total: 12, targets: [] });
  assert.ok(long.length <= 24 && long.endsWith('1/12'), long);
});

test('off-screen markers sit on the edge toward the objective: ahead at the top, behind at the bottom, sides at the sides', () => {
  const W = 800, top = 70, bottom = 470, m = 18;
  const ahead = markerEdge(W, top, bottom, m, 0), behind = markerEdge(W, top, bottom, m, Math.PI);
  const left = markerEdge(W, top, bottom, m, Math.PI / 2), right = markerEdge(W, top, bottom, m, -Math.PI / 2);
  assert.ok(Math.abs(ahead.x - 400) < 1e-6 && Math.abs(ahead.y - top) < 1e-6);
  assert.ok(Math.abs(behind.y - bottom) < 1e-6);
  assert.ok(Math.abs(left.x - m) < 1e-6, 'a bearing to the left is on the left edge');
  assert.ok(Math.abs(right.x - (W - m)) < 1e-6);
  const tip = e => [Math.sin(e.a), -Math.cos(e.a)];   // where the arrow (drawn pointing up, then rotated by a) points on screen
  assert.ok(tip(ahead)[1] < -0.99 && tip(behind)[1] > 0.99 && tip(left)[0] < -0.99 && tip(right)[0] > 0.99, 'the arrow points the way');
  const diag = markerEdge(W, top, bottom, m, Math.PI / 4);
  assert.ok(diag.x >= m - 1e-6 && diag.x <= W - m + 1e-6 && diag.y >= top - 1e-6 && diag.y <= bottom + 1e-6, 'always on the frame');
});

test('markers point at the nearest standing target, the extraction point; not at a clock; and the voice calls each structure down', () => {
  const G = mission({
    entities: [{ kind: 'structure', id: 'a', at: [0, 200], tags: ['relay'], hp: 10 }, { kind: 'structure', id: 'b', at: [180, 400], tags: ['relay'], hp: 10 },
      { kind: 'nav', id: 'lz', at: [90, 300] }],
    objectives: [{ type: 'destroy', targets: ['relay'], label: 'RELAY' }, { type: 'extract', at: 'lz', after: 0 }, { type: 'survive', seconds: 999, secondary: true }],
  });
  stepFor(G, DT);
  const [d, x, s] = G.objectives, A = polar([0, 200]);
  const p = objectivePoint(G, d);
  assert.ok(Math.abs(p[0] - A.x) < 1e-6 && Math.abs(p[2] - A.z) < 1e-6, 'the nearer relay');
  assert.equal(objectivePoint(G, x), null, 'nothing for a waiting objective');
  assert.equal(objectivePoint(G, s), null, 'nothing for a clock');
  destroyEntity(G, G.entities[0], G.player);
  stepFor(G, DT);
  assert.ok(said(G, 'Structure destroyed.') || said(G, 'Structure destroyed. It was in the way.'));
  const q = objectivePoint(G, d), B = polar([180, 400]);
  assert.ok(Math.abs(q[2] - B.z) < 1e-6, 'then the other one');
  destroyEntity(G, G.entities[1], G.player);
  stepFor(G, DT * 2);
  const L = polar([90, 300]), r = objectivePoint(G, x);
  assert.ok(Math.abs(r[0] - L.x) < 1e-6, 'then the way out');
  Object.assign(G.player, { x: L.x, z: L.z }); initFeet(G, G.player);
  stepFor(G, DT);
  assert.ok(said(G, 'Extraction point reached.') || said(G, 'Extraction point reached. Nobody is here.'));
});
