import { add, clampN, dot, len, lerp, mul, norm, sub, wrapA } from '../util/math.js';
import { revealing } from './waves.js';
import { geoOf } from '../data/geo.js';
import { particle } from './effects.js';
import { feel } from './feel.js';
import { FEEL } from '../data/feel.js';
import { GAIT } from '../data/walk.js';

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
  m.bob = 0; m.cyc = restCyc(geoOf(m));   // between swings: every foot planted
}
// A point in the gait cycle where no leg is mid-swing: 0.45 for the stock
// plans, or the middle of the first gap for a plan whose swings are longer.
export function restCyc(g) {
  const free = c => g.legs.every(l => (((c - l.ph) % 1) + 1) % 1 >= g.swing);
  if (free(0.45)) return 0.45;
  for (let c = 0; c < 1; c += 0.005) if (free(c) && free(c + 0.01)) return c + 0.005;
  return 0.45;
}

// One gait clock per mech, advanced by distance travelled (and turning),
// not time -- so the feet can't drift into step with each other, and a
// swing's landing spot can be predicted exactly. Each leg swings over
// [ph, ph + swing) of the cycle (bipeds: left at 0, right at 0.5; the
// quadruped trots, diagonal pairs together); between swings all feet are
// planted. Each swing aims, every frame, at where its rest spot will be
// at touchdown plus a stance's worth ahead.
function swingTarget(G, m, i, u, D, dir, sw) {
  return restFoot(G, m, i, dir * ((1 - u) * sw * D + ((1 - sw) / 2) * D));
}

// The class's gait (data/walk.js GAIT): a runner's, a walker's or a crawler's.
export const gaitOf = m => GAIT[m.ch.legs] || GAIT.forward;
// The share of the cycle a foot is in the air now: a runner's grows from its
// walk to its run as it passes runAt (a flight phase once past a half).
export function swingNow(m, pace) {
  const g = geoOf(m), gp = gaitOf(m), t = clampN((pace - gp.runAt) / 0.2, 0, 1);
  return lerp(g.swing, Math.max(g.swing, gp.runSwing), t * t * (3 - 2 * t));
}
// How far a planted foot may sit ahead of or behind its rest spot before its
// leg is straight, in metres, with the hips sunk by `crouch` (model units).
export function legRoom(g, s, crouch) {
  let room = Infinity;
  const L = (g.l1 + g.l2) * 0.97, dy = g.hip - crouch - g.ankle;
  for (const l of g.legs) {
    const dx = l.fx - l.hx, flat = L * L - dy * dy - dx * dx;
    if (flat <= 0) return 0;
    const r = Math.sqrt(flat), off = l.fz - l.hz;
    room = min(room, r - off, r + off);
  }
  return Math.max(0, room) * s;
}
// The cycle's length in metres at this pace: from the walking stride up to
// the class's cadence at top speed, never more than the legs can reach and
// never less than the plan's own top stride.
export function strideOf(m, pace, sw) {
  const g = geoOf(m), gp = gaitOf(m), s = m.ch.scale, top = m.maxSpeed ?? m.ch.speed;
  const reach = 2 * legRoom(g, s, gp.crouch * pace) / (1 - sw) * 0.95;
  const want = Math.max(s * (g.stride[0] + g.stride[1]), (2 * top) / gp.cadence);
  const Dtop = Math.max(s * g.stride[0], min(want, reach));
  return s * g.stride[0] + (Dtop - s * g.stride[0]) * pace;
}

