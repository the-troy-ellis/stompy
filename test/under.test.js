// Tunnelling in, part 1 (docs/specs/37-tunnelling.md): how deep you are,
// SURFACE when digging up near the top, the mark you follow, what's above.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { cabTop, depthOf, underground, nearSurface, setMark, clearMark, markAt, above, stepTunnels } from '../src/sim/under.js';
import { UNDER } from '../src/data/construct.js';

const game = () => {
  const G = createGame({ fx: recordFx(), seed: 3 });
  startMatch(G, { name: 'Under', pal: 'dusk', intel: '', foes: [{ type: 'jackal', at: [0, 40] }], base: { silo: [180, 30] } }, 3, false, 'digger', { terrainOpts: { flat: true } });
  return G;
};
const sink = (G, m, d) => { m.y = G.ter.height(m.x, m.z) - d - (cabTop(m) - m.y); };   // the cab's top d m under the surface

test('on the surface: no depth, not underground', () => {
  const G = game(), P = G.player;
  assert.equal(depthOf(G, P), 0);
  assert.equal(underground(G, P), false);
});

test('down a tunnel: the depth is the ground over the cab; under UNDER.above it isn\'t underground yet', () => {
  const G = game(), P = G.player;
  sink(G, P, 14);
  assert.ok(Math.abs(depthOf(G, P) - 14) < 1e-6);
  assert.equal(underground(G, P), true);
  sink(G, P, UNDER.above / 2);
  assert.equal(underground(G, P), false);
});

test('SURFACE: underground, aimed upward and under UNDER.surface to go; not when aimed level or deep', () => {
  const G = game(), P = G.player;
  sink(G, P, 3); P.pitch = 0.4;
  assert.equal(nearSurface(G, P), true);
  P.pitch = 0;
  assert.equal(nearSurface(G, P), false);
  sink(G, P, 10); P.pitch = 0.4;
  assert.equal(nearSurface(G, P), false);
});

test('a mark on a thing follows it and goes when it does; a mark on the ground stays; one at a time', () => {
  const G = game(), foe = G.mechs.find(m => m.team !== 0);
  assert.equal(markAt(G), null);
  setMark(G, foe);
  assert.ok(Math.abs(markAt(G)[0] - foe.x) < 1e-9);
  foe.x += 30;
  assert.ok(Math.abs(markAt(G)[0] - foe.x) < 1e-9, 'it follows');
  foe.alive = false;
  assert.equal(markAt(G), null, 'gone with it');
  assert.equal(G.mark, null);
  setMark(G, G.base.silo);
  setMark(G, { x: 100, z: -50 });
  const at = markAt(G);
  assert.deepEqual([at[0], at[2]], [100, -50], 'marking again moves it');
  clearMark(G);
  assert.equal(markAt(G), null);
});

test('what\'s above: structures and mechs within UNDER.sense, foes marked as foes', () => {
  const G = game(), P = G.player, foe = G.mechs.find(m => m.team !== 0), s = G.base.silo;
  Object.assign(P, { x: foe.x + 20, z: foe.z });
  let got = above(G, P);
  assert.ok(got.some(a => a.foe && Math.abs((a.box[0] + a.box[3]) / 2 - foe.x) < 1e-6), 'the foe');
  assert.ok(!got.some(a => Math.abs((a.box[0] + a.box[3]) / 2 - P.x) < 1e-6 && Math.abs((a.box[2] + a.box[5]) / 2 - P.z) < 1e-6), 'not you');
  Object.assign(P, { x: s.x + 10, z: s.z });
  got = above(G, P);
  assert.ok(got.some(a => !a.foe && a.box[4] - a.box[1] === s.height), 'your silo, its full height');
  Object.assign(P, { x: s.x + UNDER.sense + 200, z: s.z });
  assert.ok(!above(G, P).some(a => a.box[4] - a.box[1] === s.height), 'too far');
});

test('a new match starts with no mark', () => {
  const G = game();
  setMark(G, { x: 10, z: 10 });
  startMatch(G, { name: 'Again', pal: 'dusk', intel: '', foes: ['jackal'] }, 4, false, 'kestrel', { terrainOpts: { flat: true } });
  assert.equal(markAt(G), null);
});

test('tunnels: underground, a point every UNDER.trail; surfacing ends the line, going down again starts another', () => {
  const G = game(), P = G.player;
  stepTunnels(G);
  assert.equal(G.tunnels.length, 0, 'on the surface: none');
  const x0 = P.x;
  for (let i = 0; i <= 30; i++) { P.x = x0 + i; sink(G, P, 10); stepTunnels(G); }
  assert.equal(G.tunnels.length, 1);
  const pts = G.tunnels[0].pts;
  assert.equal(pts.length, 1 + Math.floor(30 / UNDER.trail), `${pts.length} points over 30 m`);
  P.y = G.ter.height(P.x, P.z); stepTunnels(G);
  assert.equal(G.tunnels[0].open, false, 'up: the line ends');
  sink(G, P, 10); stepTunnels(G);
  assert.equal(G.tunnels.length, 2, 'down again: a new line');
});

test('tunnels: at most UNDER.points kept, the oldest dropped first; a new match has none', () => {
  const G = game(), P = G.player, x0 = P.x, n = UNDER.points + 50;
  for (let i = 0; i < n; i++) { P.x = x0 + (i % 2 ? UNDER.trail + 1 : 0); sink(G, P, 10); stepTunnels(G); }
  const all = G.tunnels.reduce((k, t) => k + t.pts.length, 0);
  assert.equal(all, UNDER.points);
  startMatch(G, { name: 'Again', pal: 'dusk', intel: '', foes: ['jackal'] }, 4, false, 'kestrel', { terrainOpts: { flat: true } });
  assert.deepEqual(G.tunnels, []);
});
