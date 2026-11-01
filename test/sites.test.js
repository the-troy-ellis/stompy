// Construction sites (docs/specs/23-construction-sites.md, 31-builder.md):
// placing a building puts down a site; ore is carried to it and builders'
// cranes build it, never past the ore delivered. Parked builders build on
// their own, parked haulers fetch silo ore for it, and diggers only dig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { PLACE } from '../src/data/construct.js';
import { footprintAt, placeSite, placeBuilding, siteProg, snapWall } from '../src/sim/base.js';
import { BUILDINGS } from '../src/data/construct.js';
import { raidTarget } from '../src/sim/raid.js';
import { destroyEntity } from '../src/sim/entities.js';
import { commandUp } from '../src/sim/crew.js';
import { shiftMech } from '../src/sim/walkView.js';

const DT = 1 / 60;
// You in `pilot`, the range's flat ground and silo, and `crew` parked (90 m right; a second at -90).
const game = (pilot = 'digger', crew = ['kestrel']) => {
  const G = createGame({ fx: recordFx(), seed: 4 }), def = rangeDef({ ground: 'flat', crew: crew[0], base: 'silo' });
  for (const type of crew.slice(1)) def.crew.push({ type, at: [-90, 30], face: 0 });
  startMatch(G, def, 4, false, pilot, { terrainOpts: { flat: true } });
  return G;
};
const run = (G, s, until = () => false, inp = () => noInput()) => { for (let i = 0; i < s / DT && !until(); i++) update(G, inp(i), DT); };
const site = (G, kind = 'factory', x = 0, z = -120) => { const f = footprintAt(G, x, z, 0, kind); assert.equal(f.why, null); return placeSite(G, f); };

test('BUILD puts down a site and pays nothing; it doesn\'t rise on its own', () => {
  const G = game(), P = G.player, ore = G.base.ore;
  Object.assign(P, { yaw: 0, twist: 0 });
  assert.ok(placeBuilding(G, P, 'factory'));
  const s = G.base.sites[0];
  assert.ok(s && s.kind === 'factory' && s.need === PLACE.factory.ore && s.swings === PLACE.factory.swings);
  assert.equal(G.base.ore, ore);
  run(G, 20);
  assert.equal(siteProg(s), 0);
});

test('a builder\'s BUILD builds a site, a piece a swing, never past the ore in it; then it says NEEDS ORE', () => {
  const G = game('builder'), P = G.player;
  Object.assign(P, { yaw: 0, twist: 0, pitch: 0 });
  placeBuilding(G, P, 'factory');
  const s = G.base.sites[0], e = s.parts[0];
  shiftMech(P, 0, e.z - e.radius - 6 - P.z);   // in the crane's reach
  s.ore = s.need / 2;
  run(G, 40, () => false, () => ({ ...noInput(), held: { ...noInput().held, energy: true } }));
  assert.equal(s.work, s.swings / 2, 'half the ore: half built');
  assert.ok(Math.abs(e.prog - 0.5) < 1e-9 && e.height < e.full);
  assert.ok(G.msgs.some(m => m.text === 'NEEDS ORE'));
  s.ore = s.need;
  run(G, 40, () => !G.base.sites.length, () => ({ ...noInput(), held: { ...noInput().held, energy: true } }));
  assert.equal(e.prog, 1); assert.equal(e.site, null);
  assert.ok(G.fx.calls('say').some(c => c.args[0] === 'Factory up.'));
  assert.equal(G.base.factory, e);
});

test('a crew mech with ore beside a site tips in what it needs', () => {
  const G = game(), P = G.player, s = site(G, 'bay', P.x, P.z + 18);
  P.ore = 40;
  run(G, 0.1);
  assert.equal(s.ore, s.need); assert.equal(P.ore, 40 - s.need);
  assert.ok(G.msgs.some(m => m.text === 'ORE ACROSS'));
});

