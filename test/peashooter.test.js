import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center } from '../src/sim/geom.js';
import { fire, MAX_SHOTS } from '../src/sim/combat.js';
import { applyLoadout, choicesFor } from '../src/sim/loadout.js';
import { WEAPONS, CAT_OF } from '../src/data/weapons.js';
import { CHASSIS } from '../src/data/chassis.js';
import { FEEL } from '../src/data/feel.js';

const D = WEAPONS.mg;
const total = m => Object.values(m.hp).reduce((a, v) => a + v, 0);
const setup = (foe = 'warden', z = 120) => {
  const G = createTestGame({ foes: [foe] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z, yaw: Math.PI }); initFeet(G, e); freeze(e);
  applyLoadout(G, P, { hp: { la: null, ra: null, t1: 'mg', t2: null }, sys: { sinks: 0, armour: 0, jets: 1 } });
  return { G, P, e, w: P.weapons.find(x => x.type === 'mg') };
};

test('PEASHOOTER is a 1 t ballistic weapon with a burst, and the feel table has its row', () => {
  assert.equal(CAT_OF.mg, 'ballistic');
  assert.ok(choicesFor(CHASSIS.kestrel.hardpoints[2]).includes('mg'));
  assert.equal(D.tons, 1);
  assert.deepEqual(D.burst, { n: 6, dt: 0.05 });
  assert.ok(FEEL.fireMg);
});

test('one trigger pull fires 6 rounds over 0.3 s for one burst of ammo and 0.2 heat; each round hits for 0.8', () => {
  const { G, P, e, w } = setup();
  w.cd = 0;
  const hp0 = total(e), heat0 = P.heat;
  assert.ok(fire(G, P, w, center(e), e));
  assert.equal(G.shots.filter(s => s.type === 'mg').length, 1, 'the first round leaves at once');
  assert.ok(Math.abs(P.heat - heat0 - D.heat) < 1e-9);
  stepFor(G, 0.3);
  assert.equal(w.burst, null, 'the burst is done inside 0.3 s');
  assert.equal(G.stats.shots, 6);
  assert.equal(w.ammo, D.ammo - 1);
  stepFor(G, 0.6);
  const lost = hp0 - total(e);
  assert.ok(Math.abs(lost - 6 * D.dmg) < 1e-6, `six rounds at 120 m should all land (took ${lost})`);
});

test('the AI fires bursts too, and a shut-down gunner stops mid-burst', () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 100, yaw: Math.PI }); initFeet(G, e);
  applyLoadout(G, e, { hp: { t1: 'lrm', ra: 'mg', la: 'laser' }, sys: { sinks: 0, armour: 0, jets: 1 } });
  const w = e.weapons.find(x => x.type === 'mg'); w.cd = 0;
  assert.ok(fire(G, e, w, center(G.player), G.player));
  stepFor(G, DT * 4);
  e.shutdown = true;
  const n = G.shots.filter(s => s.type === 'mg').length;
  stepFor(G, 0.3);
  assert.ok(n > 1 && n < 6, `${n} rounds before the shutdown`);
  assert.equal(G.shots.filter(s => s.type === 'mg' && s.life > 0).length <= n, true);
  assert.equal(w.burst, null);
});

test(`live shots are capped at ${MAX_SHOTS}: the oldest goes first`, () => {
  const { G, P, e, w } = setup('warden', 200);
  for (let i = 0; i < MAX_SHOTS; i++) G.shots.push({ kind: 'shell', type: 'ac', p: [0, -50, 0], v: [0, 0, 1], owner: e, dmg: 0, life: 99, n: i });
  w.cd = 0;
  fire(G, P, w, center(e), e);
  assert.equal(G.shots.length, MAX_SHOTS);
  assert.equal(G.shots[0].n, 1, 'shot 0 was dropped');
  assert.equal(G.shots.at(-1).type, 'mg');
});
