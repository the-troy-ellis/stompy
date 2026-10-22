import { add, clampN, dot, len, lerp, mul, norm, sub, wrapA } from '../util/math.js';
import { revealing } from './waves.js';
import { geoOf } from '../data/geo.js';
import { particle } from './effects.js';
import { feel } from './feel.js';
import { FEEL } from '../data/feel.js';
import { GAIT, BODY } from '../data/walk.js';
import { makeSpring, stepSpring, kickSpring } from '../util/spring.js';

const { sin, cos, abs, min, hypot, PI } = Math;

// Legs: planted feet + two-bone IK.
// A planted foot stays exactly where it landed while the body moves over
// it. Once the hip has passed it by half a stride it lifts, arcs, and
// lands half a stride ahead of where the body will be at touchdown -- so
// feet never slide, and faster walking just means quicker steps.

// Where foot i would stand, `ahead` units along the heading: the first ground below the hip.
export function restFoot(G, m, i, ahead = 0) {
  const s = m.ch.scale, leg = geoOf(m).legs[i], c = cos(m.yaw), sn = sin(m.yaw);
  const lx = leg.fx * s, lz = leg.fz * s + ahead;
  const x = m.x + c * lx + sn * lz, z = m.z - sn * lx + c * lz;
  return [x, G.ter.groundBelow(x, m.y + geoOf(m).hip * s, z), z];   // from the hip: a foot in a tunnel stands on its floor, not its roof
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
  const g = geoOf(m), gp = gaitOf(m);
  return lerp(g.swing, Math.max(g.swing, gp.runSwing), runOf(m, pace));
}
// How far into its run a mech is at this pace, 0 to 1: past runAt, and only
// if its top speed reaches runMin (forward knees run, but a heavy one walks).
export function runOf(m, pace) {
  const gp = gaitOf(m), t = clampN((pace - gp.runAt) / 0.2, 0, 1);
  return (m.maxSpeed ?? m.ch.speed) >= (gp.runMin || 0) ? t * t * (3 - 2 * t) : 0;
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
  const reach = 2 * legRoom(g, s, gp.crouch * pace) / (1 - sw) * 0.85;
  const cad = lerp(gp.cadence, gp.runCadence ?? gp.cadence, runOf(m, pace));   // quicker steps as it runs
  const want = Math.max(s * (g.stride[0] + g.stride[1]), (2 * top) / cad);
  const Dtop = Math.max(s * g.stride[0], min(want, reach));
  return s * g.stride[0] + (Dtop - s * g.stride[0]) * pace;
}

