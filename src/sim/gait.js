import { add, clampN, cross, dot, len, lerp, mul, norm, sub, wrapA } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { particle } from './effects.js';
import { feel } from './feel.js';
import { FEEL } from '../data/feel.js';

const { sin, cos, abs, min, hypot, PI } = Math;

// Legs: planted feet + two-bone IK.
// A planted foot stays exactly where it landed while the body moves over
// it. Once the hip has passed it by half a stride it lifts, arcs, and
// lands half a stride ahead of where the body will be at touchdown -- so
// feet never slide, and faster walking just means quicker steps.

// Where foot i would stand, `ahead` units along the heading.
export function restFoot(G, m, i, ahead = 0) {
  const s = m.ch.scale, leg = geoOf(m).legs[i], c = cos(m.yaw), sn = sin(m.yaw);
  const lx = leg.fx * s, lz = leg.fz * s + ahead;
  const x = m.x + c * lx + sn * lz, z = m.z - sn * lx + c * lz;
  return [x, G.ter.height(x, z), z];
}
export function initFeet(G, m) {
  m.feet = geoOf(m).legs.map((_, i) => ({ pos: restFoot(G, m, i), from: null, lifted: false, yaw: m.yaw }));
  m.bob = 0; m.cyc = 0.45;   // between swings: every foot planted
}

// One gait clock per mech, advanced by distance travelled (and turning),
// not time -- so the feet can't drift into step with each other, and a
// swing's landing spot can be predicted exactly. Each leg swings over
// [ph, ph + swing) of the cycle (bipeds: left at 0, right at 0.5; the
// quadruped trots, diagonal pairs together); between swings all feet are
// planted. Each swing aims, every frame, at where its rest spot will be
// at touchdown plus a stance's worth ahead.
function swingTarget(G, m, i, u, D, dir) {
  const sw = geoOf(m).swing;
  return restFoot(G, m, i, dir * ((1 - u) * sw * D + ((1 - sw) / 2) * D));
}

export function gait(G, m, dt) {
  const s = m.ch.scale, pace = min(1, abs(m.speed) / m.ch.speed), crouch = -0.35 * s * pace;
  const g0 = geoOf(m), legOk = i => m.hp[g0.legs[i].hx > 0 ? 'LL' : 'RL'] > 0;
  // No legs left: the hull sits on the ground, the torso still turns and fires.
  if (m.hp.LL <= 0 && m.hp.RL <= 0) {
    m.feet.forEach((f, i) => { f.pos = restFoot(G, m, i); f.lifted = false; f.yaw = m.yaw; });
    m.bob = -(g0.hip - 0.9) * s; m.lean = 0; m.lastYaw = m.yaw;
    return;
  }
  // One leg gone: lean toward the gap, about 8 degrees.
  const missing = m.hp.LL <= 0 ? 1 : m.hp.RL <= 0 ? -1 : 0;
  m.lean = missing * 0.14;
  const dyaw = abs(wrapA(m.yaw - (m.lastYaw ?? m.yaw)));
  m.lastYaw = m.yaw;
  if (m.air) {
    // Legs hang under the body until touchdown.
    m.feet.forEach((f, i) => { const r = restFoot(G, m, i); f.pos = [r[0], m.y + 1.4 * s, r[2]]; f.lifted = false; f.yaw = m.yaw; });
    m.bob = 0; m.wasAir = true;
    return;
  }
  if (m.wasAir) { m.wasAir = false; m.cyc = 0.45; m.feet.forEach((f, i) => { f.pos = restFoot(G, m, i); f.yaw = m.yaw; }); }

  // Cycle length in distance: longer strides when faster, but a planted
  // foot never gets more than (1 - swing) / 2 * D from its hip (leg reach).
  const g = geoOf(m), D = s * (g.stride[0] + g.stride[1] * pace);
  const swingOf = i => { const u = (((m.cyc - g.legs[i].ph) % 1 + 1) % 1) / g.swing; return u < 1 ? u : null; };
  const before = g.legs.map((_, i) => swingOf(i));
  const moving = abs(m.speed) > 0.3 || dyaw > 1e-4;
  // Stopped mid-stride: finish the step on the clock rather than freeze with a foot up.
  const adv = moving ? (abs(m.speed) * dt + dyaw * 2.5 * s) / D : (before.some(u => u != null) ? dt / 0.6 : 0);
  m.cyc = (m.cyc + min(adv, 0.2)) % 1;

  const dir = abs(m.speed) > 0.3 ? Math.sign(m.speed) : 0;
  m.bob = crouch;
  m.feet.forEach((f, i) => {
    const u = swingOf(i);
    if (!legOk(i)) {
      // The leg is gone: nothing swings, and the body dips where its step would have carried it.
      f.lifted = false;
      if (u != null) m.bob = min(m.bob, crouch - sin(PI * u) * 0.35 * s);
      return;
    }
    if (u == null) {
      if (before[i] != null) {   // the swing just ended: put it down exactly on target
        f.pos = swingTarget(G, m, i, 1, D, dir);
        f.yaw = m.yaw; f.lifted = false;
        footDown(G, m, f, pace);
      }
      return;
    }
    if (!f.lifted) { f.from = [...f.pos]; f.lifted = true; }
    const t = swingTarget(G, m, i, u, D, dir), e = u * u * (3 - 2 * u);
    if (hypot(f.from[0] - t[0], f.from[2] - t[2]) > 9 * s) f.from = [...t];   // shoved mid-stride
    f.pos = [lerp(f.from[0], t[0], e), lerp(f.from[1], t[1], e) + sin(PI * u) * (0.5 + 1.1 * pace) * s, lerp(f.from[2], t[2], e)];
    f.yaw += wrapA(m.yaw - f.yaw) * min(1, dt * 10);
    // The body rises over the swinging leg and settles as it lands.
    m.bob = crouch + sin(PI * u) * 0.3 * s * (0.3 + pace);
  });
  // A planted foot left hopelessly far away (shoved, respawned) just resets.
  m.feet.forEach((f, i) => {
    if (f.lifted) return;
    const r = restFoot(G, m, i);
    if (hypot(f.pos[0] - r[0], f.pos[2] - r[2]) > 7 * s) f.pos = r;
  });
}

