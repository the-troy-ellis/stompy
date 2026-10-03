import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { applyLoadout, choicesFor } from '../src/sim/loadout.js';
import { center } from '../src/sim/geom.js';
import { WEAPONS, CAT_OF } from '../src/data/weapons.js';
import { CHASSIS } from '../src/data/chassis.js';
import * as P from '../src/net/protocol.js';

const D = WEAPONS.flamer;
const total = m => Object.values(m.hp).reduce((a, v) => a + v, 0);
const setup = (z = 60) => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z, yaw: Math.PI }); initFeet(G, e);
  // Held still but awake (freeze() would shut it down): no legs, no guns, no jets,
  // and no sinks, so the heat it takes on is all the TOASTER's.
  Object.assign(e, { maxSpeed: 0, weapons: [], jets: 0, sink: 0, heat: 0 });
  e.ai.aware = false;
  applyLoadout(G, G.player, { hp: { la: 'flamer', ra: null, t1: null, t2: null }, sys: { sinks: 0, armour: 0, jets: 1 } });
  G.aim = center(e);
  return { G, e };
};

test('TOASTER is a 1.5 t energy beam that pours heat into its target', () => {
  assert.equal(CAT_OF.flamer, 'energy');
  assert.ok(choicesFor(CHASSIS.kestrel.hardpoints[0]).includes('flamer'));
  assert.equal(D.kind, 'beam');
  assert.equal(D.targetHeat, 6);
});

test('held on a target at 60 m it raises the target heat at 6/s, deals its damage and draws a cone, not a line', () => {
  const { G, e } = setup();
  const heat0 = e.heat, hp0 = total(e);
  stepFor(G, 2, input({ held: { energy: true } }));
  const rate = (e.heat - heat0) / 2;
  assert.ok(Math.abs(rate - D.targetHeat) < 0.3, `target heat rose ${rate.toFixed(2)}/s`);
  assert.ok(hp0 - total(e) >= D.dps * 2 - 1e-6, 'took at least dps × 2');
  assert.equal(G.cbeams.length, 0, 'no beam line');
  assert.ok(G.parts.some(p => p.kind === 'flame'), 'flame puffs');
  assert.ok(G.player.heat > 0, 'it costs the shooter heat too');
});

test('at 120 m it is out of range: no heat, no damage', () => {
  const { G, e } = setup(120);
  const heat0 = e.heat, hp0 = total(e);
  stepFor(G, 1, input({ held: { energy: true } }));
  assert.equal(e.heat, heat0);
  assert.equal(total(e), hp0);
});

test('long enough on it forces a shutdown', () => {
  const { G, e } = setup();
  e.heat = 80;
  stepFor(G, 4, input({ held: { energy: true } }));
  assert.ok(e.shutdown, `heat ${e.heat.toFixed(1)}`);
});

test('on another pilot the heat rides the hit as hh (PROTOCOL 5)', () => {
  const { G, e } = setup();
  G.mode = 'mp';
  Object.assign(e, { remote: true, netId: 7 });
  const heat0 = e.heat;
  stepFor(G, 0.5, input({ held: { energy: true } }));
  const hh = G.pendingHits.get(7)?.hh;
  assert.ok(Math.abs(hh - D.targetHeat * 0.5) < 0.3, `hh ${hh}`);
  assert.equal(e.heat, heat0, 'the remote copy does not heat here');
  assert.equal(P.PROTOCOL, 5);
  assert.equal(P.hit(7, 1, [0, 0, 0], false, { hh: 2.345 }).hh, 2.35);
  assert.equal(P.hit(7, 1, [0, 0, 0], false, {}).hh, undefined);
});