export function gait(G, m, dt) {
  // The legs go as fast as the body does: against a wall (mech.js) that's its slide, not its throttle.
  const v = m.walled ? m.slide : m.speed;
  const gp = gaitOf(m), s = m.ch.scale, pace = min(1, abs(v) / (m.maxSpeed ?? m.ch.speed)), crouch = -gp.crouch * s * pace;
  const g0 = geoOf(m), legOk = i => m.hp[g0.legs[i].hx > 0 ? 'LL' : 'RL'] > 0;
  // No legs left: the hull sits on the ground, the torso still turns and fires.
  if (m.hp.LL <= 0 && m.hp.RL <= 0) {
    m.feet.forEach((f, i) => { f.pos = restFoot(G, m, i); f.lifted = false; f.yaw = m.yaw; });
    m.bob = -(g0.hip - 0.9) * s; m.lean = 0; m.sway = 0; m.hipYaw = 0; m.surge = 0; m.lastYaw = m.yaw; m.runK = 0; m.runLean = 0; stillBody(m);
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
    m.bob = 0; m.sway = 0; m.hipYaw = 0; m.surge = 0; m.wasAir = true; stillBody(m);
    return;
  }
  if (m.wasAir) { m.wasAir = false; m.cyc = restCyc(geoOf(m)); m.feet.forEach((f, i) => { f.pos = restFoot(G, m, i); f.yaw = m.yaw; }); }

  // Cycle length in distance: longer strides when faster, but a planted
  // foot never gets more than (1 - swing) / 2 * D from its hip (leg reach).
  const g = geoOf(m), sw = swingNow(m, pace), D = strideOf(m, pace, sw);
  const swingOf = i => { const u = (((m.cyc - g.legs[i].ph) % 1 + 1) % 1) / sw; return u < 1 ? u : null; };
  const before = g.legs.map((_, i) => swingOf(i));
  const moving = abs(v) > 0.3 || dyaw > 1e-4;
  // Stopped mid-stride: finish the step on the clock rather than freeze with a foot up.
  const adv = moving ? (abs(v) * dt + dyaw * 2.5 * s) / D : (before.some(u => u != null) ? dt / 0.6 : 0);
  m.cyc = (m.cyc + min(adv, 0.2)) % 1;

  const dir = abs(v) > 0.3 ? Math.sign(v) : 0;
  // The hull: sunk by the crouch, dipped by the last footfall (a quick drop
  // and a slower recovery), raised over a swinging leg; the hips shift over
  // the planted foot and turn with the stride.
  const since = G.time - (m.stepAt ?? -9), tau = 0.1, dip = since < 1 ? (since / tau) * Math.exp(1 - since / tau) : 0;
  m.bob = crouch - dip * gp.drop * s * (0.4 + 0.6 * pace);
  // Weight going over the new foot: the body lurches ahead after a footfall
  // and drops back through the step, instead of gliding (drawn, not moved).
  const lurch = since < 1.5 ? (since / 0.16) * Math.exp(1 - since / 0.16) : 0;
  m.surge = lurch * gp.surge * pace * dir;
  const pend = BODY.model === 'pendulum';
  let rise = 0, sway = 0, turn = 0, lame = Infinity;
  m.feet.forEach((f, i) => {
    const u = swingOf(i);
    if (!legOk(i)) {
      // The leg is gone: nothing swings, and the body dips where its step would
      // have carried it, deeper than any stride's crouch (a walker's is deep).
      f.lifted = false;
      if (u != null) lame = min(lame, crouch - sin(PI * u) * (gp.crouch + 0.35) * s);
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
    // lift peaking early so it comes down rather than glides down. Under the
    // pendulum body the leg swings as a pendulum does instead: quickest
    // through the middle, slowing as it reaches out; its lift still peaks
    // early, so the foot comes up behind and the knee folds before it reaches.
    const t = swingTarget(G, m, i, u, D, dir, sw), e = pend ? (1 - cos(PI * u)) / 2 : lerp(u * u * (3 - 2 * u), u * u, gp.slam);
    // Shoved mid-stride: a normal step starts about a stride (D) from its target; far more than that, start from the target.
    if (hypot(f.from[0] - t[0], f.from[2] - t[2]) > 1.5 * D + 3 * s) f.from = [...t];
    const up = sin(PI * Math.pow(u, gp.liftEarly)) * (gp.lift[0] + gp.lift[1] * pace) * s;
    f.pos = [lerp(f.from[0], t[0], e), lerp(f.from[1], t[1], e) + up, lerp(f.from[2], t[2], e)];
    f.yaw += wrapA(m.yaw - f.yaw) * min(1, dt * 10);
    const arc = sin(PI * u), leg = g.legs[i], side = Math.sign(leg.hx) * (leg.hz >= -0.2 ? 1 : 0);   // a quad shifts by its front legs
    rise = Math.max(rise, arc * gp.bounce * (0.3 + pace));
    sway -= side * arc * gp.sway * min(1, 0.3 + pace);
    turn -= side * arc * gp.hipTurn * pace;
  });
  if (pend) pendulumBody(m, g, gp, s, pace, v, dt, lame, legOk);
  else { m.bob = min(m.bob, lame) + rise * s; stillBody(m); }
  // Into a run, a sprinter's lean: the torso pitches forward and the hips
  // sink (runLean, runDrop), easing in and out over a quarter second.
  m.runK = (m.runK || 0) + ((dir > 0 ? runOf(m, pace) : 0) - (m.runK || 0)) * min(1, dt * 4);
  m.runLean = (gp.runLean || 0) * m.runK;
  m.bob -= (gp.runDrop || 0) * s * m.runK;
  m.sway = sway; m.hipYaw = turn;   // drawn (render/scene.js), not felt: the guns and the eye don't sway
  // A planted foot left hopelessly far away (shoved, respawned) just resets.
  m.feet.forEach((f, i) => {
    if (f.lifted) return;
    const r = restFoot(G, m, i);
    if (hypot(f.pos[0] - r[0], f.pos[2] - r[2]) > 7 * s) f.pos = r;
  });
}

// The pendulum body (BODY.model 'pendulum', data/walk.js). The planted leg
// is held nearly straight (its knee opened to `knee` degrees) and the hull
// vaults over it like a weight on a stiff pole: highest right over the foot,
// lowest between steps (`vault` of the pole's fall; the legs straighten for
// the rest), so it rises and falls with every step, and it goes a
// little faster low than high (it trades height for speed). The swinging leg
// does the bending. Walking, the mech stands taller than it does at rest; it
// settles back into its stance as it stops. On top of that the hull sits on
// a spring that each footfall pushes down (footDown) and that comes back
// late, with an overshoot: the weight landing on the new leg. The torso
// follows the hull on a softer spring of its own, so it drops a beat after
// the hips and nods as it lags. All of it is drawn, like the old bob: the
// mech's place, speed and feet are the same under either body.
function pendulumBody(m, g, gp, s, pace, v, dt, lame, legOk) {
  const l1 = g.l1 * s, l2 = g.l2 * s, c = cos(m.yaw), sn = sin(m.yaw);
  // A fast walk (not a run) bends the knee a little more (kneeFast), for the reach a long stride wants.
  const knee = gp.knee - (gp.kneeFast || 0) * pace * (1 - runOf(m, pace));
  const pole = Math.sqrt(l1 * l1 + l2 * l2 - 2 * l1 * l2 * cos(knee * PI / 180)), full = (l1 + l2) * 0.98;
  // The planted leg nearest upright holds the hull up, at its pole's length,
  // keeping `vault` of the pole's fall away from upright; none may be
  // stretched past its reach (the others straighten to keep up).
  let up = -Infinity, cap = Infinity, drop = Infinity;
  m.feet.forEach((f, i) => {
    if (f.lifted || !legOk(i)) return;
    const l = g.legs[i], hx = m.x + (c * l.hx + sn * l.hz) * s, hz = m.z + (-sn * l.hx + c * l.hz) * s;
    const dx = f.pos[0] - hx, dz = f.pos[2] - hz, flat = dx * dx + dz * dz, side = dx * c - dz * sn, ay = f.pos[1] + g.ankle * s;
    const h = Math.sqrt(Math.max(0, pole * pole - flat));
    const top = ay + Math.sqrt(Math.max(0, pole * pole - side * side));
    if (top - gp.vault * (top - ay - h) > up) { drop = top - ay - h; up = top - gp.vault * drop; }
    cap = min(cap, ay + Math.sqrt(Math.max(0, full * full - flat)));
  });
  // Off the rest height; in the air between strides (a runner's run) it keeps going as it was.
  const walkY = up === -Infinity ? (m.pWalk ?? 0) : min(up, cap) - (m.y + g.hip * s);
  if (drop === Infinity) drop = m.pDrop ?? 0;
  m.pWalk = walkY; m.pDrop = drop; m.pMean = (m.pMean ?? drop) + (drop - (m.pMean ?? drop)) * min(1, dt * 2);
  // Standing, its own stance; walking, the straight leg's height: eased in over the first third of its speed.
  const k = clampN(pace / 0.3, 0, 1), target = walkY * k * k * (3 - 2 * k);
  // Smoothed a touch where one leg hands over to the next, and the footfalls' spring.
  m.pVault = m.pVault == null ? target : m.pVault + (target - m.pVault) * min(1, dt / 0.04);
  const hit = (m.hull ||= makeSpring(gp.bodyK, gp.bodyZeta));
  hit.k = gp.bodyK; hit.c = 2 * Math.sqrt(gp.bodyK) * gp.bodyZeta;   // live from the GAIT page
  stepSpring(hit, dt, 0);
  const hullY = m.pVault + hit.x;
  m.bob = min(hullY, lame);
  // Low (more drop than usual) runs ahead, high falls back: drawn as the lurch, leaking back to nothing.
  const ahead = abs(v) * gp.speedUp * clampN((drop - m.pMean) / (0.05 * (l1 + l2)), -1, 1) * Math.sign(v);
  m.pAhead = (m.pAhead || 0) + (ahead - (m.pAhead || 0) * 3) * dt;
  m.surge = m.pAhead / s;
  const torso = (m.torso ||= makeSpring(1, 0.7));
  torso.k = 1 / (gp.lag * gp.lag); torso.c = 2 * Math.sqrt(torso.k) * 0.7;
  if (m.torsoDrop == null) torso.x = hullY;
  stepSpring(torso, dt, hullY);
  const lagM = torso.x - hullY;
  m.torsoDrop = lagM / s; m.torsoNod = -lagM * gp.nod;   // model units (render/scene.js, sim/geom.js torsoFrame); lagging low, it nods forward
}
// The old body (or none): no lag, no nod, and the pendulum's springs start afresh next time.
function stillBody(m) { m.torsoDrop = null; m.torsoNod = 0; m.hull = null; m.torso = null; m.pAhead = 0; m.pMean = null; m.pVault = null; m.pWalk = null; }

// Touchdown: the sound, the cockpit jolt, a puff of dust.
function footDown(G, m, f, pace) {
  const P = G.player, r = G.rng, d = P ? hypot(m.x - P.x, m.z - P.z) : 1e9;
  m.stepAt = G.time;   // the hull's dip (gait)
  if (m.hull) kickSpring(m.hull, -gaitOf(m).sink * m.ch.scale * (0.4 + 0.6 * pace));   // the pendulum body: the weight comes down on the new foot
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
