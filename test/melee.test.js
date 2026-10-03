import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MELEE } from '../src/data/melee.js';
import { meleePress, meleeTarget, canPunch } from '../src/sim/melee.js';
import { meleePose } from '../src/render/scene.js';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { VOICE } from '../src/data/voice.js';

const place = (G, m, x, z, yaw = Math.PI) => { Object.assign(m, { x, z, yaw, twist: 0 }); initFeet(G, m); freeze(m); };
const total = m => Object.values(m.hp).reduce((a, v) => a + v, 0);

test('a shove sends a JACKAL skidding six metres and barely moves a WARDEN; the shover recoils a little', () => {
  const run = type => {
    const G = createTestGame({ foes: [type] });
    const e = foes(G)[0];
    place(G, e, 0, 7);
    const hp0 = total(e);
    stepFor(G, 1);
    stepFor(G, 1 / 60, input({ punch: true }));
    assert.ok(G.player.melee && G.player.melee.phase === 'windup');
    stepFor(G, 1);
    return { moved: e.z - 7, hurt: hp0 - total(e), recoil: -G.player.z, hit: G.fx.calls('sfx.punch').some(c => c.args[1] === true) };
  };
  const j = run('jackal'), w = run('warden');
  assert.ok(j.hit && w.hit, 'no punch landed');
  assert.ok(j.moved >= 6, `JACKAL moved ${j.moved.toFixed(2)} m`);
  assert.ok(w.moved < 3, `WARDEN moved ${w.moved.toFixed(2)} m`);
  assert.ok(Math.abs(j.hurt - DEFAULT_MELEE.dmg) < 1e-6 && Math.abs(w.hurt - DEFAULT_MELEE.dmg) < 1e-6);
  assert.ok(j.recoil > 0.05 && j.recoil < j.moved * 0.5, `recoil ${j.recoil}`);
});

test('the swing picks the nearest mech within reach and arc and lands on the side facing the attacker', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal', 'jackal'] });
  const P = G.player, [near, far, side] = foes(G);
  place(G, near, 1.5, 8); place(G, far, 0, 10.5); place(G, side, 9, 0);   // side: 90 degrees off
  assert.equal(meleeTarget(G, P), near);
  near.alive = false;
  assert.equal(meleeTarget(G, P), far);
  far.alive = false;
  assert.equal(meleeTarget(G, P), null, 'out of the arc');
  P.twist = Math.PI / 2;
  assert.equal(meleeTarget(G, P), side, 'turning the torso brings it into the arc');
  // The blow lands on the skin facing the attacker: the torso (fist height) or an arm.
  side.alive = true; near.alive = true; P.twist = 0;
  stepFor(G, 1);
  stepFor(G, 1 / 60, input({ punch: true }));
  stepFor(G, 0.5);
  const sections = ['T', 'LA', 'RA'].filter(k => near.hp[k] < near.max[k]);
  assert.equal(sections.length, 1, `hit ${sections}`);
});

test('no punch while shut down, during a swing, on cooldown, or while flying missiles; guns wait for the recovery', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  place(G, e, 0, 7);
  stepFor(G, 1);
  P.shutdown = true; assert.equal(canPunch(G, P), false); P.shutdown = false;
  G.guide = {}; assert.equal(canPunch(G, P), false); G.guide = null;
  assert.ok(meleePress(G, P));
  assert.equal(meleePress(G, P), false, 'pressed again mid-swing');
  const shots = G.shots.length;
  stepFor(G, DEFAULT_MELEE.windup + 0.2, input({ held: { ballistic: true } }));
  assert.equal(G.shots.length, shots, 'fired during the swing');
  stepFor(G, DEFAULT_MELEE.recover);
  assert.equal(P.melee, null);
  assert.equal(canPunch(G, P), false, 'cooldown');
  stepFor(G, DEFAULT_MELEE.cd);
  assert.ok(canPunch(G, P));
});

test('landing on a mech after a real fall is a stomp with a bounce; a hop is not', () => {
  const stomp = fromHeight => {
    const G = createTestGame({ foes: ['jackal'] });
    const P = G.player, e = foes(G)[0];
    place(G, e, 0, 0);
    Object.assign(P, { x: 0, z: 0.5, y: fromHeight, air: true, vy: 0 }); initFeet(G, P);
    const hp0 = e.hp.T;
    let bounced = false;
    for (let i = 0; i < 120; i++) { stepFor(G, 1 / 60); if (P.vy > 2 && P.y > 3) bounced = true; }
    return { dmg: hp0 - e.hp.T, bounced, pushed: Math.hypot(e.x, e.z) > 0.5 };
  };
  const hard = stomp(30), hop = stomp(7);   // 7 m: feet already level with a JACKAL's head, no fall to speak of
  assert.ok(Math.abs(hard.dmg - DEFAULT_MELEE.stompDmg) < 1e-6, `stomp damage ${hard.dmg}`);
  assert.ok(hard.bounced && hard.pushed);
  assert.equal(hop.dmg, 0, 'a hop stomped');
});

test('a melee kill is announced as a punch, and the pose rears back then lunges', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  place(G, e, 0, 7); e.hp.T = 1;
  stepFor(G, 1);
  stepFor(G, 1 / 60, input({ punch: true }));
  stepFor(G, 1.5);
  assert.ok(G.fx.calls('say').some(c => VOICE.killPunch.includes(c.args[0])));
  const m = { melee: { t: 0.15, phase: 'windup' }, ch: {} };
  const w = meleePose(m); assert.ok(w.lean > 0 && w.arm < 0 && w.lunge === 0);
  m.melee = { t: DEFAULT_MELEE.windup + 0.01, phase: 'recover' };
  const s = meleePose(m); assert.ok(s.lean < 0 && s.arm > 0 && s.lunge > 0);
  assert.deepEqual(meleePose({ melee: null }), { lean: 0, arm: 0, lunge: 0 });
});
