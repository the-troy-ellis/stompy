import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { CHASSIS } from '../src/data/chassis.js';
import { PROFILES, planFor } from '../src/sim/ai/profiles.js';
import { harass, holdLine, useCover, coverWhenHot } from '../src/sim/ai/behaviours.js';

const place = (G, m, x, z, yaw) => { Object.assign(m, { x, z, yaw }); initFeet(G, m); };
const wall = (G, lo, hi, h) => { const base = G.ter.height; G.ter = { ...G.ter, height: (x, z) => (x > lo && x < hi ? h : base(x, z)) }; };

test('every chassis names a profile that exists, and the three M1 chassis read differently', () => {
  for (const [key, ch] of Object.entries(CHASSIS)) assert.ok(PROFILES[ch.ai?.profile], `${key} has no profile`);
  const fake = key => ({ ch: CHASSIS[key], ai: {} });
  const j = planFor(fake('jackal')), w = planFor(fake('warden')), k = planFor(fake('kestrel'));
  assert.ok(j.drive.includes(harass) && j.drive.includes(coverWhenHot) && !j.drive.includes(useCover));
  assert.ok(w.shape.includes(holdLine) && !w.drive.includes(harass));
  assert.ok(k.drive.includes(useCover) && !k.drive.includes(harass) && !k.shape.includes(holdLine));
});

test('think() picks the plan from the chassis once and keeps it', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  e.ai.aware = true;
  stepFor(G, 0.1);
  assert.ok(e.ai.plan && e.ai.plan.drive.includes(harass));
  const plan = e.ai.plan;
  stepFor(G, 1);
  assert.equal(e.ai.plan, plan);
});

test('a hurt JACKAL keeps fighting while a hurt KESTREL goes to ground', () => {
  for (const [chassis, hides] of [['jackal', false], ['kestrel', true]]) {
    const G = createTestGame({ foes: [chassis] });
    const P = G.player, e = foes(G)[0];
    P.hp.T = 1e9; P.max.T = 1e9;
    wall(G, 40, 80, 60);
    place(G, e, 0, 250, Math.PI); e.ai.aware = true; e.fuel = 0;
    e.hp.T = e.max.T * 0.2;   // hurt, but cool
    let hid = false;
    for (let s = 0; s < 12; s++) { stepFor(G, 0.5); e.heat = 0; e.fuel = 0; if (e.ai.cover) hid = true; }
    assert.equal(hid, hides, `${chassis} ${hides ? 'should hide when hurt' : 'should not hide over damage alone'}`);
  }
});
