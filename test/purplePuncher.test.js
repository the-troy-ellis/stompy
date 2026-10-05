import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { CHASSIS, MECH_ORDER } from '../src/data/chassis.js';
import { NAMES } from '../src/data/names.js';
import { DEFAULT_MELEE, FIST_MELEE, meleeOf } from '../src/data/melee.js';
import { validate, cycleSystem, stockLoadout, sysMax } from '../src/sim/loadout.js';
import { decideFire } from '../src/sim/ai/fire.js';
import { planFor } from '../src/sim/ai/profiles.js';
import { fistPose, FIST_REST } from '../src/render/scene.js';
import { meleeGhost } from '../src/sim/melee.js';
import { WEAPONS } from '../src/data/weapons.js';

const total = m => Object.values(m.hp).reduce((a, v) => a + v, 0);
const place = (G, m, x, z, yaw = Math.PI) => { Object.assign(m, { x, z, yaw, twist: 0 }); initFeet(G, m); freeze(m); };
// A PURPLE PUNCHER player squaring up to a frozen target 10 m ahead; one punch.
function punchAt(foe, setup = () => {}) {
  const G = createTestGame({ chassis: 'puncher', foes: [foe] });
  const P = G.player, e = foes(G)[0];
  place(G, e, 0, 10);
  setup(P);
  stepFor(G, 0.5);
  const hp0 = total(e), z0 = e.z;
  stepFor(G, DT, input({ punch: true }));
  const arm = P.melee?.arm;
  stepFor(G, 1.5);
  return { G, P, e, hurt: hp0 - total(e), moved: e.z - z0, arm };
}

test('PURPLE PUNCHER: the confirmed name, its numbers from the spec, fists not arm guns, selectable', () => {
  const ch = CHASSIS.puncher;
  assert.equal(NAMES.chassis.puncher, 'PURPLE PUNCHER');
  assert.equal(NAMES.roles.puncher.role, 'IT PUNCHES.');
  assert.ok(MECH_ORDER.includes('puncher'));
  assert.equal(ch.scale, 1.3); assert.equal(ch.speed, 9); assert.equal(ch.turn, 0.6); assert.equal(ch.sink, 12);
  assert.deepEqual(ch.hp, { T: 110, LA: 50, RA: 50, LL: 60, RL: 60 });
  assert.equal(ch.melee, FIST_MELEE);
  assert.ok(ch.hardpoints.every(h => h.loc === 'T'), 'the arms carry fists');
  assert.deepEqual(stockLoadout('puncher').hp, { t1: 'ac', t2: 'srm' });
  assert.ok(ch.col[2] > ch.col[0] && ch.col[0] > ch.col[1], 'purple');
});

test('jets: none stock, and the slot allows only level 1', () => {
  assert.equal(stockLoadout('puncher').sys.jets, 0);
  assert.equal(sysMax('puncher', 'jets'), 1);
  assert.equal(validate('puncher', { hp: { t1: 'ac', t2: 'srm' }, sys: { sinks: 0, armour: 0, jets: 2 } }).loadout.sys.jets, 1);
  let lo = stockLoadout('puncher');
  lo = cycleSystem(lo, 'jets', 1, 'puncher'); assert.equal(lo.sys.jets, 1);
  lo = cycleSystem(lo, 'jets', 1, 'puncher'); assert.equal(lo.sys.jets, 0, 'wraps after 1');
  assert.equal(sysMax('kestrel', 'jets'), 2, 'other chassis keep the full range');
});

test('its punch uses its own block: 30 damage and a shove that sends another PURPLE PUNCHER metres', () => {
  const r = punchAt('puncher');
  assert.ok(Math.abs(r.hurt - FIST_MELEE.dmg) < 1e-6, `took ${r.hurt}`);
  assert.ok(r.moved > 3, `moved ${r.moved.toFixed(2)} m`);
  assert.equal(r.arm, 'RA', 'the right throws first');
  const s = punchAt('jackal');
  assert.ok(s.moved > r.moved * 2, `a JACKAL goes much farther (${s.moved.toFixed(1)} m vs ${r.moved.toFixed(1)} m)`);
});

