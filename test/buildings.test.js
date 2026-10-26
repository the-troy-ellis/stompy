// More to build (docs/specs/21-mining.md § Buildings): BALLISTIC picks what
// BUILD puts down, a repair bay mends a crew mech on its pad, a wall is slabs
// that block, and raiders hunt bays but not walls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { CONSTRUCT, PLACE, PLACE_ORDER } from '../src/data/construct.js';
import { footprint, placeBuilding, buildTrigger, padOf, pickOf, pickNext, mend } from '../src/sim/base.js';
import { raidTarget } from '../src/sim/raid.js';
import { update } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { stepFor, input } from './helpers.js';

const base = () => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', crew: 'kestrel', base: 'silo' }), 4, false, 'digger', { terrainOpts: { flat: true } });
  G.base.ore = 500;
  Object.assign(G.player, { x: 200, z: -200, yaw: 0, twist: 0 });
  return G;
};
const said = G => G.fx.calls('say').map(c => c.args[0]);
// Every site down filled and built, as diggers and haulers would (docs/specs/23-construction-sites.md; test/sites.test.js does it for real).
const finish = G => { for (const s of G.base.sites) { s.ore = s.need; s.work = s.swings; } stepFor(G, 0.05); };

test('BALLISTIC picks FACTORY, BAY, WALL in turn, once a press, in a digger with a base', () => {
  const G = base();
  assert.deepEqual(PLACE_ORDER, ['factory', 'bay', 'wall']);
  assert.equal(pickOf(G), 'factory');
  update(G, input({ held: { ballistic: true } }), 1 / 60);
  update(G, input({ held: { ballistic: true } }), 1 / 60);
  assert.equal(pickOf(G), 'bay', 'held: one step');
  update(G, input({}), 1 / 60);
  update(G, input({ held: { ballistic: true } }), 1 / 60);
  assert.equal(pickOf(G), 'wall');
  pickNext(G);
  assert.equal(pickOf(G), 'factory', 'round again');
});

test('a bay goes down as a site; there can be more than one; the factory stays one, counting its site', () => {
  const G = base(), P = G.player;
  G.base.pick = 1;
  buildTrigger(G, P, true);
  assert.equal(G.buildAt.kind, 'bay');
  assert.equal(G.buildAt.w, PLACE.bay.w);
  buildTrigger(G, P, false);
  assert.equal(G.base.bays.length, 1);
  assert.equal(G.base.ore, 500, 'nothing paid now');
  const bay = G.base.bays[0];
  assert.ok(bay.mesh === 'bay' && bay.team === 0 && bay.prog < 0.1 && bay.site.need === PLACE.bay.ore);
  finish(G);
  assert.equal(bay.prog, 1);
  assert.ok(said(G).includes('Bay up.'));
  Object.assign(P, { x: -200, z: -200 });
  assert.ok(placeBuilding(G, P, 'bay'), 'a second one');
  assert.equal(G.base.bays.length, 2);
  Object.assign(P, { x: 200, z: 200 });
  assert.ok(placeBuilding(G, P, 'factory'));
  Object.assign(P, { x: -200, z: 200 });
  assert.equal(footprint(G, P, 'factory').why, 'built');
});

test('a wall is three slabs side by side across your view, sharing one site', () => {
  const G = base(), P = G.player;
  assert.ok(placeBuilding(G, P, 'wall'));
  const w = G.base.walls;
  assert.equal(w.length, PLACE.wall.segs);
  assert.ok(w.every(e => e.site === w[0].site) && w[0].site.need === PLACE.wall.ore, 'one site, the whole price');
  const xs = w.map(e => e.x).sort((a, b) => a - b);   // facing +z: the slabs run along x
  assert.ok(xs[2] - xs[0] > 7 && Math.abs(w[0].z - w[2].z) < 0.01);
  assert.ok(w.every(e => e.mesh === 'slab' && e.yaw === 0));
  finish(G);
  assert.ok(w.every(e => e.prog === 1));
  assert.equal(said(G).filter(s => s === 'Wall up.').length, 1, 'called once');
});

test('a crew mech on a finished bay\'s pad gets its armour back, worst section first, never one that is gone', () => {
  const G = base(), P = G.player;
  placeBuilding(G, P, 'bay');
  const bay = G.base.bays[0], k = G.crew[1];
  finish(G);
  k.hp.T = k.max.T * 0.5; k.hp.LA = k.max.LA * 0.2; k.hp.RA = 0;
  const [px, pz] = padOf(bay);
  Object.assign(k, { x: px, z: pz });
  const la = k.hp.LA;
  stepFor(G, 0.5);
  assert.ok(k.hp.LA > la, 'the worst first');
  assert.equal(k.hp.RA, 0, 'a gone arm stays gone');
  stepFor(G, 60);
  assert.equal(k.hp.T, k.max.T);
  assert.equal(k.hp.LA, k.max.LA);
  assert.equal(mend(k, 5), 0, 'nothing left to mend');
});

test('the bay mends only on its pad and once it is up; the player hears REPAIRING once', () => {
  const G = base(), P = G.player;
  placeBuilding(G, P, 'bay');
  const bay = G.base.bays[0], [px, pz] = padOf(bay);
  P.hp.T = 10;
  Object.assign(P, { x: px, z: pz });
  stepFor(G, 1);
  assert.equal(P.hp.T, 10, 'still a site');
  finish(G); stepFor(G, 1);
  assert.ok(P.hp.T > 10 && G.mending);
  assert.equal(G.msgs.filter(m => m.text === 'REPAIRING').length, 1);
});

test('raiders hunt the bays with the silo and factory, never the walls', () => {
  const G = base(), P = G.player;
  placeBuilding(G, P, 'wall');
  const raider = { x: G.base.walls[1].x, z: G.base.walls[1].z + 3 };
  for (const m of G.crew) Object.assign(m, { x: 900, z: 900 });   // nobody near: buildings
  assert.notEqual(raidTarget(G, raider)?.tags?.[0], 'wall');
  Object.assign(P, { x: 900, z: 900 });
  G.base.ore = 500; Object.assign(P, { x: -300, z: 300 });
  placeBuilding(G, P, 'bay');
  for (const m of G.crew) Object.assign(m, { x: 900, z: 900 });
  const bay = G.base.bays[0];
  assert.equal(raidTarget(G, { x: bay.x + 5, z: bay.z }), bay);
});

test('the footprint fits its kind: a wall is long and thin, wants a little less flat', () => {
  const G = base(), P = G.player;
  const w = footprint(G, P, 'wall'), f = footprint(G, P, 'factory');
  assert.equal(w.w, 12); assert.equal(w.d, 3);
  assert.ok(Math.hypot(w.x - P.x, w.z - P.z) < Math.hypot(f.x - P.x, f.z - P.z), 'a thin one sits nearer');
  G.base.ore = 0;
  assert.equal(footprint(G, P, 'wall').why, null, 'no ore needed to place');
  assert.equal(CONSTRUCT.bayRate > 0, true);
});
