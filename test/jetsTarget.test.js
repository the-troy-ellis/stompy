// Blast-off targeting (docs/specs/26-blast-off.md § Targeting): charging locks
// the foe in the sights, the ring shows where this charge lands, letting go
// aims the blast at it, and in the air a gentle auto-steer follows a slow foe
// but not a quick one that turns late. Landing on it from high enough is an
// insta-stomp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { JETS } from '../src/data/systems.js';
import { HIT_STOP } from '../src/data/feel.js';

const DT = 1 / 60;
// You, facing +z, and one foe parked `ahead` m in front (and `side` m to the left).
function setup(type = 'warden', ahead = 50, side = 0) {
  const G = createTestGame({ foes: [type] }), P = G.player, e = foes(G)[0];
  Object.assign(P, { yaw: 0, twist: 0, pitch: 0 });
  Object.assign(e, { x: P.x + side, z: P.z + ahead }); e.y = G.ter.height(e.x, e.z); initFeet(G, e); freeze(e);
  G.target = null;
  return { G, P, e };
}
// A parked foe walked by hand: `speed` m/s toward heading `yaw` (which may
// change with the time), turning there at its chassis's own rate.
const walker = (e, speed, yaw) => {
  const want = t => (typeof yaw === 'function' ? yaw(t) : yaw);
  let now = null;
  return t => { now ??= want(t); const r = e.ch.turn * DT; now += Math.max(-r, Math.min(r, want(t) - now)); e.speed = speed; e.yaw = now; };
};
// Charge for `s` s, let go, and fly to the ground; `each` runs every frame.
function fly(G, s, each = () => {}, over = {}) {
  const P = G.player;
  stepFor(G, s, t => { each(t); return input({ jets: true, ...over }); });
  let t = 0;
  stepFor(G, DT, tt => { each(tt); return input(over); });
  while ((P.air || t < 0.1) && t < 8) { stepFor(G, DT, tt => { each(tt); return input(over); }); t += DT; }
}

test('charging locks the foe in the sights, within reach and the cone; it becomes the target', () => {
  const { G, P, e } = setup('warden', 50);
  stepFor(G, 0.3, input({ jets: true }));
  assert.equal(P.jet.lock, e);
  assert.equal(G.target, e);
  // Out of reach, or well off the crosshair: no lock.
  const far = setup('warden', JETS[1].reach + 20);
  stepFor(far.G, 0.3, input({ jets: true }));
  assert.equal(far.P.jet.lock, null);
  const off = setup('warden', 30, 40);
  stepFor(off.G, 0.3, input({ jets: true }));
  assert.equal(off.P.jet.lock, null);
  // Not charging: no lock.
  const idle = setup('warden', 50);
  stepFor(idle.G, 0.3);
  assert.equal(idle.P.jet?.lock ?? null, null);
});

test('the ring shows this charge\'s landing: short at first, on the foe once the charge reaches', () => {
  const { G, P, e } = setup('warden', 60);
  stepFor(G, 0.1, input({ jets: true }));
  assert.ok(P.jet.at && !P.jet.on && !P.jet.at.mech, 'a little charge falls short');
  stepFor(G, 0.9, input({ jets: true }));
  assert.ok(P.jet.on && P.jet.at.mech === e, 'a full one reaches');
  assert.ok(G.fx.calls('sfx.lock').length >= 1, 'with a chirp');
});

test('an aimed full blast lands on a foe that keeps walking across, with no input at all: an insta-stomp', () => {
  const { G, P, e } = setup('warden', 55, -10);
  const w = walker(e, 7, Math.PI / 2);   // across, at a WARDEN's pace
  fly(G, 1, w);
  assert.equal(e.alive, false, 'flattened');
  assert.equal(e.lastHitMelee, 'stomp');
  assert.ok(P.alive);
});

test('an aimed insta-stomp stops the clock for twice a hit', () => {
  const { G, e } = setup('warden', 50);
  let most = 0;
  fly(G, 1, () => { most = Math.max(most, G.hitStop || 0); });
  assert.equal(e.alive, false);
  assert.ok(most > 1.5 * HIT_STOP && most <= 2 * HIT_STOP, `hit-stop ${most}`);   // read a frame after it's set
});

test('too short a charge falls short of it, aimed: no stomp', () => {
  const { G, P, e } = setup('warden', 60);
  fly(G, 0.15);
  assert.ok(e.alive);
  const d = Math.hypot(P.x - e.x, P.z - e.z);
  assert.ok(d > 15 && Math.abs(P.x - e.x) < 3, `landed ${d.toFixed(1)} m short, in line`);
});

// A foe `ahead` m off, walking at `speed` on heading `from`, that turns to
// `to` once the flight is `at` s old.
function dodge(type, ahead, speed, from, to, at, assist = true) {
  const r = setup(type, ahead);
  let t0 = null;
  const saved = JETS[1].assistMax;
  if (!assist) JETS[1].assistMax = 0;
  try { fly(r.G, 1, walker(r.e, speed, t => { if (r.P.jet?.blasted && t0 == null) t0 = t; return t0 != null && t - t0 > at ? to : from; })); } finally { JETS[1].assistMax = saved; }
  return r.e.alive;
}
test('the auto-steer sticks to a slow foe that turns, which the aim alone misses', () => {
  for (const at of [0.5, 1.5, 2.4]) {
    assert.equal(dodge('warden', 50, 7, 0, Math.PI / 2, at), false, `a WARDEN turning ${at} s in is stomped`);
  }
  assert.equal(dodge('warden', 50, 7, 0, Math.PI / 2, 0.5, false), true, 'with no auto-steer it walks out from under');
});
test('a JACKAL that breaks sideways late gets away; one that keeps coming is stomped', () => {
  for (const at of [1.5, 2.4]) assert.equal(dodge('jackal', 75, 19, Math.PI, Math.PI / 2, at), true, `a JACKAL turning ${at} s in escapes`);
  assert.equal(dodge('jackal', 75, 19, Math.PI, Math.PI, 99), false, 'one that keeps coming is flattened');
});

test('steering away drops the lock, and backing up as you let go ignores it', () => {
  const { G, P, e } = setup('warden', 50);
  stepFor(G, 1, input({ jets: true }));
  stepFor(G, 0.2);
  assert.equal(P.jet.lock, e);
  stepFor(G, JETS[1].letGo + 0.1, input({ thrDown: true }));
  assert.equal(P.jet.lock, null, 'steered away: let go');
  while (P.air) stepFor(G, DT);
  assert.ok(e.alive);
  const B = setup('warden', 50);
  B.P.throttle = -0.35;
  fly(B.G, 1, () => {}, { thrDown: true });
  assert.ok(B.P.z < B.e.z - 50, `backed off: ${(B.e.z - B.P.z).toFixed(1)} m away`);
  assert.ok(B.e.alive);
});

test('a plain fall onto a mech, with no blast-off, is still the old stomp', () => {
  const { G, P, e } = setup('warden', 0.01);
  P.y = e.y + 30; P.air = true; P.vy = 0;
  while (P.air) stepFor(G, DT);
  assert.ok(e.alive, 'dented, not flattened');
});