test('the fists take turns, and with one arm gone the other punches at full strength', () => {
  const r = punchAt('puncher', P => { P.lastArm = 'RA'; });
  assert.equal(r.arm, 'LA', 'after the right, the left');
  const one = punchAt('puncher', P => { P.hp.RA = 0; });
  assert.equal(one.arm, 'LA');
  assert.ok(Math.abs(one.hurt - FIST_MELEE.dmg) < 1e-6, `one-armed punch took ${one.hurt}`);
});

test('with both arms gone it shoves like anyone else', () => {
  const r = punchAt('puncher', P => { P.hp.RA = 0; P.hp.LA = 0; });
  assert.equal(meleeOf(r.P), DEFAULT_MELEE);
  assert.equal(r.arm, undefined, 'no fist to throw');
  assert.ok(Math.abs(r.hurt - DEFAULT_MELEE.dmg) < 1e-6, `the shove took ${r.hurt}`);
});

test('the fist pose: a guard at rest, the punching arm cocks back then swings out past level, the torso turns into it', () => {
  const m = { ch: CHASSIS.puncher, hp: { ...CHASSIS.puncher.hp }, melee: null };
  assert.deepEqual(fistPose(m), { LA: FIST_REST, RA: FIST_REST, twist: 0 });
  m.melee = { t: FIST_MELEE.windup, phase: 'windup', arm: 'RA' };
  const w = fistPose(m);
  assert.ok(w.RA > FIST_REST + 0.5 && w.LA < FIST_REST, 'right cocked back, left up in a guard');
  m.melee = { t: FIST_MELEE.windup, phase: 'recover', arm: 'RA' };
  const h = fistPose(m);
  assert.ok(h.RA < -1.3 && h.twist < 0, 'swung out, torso turned toward the right');
  m.melee.t = FIST_MELEE.windup + FIST_MELEE.recover;
  assert.ok(Math.abs(fistPose(m).RA - FIST_REST) < 0.05, 'eased back to the guard');
});

test('the brawler fires everything at once when the target torso is under 40%', () => {
  const ready = e => { e.weapons.forEach(w => { w.cd = 0; }); e.ai.lockT = 2; e.ai.jitter = 0; e.ai.strafeT = 1; e.heat = 0; };
  const G = createTestGame({ seed: 7, foes: ['puncher'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 120, yaw: Math.PI, twist: 0 }); initFeet(G, e); e.ai.aware = true;
  assert.equal(planFor(e).alphaTorso, 0.4);
  const ctx = { dist: 120, toYaw: Math.PI }, shots = k => G.shots.filter(s => s.owner === e && s.kind === k).length;
  P.hp.T = P.max.T * 0.5; ready(e);
  decideFire(G, e, P, ctx, DT);
  assert.equal(shots('shell') + (shots('missile') ? 1 : 0), 1, 'at half torso, one at a time');
  G.shots = []; P.hp.T = P.max.T * 0.35; ready(e);
  decideFire(G, e, P, ctx, DT);
  assert.ok(shots('shell') === 1 && shots('missile') === WEAPONS.srm.count, 'under 40%: cannon and FIRECRACKERS together');
});

test('its footfalls are felt by the player 30 m away; a KESTREL\'s are not', () => {
  const felt = type => {
    const G = createTestGame({ foes: [type] });
    const e = foes(G)[0];
    Object.assign(e, { x: 30, z: -20, yaw: 0, throttle: 1, team: 0 });   // friendly: no AI, just walks
    initFeet(G, e);
    let peak = 0;
    for (let i = 0; i < 60; i++) { stepFor(G, 0.05); peak = Math.max(peak, G.shake); }
    return peak;
  };
  assert.ok(felt('puncher') > 0, 'nothing felt');
  assert.equal(felt('kestrel'), 0);
});

test('another pilot\'s PURPLE PUNCHER swings a fist on this screen too, taking turns', () => {
  const m = { ch: CHASSIS.puncher, hp: { ...CHASSIS.puncher.hp }, melee: null };
  meleeGhost(m, DT, 1);
  assert.equal(m.melee.arm, 'RA');
  meleeGhost(m, DT, 2); meleeGhost(m, DT, 0);
  assert.equal(m.melee, null);
  meleeGhost(m, DT, 1);
  assert.equal(m.melee.arm, 'LA');
});
