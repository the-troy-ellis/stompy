// Build and fight, the base (docs/specs/20-build-and-fight.md § Two
// buildings): the silo takes a digger's ore; BUILD puts the factory on flat
// ground for its price; it goes up, then turns ore and salvage into a
// KESTREL that joins the crew.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { footprint, placeFactory, placeBuilding, padOf } from '../src/sim/base.js';
import { rangeDef } from '../src/data/range.js';
import { stepFor, input } from './helpers.js';
import { update } from '../src/sim/update.js';

const base = (opts = {}) => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', crew: 'kestrel', base: 'silo', ...opts }), 4, false, 'digger', { terrainOpts: { flat: true } });
  return G;
};
const said = G => G.fx.calls('say').map(c => c.args[0]);
// Every site down filled and built, as diggers and haulers would (docs/specs/23-construction-sites.md; test/sites.test.js does it for real).
const finish = G => { for (const s of G.base.sites) { s.ore = s.need; s.work = s.swings; } stepFor(G, 0.05); };

test('a mission with a base starts with the silo and some ore in it', () => {
  const G = base();
  assert.ok(G.base && G.base.silo.alive && G.base.silo.mesh === 'silo' && G.base.silo.team === 0);
  assert.equal(G.base.ore, CONSTRUCT.startOre);
  assert.equal(base({ base: 'none' }).base, null, 'no base: none');
});

test('a digger on the silo\'s pad empties its hopper into the silo', () => {
  const G = base(), P = G.player, [px, pz] = padOf(G.base.silo);
  P.ore = 24;
  Object.assign(P, { x: px + 30, z: pz });
  stepFor(G, 0.2);
  assert.equal(P.ore, 24, 'not on the pad yet');
  Object.assign(P, { x: px, z: pz });
  stepFor(G, 0.2);
  assert.equal(P.ore, 0);
  assert.equal(G.base.ore, CONSTRUCT.startOre + 24);
  assert.ok(said(G).includes('Ore in.'));
});

test('the footprint wants flat ground and nobody on it, not ore (it is carried to the site)', () => {
  const G = base(), P = G.player;
  Object.assign(P, { x: 200, z: -200, yaw: 0, twist: 0 });
  assert.ok(CONSTRUCT.startOre < CONSTRUCT.factory);
  assert.equal(footprint(G, P).why, null, 'flat and clear: it fits, short of ore or not');
  const f = footprint(G, P);
  G.ter.block(f.x - 4, f.x + 4, f.z - 4, f.z + 4, 12);
  assert.equal(footprint(G, P).why, 'room', 'a lump in it: no room');
  Object.assign(P, { x: -200, z: -200 });
  const k = G.crew[1]; Object.assign(k, { x: -200, z: -180 });
  assert.equal(footprint(G, P).why, 'room', 'a mech on it: no room');
});

test('a factory\'s site goes down where it fits, free, and goes up once filled and built', () => {
  const G = base(), P = G.player;
  G.base.ore = 100;
  Object.assign(P, { x: 200, z: -200, yaw: 0, twist: 0 });
  assert.equal(footprint(G, P, 'factory').why, null, 'it fits');
  placeBuilding(G, P, 'factory');   // the command view's BUILD puts one down so (ui/command.js, docs/specs/31-builder.md)
  const f = G.base.factory;
  assert.ok(f && f.mesh === 'factory' && f.team === 0);
  assert.equal(G.base.ore, 100, 'nothing paid yet');
  assert.ok(f.site && f.prog < 0.1 && f.height < 2, 'a site: it starts low');
  stepFor(G, CONSTRUCT.buildTime + 0.2);
  assert.equal(f.prog, 0, 'nothing rises on a timer');
  finish(G);
  assert.equal(f.prog, 1);
  assert.equal(f.height, f.full);
  assert.ok(said(G).includes('Factory up.'));
  assert.equal(placeFactory(G, P), false, 'one factory');
});

test('the factory turns ore and salvage into a KESTREL that joins the crew, parked', () => {
  const G = base(), P = G.player;
  G.base.ore = 200;
  Object.assign(P, { x: 200, z: -200, yaw: 0, twist: 0 });
  placeFactory(G, P);
  finish(G);
  const crew = G.crew.length;
  stepFor(G, 5);
  assert.equal(G.base.factory.job, null, 'no salvage yet: it waits');
  G.base.salvage = CONSTRUCT.mechCost.salvage;
  stepFor(G, 1);
  assert.ok(G.base.factory.job != null, 'started');
  assert.equal(G.base.salvage, 0);
  stepFor(G, CONSTRUCT.mechTime);
  assert.equal(G.crew.length, crew + 1);
  const k = G.crew[G.crew.length - 1];
  assert.ok(k.type === 'kestrel' && k.parked && k.team === 0 && G.mechs.includes(k));
  assert.ok(said(G).includes('New mech ready.'));
});

test('no cockpit places a site: a digger\'s MISSILE and BALLISTIC buttons do nothing (docs/specs/31-builder.md)', () => {
  const G = base();
  for (let i = 0; i < 30; i++) update(G, input({ held: { missile: true, ballistic: true } }), 1 / 60);
  for (let i = 0; i < 5; i++) update(G, input({}), 1 / 60);
  assert.equal(G.base.sites.length, 0);
});