test('a parked builder goes to a site with work and builds it, then stands', () => {
  const G = game('kestrel', ['builder']), b = G.crew.find(m => m.type === 'builder');
  run(G, 1);
  assert.equal(b.job, null, 'nothing to build: it stands');
  const s = site(G, 'bay', b.x - 60, b.z - 40);
  s.ore = s.need;
  run(G, 2);
  assert.equal(b.job, 'BUILDING');
  run(G, 90, () => !G.base.sites.length);
  assert.equal(G.base.sites.length, 0, 'built');
  assert.equal(s.parts[0].prog, 1);
  run(G, 1);
  assert.equal(b.job, null);
});

test('a parked digger leaves a site with work alone, and keeps digging', () => {
  const G = game('kestrel', ['digger']), d = G.crew.find(m => m.type === 'digger');
  d.site = { x: d.x, y: d.y, z: d.z, yaw: 0, pitch: 0, t: 0 };
  const s = site(G, 'bay', d.x - 60, d.z - 40);
  s.ore = s.need;
  run(G, 10);
  assert.equal(d.job, 'DIGGING');
  assert.equal(s.work, 0, 'not a swing of it');
});

test('a parked hauler fetches silo ore for a site and delivers it', () => {
  const G = game('kestrel', ['hauler']), h = G.crew.find(m => m.type === 'hauler');
  G.base.ore = 100;
  const s = site(G, 'factory', 120, -60);
  run(G, 1);
  assert.equal(h.job, 'FETCHING');
  run(G, 120, () => s.ore >= s.need);
  assert.equal(s.ore, s.need);
  assert.equal(G.base.ore, 100 - s.need, 'out of the silo, into the site');
  assert.equal(h.ore, 0);
});

test('up in the command view the crew builds on: a builder and a hauler raise a factory from nothing', () => {
  const G = game('kestrel', ['builder', 'hauler']);
  G.base.ore = 80;
  commandUp(G);
  const s = site(G, 'factory', 60, -80);
  run(G, 300, () => !G.base.sites.length);
  assert.equal(G.base.sites.length, 0, 'built');
  assert.equal(s.ore, s.need);
  assert.equal(G.base.factory.prog, 1);
});

test('a destroyed factory site frees the one factory; raiders hunt sites', () => {
  const G = game(), s = site(G, 'factory');
  assert.equal(footprintAt(G, 200, 200, 0, 'factory').why, 'built', 'one factory, counting its site');
  const e = s.parts[0];
  for (const m of G.crew) shiftMech(m, 900 - m.x, 900 - m.z);   // nobody near: buildings
  assert.equal(raidTarget(G, { x: e.x + 5, z: e.z }), e);
  destroyEntity(G, e, null);
  run(G, 0.1);
  assert.equal(G.base.sites.length, 0);
  assert.equal(footprintAt(G, 200, 200, 0, 'factory').why, null);
});

test('a wall near another\'s free end snaps on: in line, or round a corner, a slab apart; and it fits', () => {
  const G = game(), step = BUILDINGS.wall.radius * 1.9;
  assert.equal(snapWall(G, 0, -120), null, 'no walls: no snap');
  site(G, 'wall', 0, -120);
  // yaw 0: the wall runs along x, slabs at -step, 0, step.
  const line = snapWall(G, 3 * step + 1, -119);
  assert.ok(line && Math.abs(line.x - 3 * step) < 1e-9 && Math.abs(line.z + 120) < 1e-9 && line.yaw === 0, 'in line, the next slab a slab on');
  const f = footprintAt(G, line.x, line.z, line.yaw, 'wall');
  assert.equal(f.why, null, 'touching ends fit');
  const turn = snapWall(G, 2 * step, -120 + step + 0.5);
  assert.ok(turn && Math.abs(turn.x - 2 * step) < 1e-9 && Math.abs(turn.z - (-120 + step)) < 1e-9 && Math.abs(Math.abs(turn.yaw) - Math.PI / 2) < 1e-9, 'round a corner');
  assert.equal(footprintAt(G, turn.x, turn.z, turn.yaw, 'wall').why, null, 'the corner fits');
  assert.equal(snapWall(G, 30, -100), null, 'too far: no snap');
  placeSite(G, f);
  const next = snapWall(G, 6 * step, -120);
  assert.ok(next && Math.abs(next.x - 6 * step) < 1e-9, 'the new end, not the joined one');
  assert.equal(snapWall(G, 0, -110), null, 'beside the middle: nothing');
});
