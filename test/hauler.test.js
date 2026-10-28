// The hauler (docs/specs/21-mining.md § The hauler): a work quad with a big
// tub and no guns. A crew digger beside it tips its hopper in; the hauler
// empties at the silo like a digger does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { CHASSIS, PILOTABLE, MECH_ORDER } from '../src/data/chassis.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { NAMES } from '../src/data/names.js';
import { weaponList, stockLoadout } from '../src/sim/loadout.js';
import { padOf } from '../src/sim/base.js';
import { shiftMech } from '../src/sim/walkView.js';

const DT = 1 / 60;
// You in `pilot`, the other one parked 90 m to your side, a silo off to the right.
const game = (pilot = 'hauler', crew = 'digger') => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', crew, base: 'silo' }), 4, false, pilot, { terrainOpts: { flat: true } });
  return G;
};
const frame = G => update(G, noInput(), DT);
const other = G => G.crew.find(m => m !== G.player);
const besides = (G, a, b, d) => shiftMech(b, a.x + d - b.x, a.z - b.z);

test('the hauler: four legs, a tub four times a hopper, no guns, debug only', () => {
  const ch = CHASSIS.hauler;
  assert.equal(ch.legs, 'quad');
  assert.equal(ch.hopper, CONSTRUCT.haul);
  assert.equal(CONSTRUCT.haul, 4 * CONSTRUCT.hopper);
  assert.ok(!ch.tool && ch.hardpoints.length === 0);
  assert.deepEqual(weaponList('hauler', stockLoadout('hauler')), [], 'no fusion cannon either');
  assert.ok(PILOTABLE.includes('hauler') && !MECH_ORDER.includes('hauler'));
  assert.ok(NAMES.chassis.hauler && NAMES.roles.hauler);
  assert.ok(ch.speed > CHASSIS.digger.speed, 'quicker than the digger');
});

test('a digger beside the hauler tips its hopper in, whoever drives', () => {
  for (const pilot of ['hauler', 'digger']) {
    const G = game(pilot, pilot === 'hauler' ? 'digger' : 'hauler'), h = G.crew.find(m => m.type === 'hauler'), d = G.crew.find(m => m.type === 'digger');
    h.ore = 0; d.ore = 30;
    frame(G);
    assert.equal(d.ore, 30, 'not from 90 m off');
    besides(G, h, d, CONSTRUCT.handover - 4);
    frame(G);
    assert.equal(d.ore, 0); assert.equal(h.ore, 30);
    assert.ok(G.msgs.some(m => m.text === 'ORE ACROSS'), pilot);
  }
});

test('the tub takes only what fits', () => {
  const G = game(), h = G.player, d = other(G);
  h.ore = CONSTRUCT.haul - 10; d.ore = 30;
  besides(G, h, d, 8);
  frame(G);
  assert.equal(h.ore, CONSTRUCT.haul); assert.equal(d.ore, 20);
});

test('the hauler empties at the silo like a digger', () => {
  const G = game(), h = G.player, [px, pz] = padOf(G.base.silo), ore0 = G.base.ore;
  h.ore = 120;
  shiftMech(h, px - h.x, pz - h.z);
  frame(G);
  assert.equal(h.ore, 0);
  assert.equal(G.base.ore, ore0 + 120);
});

test('two haulers or two diggers hand nothing over', () => {
  const G = game('digger', 'digger'), [a, b] = G.crew;
  a.ore = 10; b.ore = 10;
  besides(G, a, b, 8);
  frame(G);
  assert.equal(a.ore + b.ore, 20);
  assert.ok(a.ore === 10 && b.ore === 10);
});

// Both parked (sim/miner.js): you in a KESTREL, a digger and a hauler on the range's flat ground.
const crew3 = () => {
  const G = createGame({ fx: recordFx(), seed: 4 }), def = rangeDef({ ground: 'flat', crew: 'digger', base: 'silo' });
  def.crew.push({ type: 'hauler', at: [-90, 30], face: 0 });
  startMatch(G, def, 4, false, 'kestrel', { terrainOpts: { flat: true } });
  return { G, d: G.crew.find(m => m.type === 'digger'), h: G.crew.find(m => m.type === 'hauler') };
};
const run = (G, s, until = () => false) => { for (let i = 0; i < s / DT && !until(); i++) frame(G); };

test('a full digger walks its ore to a hauler with room, not the silo', () => {
  const { G, d, h } = crew3();
  d.ore = CONSTRUCT.hopper; d.site = { x: d.x, y: d.y, z: d.z, yaw: 0, pitch: 0, t: 0 };
  h.ore = CONSTRUCT.haul;   // full: the digger goes to the silo
  frame(G);
  assert.equal(d.job, 'HAULING');
  const toSilo = Math.hypot(d.x - G.base.silo.x, d.z - G.base.silo.z);
  h.ore = 0; h.site = null;
  run(G, 90, () => d.ore === 0);
  assert.equal(d.ore, 0, 'tipped');
  assert.ok(h.ore >= CONSTRUCT.hopper, 'into the tub');
  assert.ok(Math.hypot(d.x - G.base.silo.x, d.z - G.base.silo.z) > toSilo * 0.5, 'not at the silo');
});

test('a parked hauler waits behind a digger at work, and takes a full tub home', () => {
  const { G, d, h } = crew3(), ore0 = G.base.ore;
  d.site = { x: d.x, y: d.y, z: d.z, yaw: 0, pitch: 0, t: 0 };
  run(G, 60, () => h.job === 'LOADING' && Math.hypot(h.x - d.x, h.z - d.z) < CONSTRUCT.handover);
  assert.equal(h.job, 'LOADING');
  assert.ok(Math.hypot(h.x - d.x, h.z - d.z) < CONSTRUCT.handover, 'within the handover');
  h.ore = CONSTRUCT.haul;
  frame(G);
  assert.equal(h.job, 'HAULING');
  run(G, 120, () => h.ore === 0);
  assert.equal(G.base.ore, ore0 + CONSTRUCT.haul);
});

test('with ore and no digger at work it goes home; with nothing to carry it stands', () => {
  const { G, h } = crew3(), ore0 = G.base.ore;
  h.ore = 30;
  frame(G);
  assert.equal(h.job, 'HAULING');
  run(G, 120, () => h.ore === 0);
  assert.equal(G.base.ore, ore0 + 30);
  run(G, 1);
  const x = h.x, z = h.z;
  run(G, 5);
  assert.equal(h.job, null);
  assert.ok(Math.hypot(h.x - x, h.z - z) < 0.5);
});
