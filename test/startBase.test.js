// Missions and their bases (docs/specs/33-production.md § Missions and their
// bases, part 6a): a mission lays out the base it starts with, each building
// up, damaged, half built or rubble, with ore, isotopes and parts in piles.
// The range's yards try each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { PLACE, BUILDINGS } from '../src/data/construct.js';
import { footprintAt, siteProg } from '../src/sim/base.js';
import { isDown, works } from '../src/sim/down.js';
import { thingsAt } from '../src/sim/production.js';

const DT = 1 / 60;
const yard = (base, pilot = 'kestrel') => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', base }), 4, false, pilot, { terrainOpts: { flat: true } });
  return G;
};
const run = (G, s) => { for (let i = 0; i < s / DT; i++) update(G, noInput(), DT); };
const said = G => G.fx.calls('say').map(c => c.args[0]);

test('a full yard: every building up and working, territory drawn, ore, isotopes and parts in their piles, said nothing', () => {
  const G = yard('yard'), b = G.base;
  run(G, 0.5);
  for (const k of ['shops', 'plants', 'lines', 'labs', 'armories']) assert.equal(b[k].length, 1, k);
  assert.equal(b.beacons.length, 3);
  assert.ok([...b.shops, ...b.plants, ...b.lines, ...b.labs, ...b.armories, ...b.beacons].every(works), 'all up and working');
  assert.equal(b.sites.length, 0);
  assert.ok(!b.lines[0].crewFull && b.lines[0].full === BUILDINGS.line.height, 'the line\'s crew-full flag is its own, not its height');
  assert.ok(b.land.tris.length >= 2, `territory: ${b.land.tris.length} triangles`);
  assert.equal(b.ore, 150); assert.equal(b.iso, 30);
  assert.deepEqual(thingsAt(G, b.shops[0]).map(t => t.part), ['legs.heavy']);
  assert.deepEqual(thingsAt(G, b.plants[0]).map(t => t.part), ['core']);
  assert.ok(!said(G).some(l => / up\.$/.test(l)), 'no "Machine shop up." for what was there all along');
  assert.ok(G.crew.some(m => m.type === 'builder') && G.crew.filter(m => m.type === 'hauler').length === 2, 'hands to run it');
});

test('a damaged yard: the line down, others hurt, a beacon in rubble in the way of a site', () => {
  const G = yard('hurt'), b = G.base;
  run(G, 0.5);
  const line = b.lines[0];
  assert.ok(isDown(line) && !works(line), 'the line is down');
  assert.ok([b.shops[0], b.plants[0], b.labs[0], b.armories[0]].some(e => e.hp < e.max && !isDown(e)), 'others hurt, not down');
  assert.equal(b.beacons.length, 2, 'one beacon is rubble');
  const r = G.entities.find(e => e.alive && e.tags.includes('rubble'));
  assert.ok(r && r.mesh === 'beaconWreck');
  assert.equal(footprintAt(G, r.x, r.z, 0, 'beacon').why, 'room', 'rubble is in the way');
});

test('rubble is cleared by a builder, three swings, nothing left', () => {
  const G = yard('hurt'), r = G.entities.find(e => e.alive && e.tags.includes('rubble')), b = G.crew.find(m => m.type === 'builder');
  for (const e of G.entities) if (e.team === 0 && e.hp < e.max) e.hp = e.max;   // nothing to mend first
  run(G, 2);
  assert.equal(b.job, 'CLEARING');
  for (let i = 0; i < 120 && r.alive; i++) run(G, 1);
  assert.ok(!r.alive && !r.wreck, 'cleared away');
  assert.equal(footprintAt(G, r.x, r.z, 0, 'beacon').why, null, 'room for a beacon again');
});

test('a half yard: the line and the plant are sites part done, with the ore and swings to match', () => {
  const G = yard('half'), b = G.base;
  run(G, 0.2);
  const line = b.lines[0], s = line.site;
  assert.ok(s && s.ore === Math.round(PLACE.line.ore * 0.4) && s.work === Math.floor(PLACE.line.swings * 0.4));
  assert.ok(Math.abs(siteProg(s) - 0.4) < 0.1, `about 40% up: ${siteProg(s)}`);
  assert.ok(b.plants[0].site && b.armories[0].site, 'the plant and the weapon shop too');
  assert.ok(works(b.shops[0]), 'the shop is up');
});