// Touchdown: the sound, the cockpit jolt, a puff of dust.
function footDown(G, m, f, pace) {
  const P = G.player, r = G.rng, d = P ? hypot(m.x - P.x, m.z - P.z) : 1e9;
  // Heavier mechs thump harder; a planted foot's weight scales with scale^2.
  feel(G, 'step', { mech: m, k: (0.35 + 0.65 * pace) * m.ch.scale * m.ch.scale, at: m === P ? null : f.pos });
  if (m === P) G.fx.sfx.step(m, 0.4 + 0.55 * pace);
  else if (d < 350) G.fx.sfx.step(m, 0.3 + 0.45 * pace);
  // A heavy mech's steps are felt through the ground: within 40 m of the
  // player, the dashboard twitches in time with its feet.
  if (m !== P && m.ch.scale > 1.1 && d < 40) feel(G, 'nearStep', { mech: P, k: (1 - d / 40) * m.ch.scale * m.ch.scale, at: f.pos });
  // Dust at the foot, in the ground's colour, more for a faster or heavier mech.
  if (pace > 0.25 && d < 260) {
    const n = Math.round(3 * FEEL.step.dust * (0.5 + 0.5 * pace) * m.ch.scale);
    for (let i = 0; i < n; i++) particle(G, add(f.pos, [r.range(-1, 1), 0.3, r.range(-1, 1)]), [r.range(-2, 2), r.range(0.5, 1.5), r.range(-2, 2)], r.range(0.6, 1), r.range(0.5, 0.9) * m.ch.scale, mul(G.pal.low, 0.8), 'smoke');
  }
}

// Knee position by the law of cosines, bending toward `pole` (forward).
export function solveKnee(H, A, pole, l1, l2) {
  const d = sub(A, H), raw = len(d), n = mul(d, 1 / (raw || 1));
  const dist = clampN(raw, abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  const a = Math.acos(clampN((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
  let p = sub(pole, mul(n, dot(pole, n)));
  p = len(p) < 1e-4 ? [0, 0, 1] : norm(p);
  return add(H, add(mul(n, l1 * cos(a)), mul(p, l1 * sin(a))));
}
// A matrix that hangs a limb mesh (built along -y from its pivot) from P to Q.
export function limb(P, Q, pole, s) {
  const y = norm(sub(P, Q));
  let z = sub(pole, mul(y, dot(pole, y)));
  z = len(z) < 1e-4 ? [0, 0, 1] : norm(z);
  const x = cross(y, z);
  return new Float32Array([x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, P[0], P[1], P[2], 1]);
}
