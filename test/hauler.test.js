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
  assert.ok(!ch.tools && ch.hardpoints.length === 0);
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