export function gait(G, m, dt) {
  const gp = gaitOf(m), s = m.ch.scale, pace = min(1, abs(m.speed) / (m.maxSpeed ?? m.ch.speed)), crouch = -gp.crouch * s * pace;
  const g0 = geoOf(m), legOk = i => m.hp[g0.legs[i].hx > 0 ? 'LL' : 'RL'] > 0;
  // No legs left: the hull sits on the ground, the torso still turns and fires.
  if (m.hp.LL <= 0 && m.hp.RL <= 0) {
    m.feet.forEach((f, i) => { f.pos = restFoot(G, m, i); f.lifted = false; f.yaw = m.yaw; });
    m.bob = -(g0.hip - 0.9) * s; m.lean = 0; m.sway = 0; m.hipYaw = 0; m.lastYaw = m.yaw;
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
    m.bob = 0; m.sway = 0; m.hipYaw = 0; m.wasAir = true;
    return;
  }
  if (m.wasAir) { m.wasAir = false; m.cyc = restCyc(geoOf(m)); m.feet.forEach((f, i) => { f.pos = restFoot(G, m, i); f.yaw = m.yaw; }); }

  // Cycle length in distance: longer strides when faster, but a planted
  // foot never gets more than (1 - swing) / 2 * D from its hip (leg reach).
  const g = geoOf(m), sw = swingNow(m, pace), D = strideOf(m, pace, sw);
  const swingOf = i => { const u = (((m.cyc - g.legs[i].ph) % 1 + 1) % 1) / sw; return u < 1 ? u : null; };
  const before = g.legs.map((_, i) => swingOf(i));
  const moving = abs(m.speed) > 0.3 || dyaw > 1e-4;
  // Stopped mid-stride: finish the step on the clock rather than freeze with a foot up.
  const adv = moving ? (abs(m.speed) * dt + dyaw * 2.5 * s) / D : (before.some(u => u != null) ? dt / 0.6 : 0);
  m.cyc = (m.cyc + min(adv, 0.2)) % 1;

  const dir = abs(m.speed) > 0.3 ? Math.sign(m.speed) : 0;
  // The hull: sunk by the crouch, dipped by the last footfall (a quick drop
  // and a slower recovery), raised over a swinging leg; the hips shift over
  // the planted foot and turn with the stride.
  const since = G.time - (m.stepAt ?? -9), tau = 0.1, dip = since < 1 ? (since / tau) * Math.exp(1 - since / tau) : 0;
  m.bob = crouch - dip * gp.drop * s * (0.4 + 0.6 * pace);
  let rise = 0, sway = 0, turn = 0;
  m.feet.forEach((f, i) => {
    const u = swingOf(i);
    if (!legOk(i)) {
      // The leg is gone: nothing swings, and the body dips where its step would
      // have carried it, deeper than any stride's crouch (a walker's is deep).
      f.lifted = false;
      if (u != null) m.bob = min(m.bob, crouch - sin(PI * u) * (gp.crouch + 0.35) * s);
      return;
    }
    if (u == null) {
      if (f.lifted) {   // the swing just ended (it was in the air: the swing's share can change with pace): put it down exactly on target
        f.pos = swingTarget(G, m, i, 1, D, dir, sw);
        f.yaw = m.yaw; f.lifted = false;
        footDown(G, m, f, pace);
      }
      return;
    }
    if (!f.lifted) { f.from = [...f.pos]; f.lifted = true; }
    // A heavy foot lifts slowly and is driven into the ground (slam), its
    // lift peaking early so it comes down rather than glides down.
    const t = swingTarget(G, m, i, u, D, dir, sw), e = lerp(u * u * (3 - 2 * u), u * u, gp.slam);
    if (hypot(f.from[0] - t[0], f.from[2] - t[2]) > 9 * s) f.from = [...t];   // shoved mid-stride
    const up = sin(PI * Math.pow(u, gp.liftEarly)) * (gp.lift[0] + gp.lift[1] * pace) * s;
    f.pos = [lerp(f.from[0], t[0], e), lerp(f.from[1], t[1], e) + up, lerp(f.from[2], t[2], e)];
    f.yaw += wrapA(m.yaw - f.yaw) * min(1, dt * 10);
    const arc = sin(PI * u), leg = g.legs[i], side = Math.sign(leg.hx) * (leg.hz >= -0.2 ? 1 : 0);   // a quad shifts by its front legs
    rise = Math.max(rise, arc * gp.bounce * (0.3 + pace));
    sway -= side * arc * gp.sway * min(1, 0.3 + pace);
    turn -= side * arc * gp.hipTurn * pace;
  });
  m.bob += rise * s;
  m.sway = sway; m.hipYaw = turn;   // drawn (render/scene.js), not felt: the guns and the eye don't sway
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
  m.stepAt = G.time;   // the hull's dip (gait)
  // Heavier mechs thump harder; a planted foot's weight scales with scale^2.
  feel(G, 'step', { mech: m, k: (0.35 + 0.65 * pace) * m.ch.scale * m.ch.scale, at: m === P ? null : f.pos });
  const entering = m !== P && revealing(G, m);   // a wave's big entrance (waves.js): heard and felt from anywhere
  if (m === P) G.fx.sfx.step(m, 0.4 + 0.55 * pace);
  else if (d < 350 || entering) G.fx.sfx.step(m, 0.3 + 0.45 * pace);
  // A heavy mech's steps are felt through the ground: within 40 m of the
  // player, the dashboard twitches in time with its feet; on its entrance,
  // at any distance (k as if at 20 m).
  if (m !== P && m.ch.scale > 1.1 && d < 40) feel(G, 'nearStep', { mech: P, k: (1 - d / 40) * m.ch.scale * m.ch.scale, at: f.pos });
  else if (entering) feel(G, 'nearStep', { mech: P, k: 0.5 * m.ch.scale * m.ch.scale, at: f.pos });
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
// A matrix that hangs a limb mesh (built along -y from its pivot) from P to Q,
// written into `out` (the renderer passes a reused one). Plain numbers, so it
// allocates nothing but the default `out`.
export function limb(P, Q, pole, s, out = new Float32Array(16)) {
  let yx = P[0] - Q[0], yy = P[1] - Q[1], yz = P[2] - Q[2];
  const yl = Math.hypot(yx, yy, yz) || 1; yx /= yl; yy /= yl; yz /= yl;
  const pd = pole[0] * yx + pole[1] * yy + pole[2] * yz;
  let zx = pole[0] - yx * pd, zy = pole[1] - yy * pd, zz = pole[2] - yz * pd;
  const zl = Math.hypot(zx, zy, zz);
  if (zl < 1e-4) { zx = 0; zy = 0; zz = 1; } else { zx /= zl; zy /= zl; zz /= zl; }
  const xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;   // cross(y, z)
  out[0] = xx * s; out[1] = xy * s; out[2] = xz * s; out[3] = 0;
  out[4] = yx * s; out[5] = yy * s; out[6] = yz * s; out[7] = 0;
  out[8] = zx * s; out[9] = zy * s; out[10] = zz * s; out[11] = 0;
  out[12] = P[0]; out[13] = P[1]; out[14] = P[2]; out[15] = 1;
  return out;
}
