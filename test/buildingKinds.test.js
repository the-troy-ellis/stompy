// The base's buildings by kind (docs/specs/36-building-registry.md): one row
// per kind says its list, its working state on joining, and whether raids go
// for it; every kind that can be built has a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, RAID_KINDS, enlist, delist, buildingsOf } from '../src/sim/buildings.js';
import { PLACE, BUILDINGS, LINE } from '../src/data/construct.js';

const base = () => ({ base: { silos: [], beacons: [], shops: [], plants: [], labs: [], armories: [], lines: [], walls: [], bays: [], factory: null } });
const ent = extra => ({ alive: true, ...extra });

test('every kind that can be built or placed has a row', () => {
  for (const k of new Set([...Object.keys(PLACE), ...Object.keys(BUILDINGS)])) assert.ok(KINDS[k], `${k} has a row in sim/buildings.js`);
  for (const k of RAID_KINDS) assert.ok(KINDS[k], `raids go for ${k}, which has a row`);
});

test('a building joins its list with its working state, and leaves every list', () => {
  const G = base(), shop = ent({ press: 'old' }), line = ent(), f = ent({ job: 'old' });
  enlist(G, 'shop', shop); enlist(G, 'line', line); enlist(G, 'factory', f);
  assert.deepEqual(G.base.shops, [shop]); assert.equal(shop.press, null);
  assert.equal(line.bays.length, LINE.bays); assert.deepEqual(line.queue, []);
  assert.equal(G.base.factory, f); assert.equal(f.job, null);
  delist(G, shop); delist(G, f);
  assert.deepEqual(G.base.shops, []); assert.equal(G.base.factory, null);
});

test('taken from outside: a line keeps its bays and queue, and a factory waits for the base\'s own to go', () => {
  const G = base(), bays = [{ kind: 'digger' }, null, null, null], line = ent({ bays, queue: ['hauler'] });
  enlist(G, 'line', line, true);
  assert.equal(line.bays, bays); assert.deepEqual(line.queue, ['hauler']);
  const own = ent(), other = ent();
  enlist(G, 'factory', own);
  enlist(G, 'factory', other, true);
  assert.equal(G.base.factory, own, 'the base\'s own stays');
  own.alive = false;
  enlist(G, 'factory', other, true);
  assert.equal(G.base.factory, other, 'its own gone: the taken one fills the slot');
});

test('raids go for the same buildings, in the same order, as before the table', () => {
  const G = base(), b = G.base, mk = () => ent();
  b.silos.push(mk()); b.factory = mk(); b.bays.push(mk()); b.beacons.push(mk()); b.shops.push(mk()); b.plants.push(mk()); b.lines.push(mk());
  b.labs.push(mk()); b.armories.push(mk()); b.walls.push(mk());
  const before = [...b.silos, b.factory, ...b.bays, ...b.beacons, ...b.shops, ...b.plants, ...b.lines];
  assert.deepEqual(buildingsOf(G, RAID_KINDS), before);
});
