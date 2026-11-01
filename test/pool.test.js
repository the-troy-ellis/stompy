// Silos, the pool, beacons and repairs (docs/specs/33-production.md part 1):
// ore is one pool with room for each silo standing; a fallen silo spills
// what's over; silos and beacons make territory; builders mend for ore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { CONSTRUCT, PLACE } from '../src/data/construct.js';
import { footprintAt, placeSite, padOf, oreRoom, silosUp, inLand, repairSwing, repairCost, needsRepair } from '../src/sim/base.js';
import { give } from '../src/sim/orders.js';
import { destroyEntity } from '../src/sim/entities.js';
import { shiftMech } from '../src/sim/walkView.js';

const DT = 1 / 60;
// You in `pilot`, on flat ground with the range's silo and `crew` parked.
const game = (pilot = 'digger', crew = ['kestrel']) => {
  const G = createGame({ fx: recordFx(), seed: 4 }), def = rangeDef({ ground: 'flat', crew: crew[0], base: 'silo' });
  for (const type of crew.slice(1)) def.crew.push({ type, at: [-90, 30], face: 0 });
  startMatch(G, def, 4, false, pilot, { terrainOpts: { flat: true } });
  return G;
};
const run = (G, s, until = () => false) => { for (let i = 0; i < s / DT && !until(); i++) update(G, noInput(), DT); };
const said = G => G.fx.calls('say').map(c => c.args[0]);
// A building of `kind` put down at (x, z) and built at once.
const up = (G, kind, x, z) => {
  const f = footprintAt(G, x, z, 0, kind);
  assert.equal(f.why, null, `${kind} fits at ${x}, ${z}`);
  const s = placeSite(G, f);
  s.ore = s.need; s.work = s.swings;
  run(G, 0.1);
  return s.parts[0];
};
const onPad = (G, m, silo) => { const [x, z] = padOf(silo); shiftMech(m, x - m.x, z - m.z); };

test('the pool has room for each silo standing; a silo still a site adds none', () => {
  const G = game(), s0 = G.base.silo;
  assert.equal(oreRoom(G), CONSTRUCT.siloRoom);
  const f = footprintAt(G, s0.x + 80, s0.z, 0, 'silo');
  placeSite(G, f);
  run(G, 0.1);
  assert.equal(oreRoom(G), CONSTRUCT.siloRoom, 'a site: no room yet');
  const s = G.base.sites[0]; s.ore = s.need; s.work = s.swings;
  run(G, 0.1);
  assert.equal(silosUp(G).length, 2);
  assert.equal(oreRoom(G), 2 * CONSTRUCT.siloRoom);
});

test('ore tipped in at any silo goes into the one pool, as far as there\'s room', () => {
  const G = game(), P = G.player, s1 = up(G, 'silo', G.base.silo.x + 80, G.base.silo.z), ore = G.base.ore;
  P.ore = 30; onPad(G, P, s1);
  run(G, 0.1);
  assert.equal(G.base.ore, ore + 30, 'the second silo takes it');
  G.base.ore = oreRoom(G) - 5;
  P.ore = 30;
  run(G, 0.1);
  assert.equal(G.base.ore, oreRoom(G), 'up to the room');
  assert.equal(P.ore, 25, 'the rest stays in the hopper');
});

test('a silo falling spills what the rest can\'t hold as a heap; a crew mech scoops it up', () => {
  const G = game(), P = G.player, s1 = up(G, 'silo', G.base.silo.x + 80, G.base.silo.z);
  G.base.ore = 2 * CONSTRUCT.siloRoom - 50;
  destroyEntity(G, s1, null);
  run(G, 0.1);
  assert.equal(G.base.ore, CONSTRUCT.siloRoom, 'down to one silo\'s room');
  assert.equal(G.base.heaps.length, 1);
  const h = G.base.heaps[0];
  assert.equal(h.ore, CONSTRUCT.siloRoom - 50);
  assert.ok(said(G).includes('Silo lost.'));
  P.ore = 0; shiftMech(P, h.x - P.x, h.z - P.z);
  run(G, 0.1);
  assert.equal(P.ore, P.ch.hopper, 'a hopperful');
  assert.equal(h.ore, CONSTRUCT.siloRoom - 50 - P.ch.hopper);
});

test('the silo and two beacons in range make territory; buildings outside it are exposed', () => {
  const G = game(), s0 = G.base.silo;
  assert.equal(G.base.land.tris.length, 0, 'one silo: no land');
  const a = up(G, 'beacon', s0.x + 120, s0.z), b = up(G, 'beacon', s0.x + 60, s0.z + 120);
  run(G, 0.3);
  assert.equal(G.base.land.tris.length, 1);
  const mx = (s0.x + a.x + b.x) / 3, mz = (s0.z + a.z + b.z) / 3;
  assert.ok(inLand(G, mx, mz));
  const inside = up(G, 'bay', mx, mz), outside = up(G, 'bay', s0.x - 150, s0.z - 150);
  run(G, 0.3);
  assert.equal(inside.exposed, false);
  assert.equal(outside.exposed, true);
  destroyEntity(G, a, null);
  run(G, 0.1);
  assert.ok(said(G).includes('Beacon lost.'));
  assert.equal(G.base.land.tris.length, 0, 'the triangle went with it');
  assert.equal(inside.exposed, true, 'now outside');
});

test('a builder\'s swing mends a damaged building a share at a time, for ore', () => {
  const G = game('builder'), P = G.player, bay = up(G, 'bay', G.base.silo.x + 60, G.base.silo.z);
  bay.hp = bay.max / 2;
  assert.ok(needsRepair(bay));
  const c = repairCost(bay), ore = G.base.ore;
  assert.ok(Math.abs(c.ore * PLACE.bay.swings - PLACE.bay.ore * CONSTRUCT.repairOre) < 1e-9, 'a full mend: half its price');
  assert.ok(repairSwing(G, P, bay));
  assert.equal(bay.hp, bay.max / 2 + c.hp);
  assert.ok(Math.abs(G.base.ore - (ore - c.ore)) < 1e-9);
  G.base.ore = 0;
  assert.equal(repairSwing(G, P, bay), false, 'no ore: nothing');
  assert.equal(bay.hp, bay.max / 2 + c.hp);
});

test('a parked builder mends a damaged building, and a BUILD order sends one to it', () => {
  const G = game('kestrel', ['builder']), b = G.crew.find(m => m.type === 'builder');
  const bay = up(G, 'bay', b.x - 60, b.z - 40);
  bay.hp = bay.max * 0.3;
  G.base.ore = 100;
  run(G, 2);
  assert.equal(b.job, 'FIXING');
  run(G, 90, () => !needsRepair(bay));
  assert.ok(!needsRepair(bay), 'mended');
  assert.ok(G.base.ore < 100);
  bay.hp = bay.max * 0.5;
  assert.equal(give(G, [b], { kind: 'build', target: bay }), 1, 'BUILD on a damaged building');
  assert.ok(said(G).includes('Fixing.'));
});
