import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center } from '../src/sim/geom.js';
import { applyLoadout, choicesFor } from '../src/sim/loadout.js';
import { MELT_T, drawBeam } from '../src/sim/beams.js';
import { WEAPONS, CAT_OF } from '../src/data/weapons.js';
import { CHASSIS } from '../src/data/chassis.js';

const meltAfter = (arm, secs) => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 120, yaw: Math.PI }); initFeet(G, e); freeze(e);
  e.hp.T = 1e9; e.max.T = 1e9; e.hp.LA = e.hp.RA = 1e9; e.hp.LL = e.hp.RL = 1e9;
  applyLoadout(G, P, { hp: { la: arm, ra: null, t1: null, t2: null }, sys: { sinks: 3, armour: 0, jets: 1 } });
  G.aim = center(e);
  let full = null;
  for (let t = 0; t < secs; t += DT) { stepFor(G, DT, input({ held: { energy: true } })); G.aim = center(e); if (full == null && e.melt >= MELT_T - 1e-9) full = t + DT; }
  return full;
};

test('PEPPER LASER is a short energy beam any energy hardpoint can take', () => {
  assert.equal(CAT_OF.plaser, 'energy');
  assert.equal(WEAPONS.plaser.kind, 'beam');
  assert.ok(choicesFor(CHASSIS.jackal.hardpoints[0]).includes('plaser'));
  assert.ok(WEAPONS.plaser.range < WEAPONS.mlaser.range);
});

test('it melts armour fully in 2 s where a LG LASER takes 3', () => {
  const pepper = meltAfter('plaser', 4), large = meltAfter('laser', 4);
  assert.ok(Math.abs(pepper - 2) < 0.05, `pepper full melt at ${pepper} s`);
  assert.ok(Math.abs(large - 3) < 0.05, `laser full melt at ${large} s`);
});

test('its beam stutters: thin on the off-beat, full on the beat', () => {
  const G = createTestGame();
  const widths = [];
  for (const t of [0.01, 0.05]) { G.time = t; G.cbeams = []; drawBeam(G, [0, 0, 0], [0, 0, 10], WEAPONS.plaser, 1); widths.push(G.cbeams[0].w); }
  assert.ok(widths[1] < widths[0] * 0.5, `widths ${widths}`);
});
