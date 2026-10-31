import { TOOL } from '../data/tools.js';
import { wrapA } from '../util/math.js';
import { viewYaw } from './geom.js';
import { STEP } from './mech.js';
import { bite } from './dig.js';
import { buildSwing, siteDone } from './base.js';
import { feel } from './feel.js';
import { FEEL, HIT_STOP } from '../data/feel.js';
import { particle, msg, spawnClods } from './effects.js';

const { atan2, hypot, sin, cos, min, abs, exp, PI } = Math;
const TAU = 2 * PI;

// The construction mechs' tools (docs/specs/25-hold-to-dig.md). A chassis
// with a `tool` has its primary button run it, held (`m.toolHold`: the
// player's button in update.js, or a parked digger's own job in miner.js).
// The digger's is DIG: its two arms spin at the shoulders like a paddle
// wheel, half a turn apart (`m.spin`: each arm's angle past hanging down,
// and the speed), and each bucket scoops as it passes TOOL.dig.bite. Let go
// and each arm finishes its turn and stops, bucket down; a tap is one
// bucket's pass. A scoop builds one of your own construction sites in reach,
// else bites the ground the aim finds, as the punch's bite did.

export function stepTool(G, m, dt) {
  if (m.ch.tool === 'dig') spinArms(G, m, dt);
  else if (m.ch.tool === 'build') swingCrane(G, m, dt);
}

// BUILD (docs/specs/31-builder.md): held, the crane swings, one swing every
// TOOL.build.swing s (`m.crane.t`, through it); each swing's end slams a piece
// into a construction site in reach and in front (base.js buildSwing). Let go
// and the swing in hand finishes, the hook back down.
function swingCrane(G, m, dt) {
  const T = TOOL.build, s = (m.crane ||= { t: 0 }), held = !!m.toolHold && m.alive && !m.shutdown;
  if (!held && s.t === 0) return;
  s.t += dt;
  if (s.t < T.swing) return;
  s.t = held ? s.t - T.swing : 0;
  if (held) slam(G, m);
}
// One piece: the site in reach gets a swing of work if its ore pays for it
// (else NEEDS ORE, base.js). Pieces in a row at one site build up, as a dig
// run does (spec 28): each a little harder and lower; the last a landing's thump.
function slam(G, m) {
  m.heat += TOOL.build.heat;
  const e = siteInReach(G, m), at = m === G.player ? null : e ? [e.x, e.y, e.z] : null;
  if (!e) {
    if (m === G.player) msg(G, 'NOTHING TO BUILD', '#fc3');
    feel(G, 'whiff', { mech: m });
    return;
  }
  const site = e.site;
  if (!buildSwing(G, m, e, true)) { feel(G, 'whiff', { mech: m }); m.buildRun = null; return; }
  const run = m.buildRun && m.buildRun.site === site ? m.buildRun : (m.buildRun = { site, k: 0 });
  run.k++;
  const done = siteDone(site), into = min(1, (run.k - 1) / 5);
  feel(G, done ? 'built' : 'slam', { mech: m, k: done ? 1 : 0.6 + 0.4 * into, at });
  if (done) G.fx.sfx.built(at); else G.fx.sfx.slam(at, into);
  const p = [e.x, e.y + (e.height || 2), e.z], n = done ? 18 : 6;
  for (let i = 0; i < n; i++) particle(G, [p[0] + G.rng.range(-3, 3), p[1], p[2] + G.rng.range(-3, 3)], [G.rng.range(-3, 3), G.rng.range(1, 4), G.rng.range(-3, 3)], G.rng.range(0.8, 1.6), G.rng.range(0.8, 1.6), G.pal.low, 'dust');
}
// The crane's swing as the arms' angle forward of hanging down (render/scene.js):
// up and over through the swing, and down hard at its end (the slam).
const craneAngle = m => { const u = (m.crane?.t || 0) / TOOL.build.swing; return u < 0.75 ? 1.9 * u / 0.75 : 1.9 * (1 - (u - 0.75) / 0.25); };

// The arms' spin, each arm's angle kept in [0, a turn), 0 hanging down at
// rest. The left arm leads; the right starts as the left passes half a turn,
// so they stay half a turn apart (the left turns on even when it's shot off,
// keeping the beat, and only a bucket that's there scoops). Released, each
// arm turns on to the end of its turn and stops there.
const crosses = (a0, a1, at) => (a0 < at && a1 >= at) || (a0 < at + TAU && a1 >= at + TAU);
function spinArms(G, m, dt) {
  const T = TOOL.dig, s = (m.spin ||= { L: 0, R: 0, w: 0 }), full = TAU / T.turn;
  const held = !!m.toolHold && m.alive && !m.shutdown, arms = { L: m.hp.LA > 0, R: m.hp.RA > 0 };
  if (s.hL || s.hR) { const f = exp(-FEEL.dig.hitchBack * dt); s.hL = (s.hL || 0) * f; s.hR = (s.hR || 0) * f; }   // a bit arm catching up
  if (!held && s.L === 0 && s.R === 0) { s.w = 0; return; }
  s.w = min(full, s.w + full * dt / T.spinUp);   // up to speed, held or finishing a turn (a tap is one bucket's pass)
  const step = s.w * dt;
  const turn = (k, a0, a1) => {   // a1 unwrapped; returns the new angle
    if (!held) a1 = min(a1, TAU);   // finishing its turn
    if (arms[k] && crosses(a0, a1, T.bite)) scoop(G, m, k);
    return a1 >= TAU ? (held ? a1 - TAU : 0) : a1;
  };
  const L0 = s.L, L1 = held || L0 > 0 ? L0 + step : L0;
  if (L1 !== L0) s.L = turn('L', L0, L1);
  if (s.R > 0 || (held && !arms.L)) s.R = turn('R', s.R, s.R + step);
  else if (held && crosses(L0, L1, PI)) s.R = turn('R', 0, L1 - (L1 >= PI + TAU ? PI + TAU : PI));   // the left passed half a turn: the right sets off behind it
}

// The shoulder angle the renderer gives each arm, forward of hanging down
// (render/scene.js): null when the arms aren't spinning a tool.
// An arm that bit rock lags a little behind its spin (`hL`, `hR`), drawn only.
export const spinPose = m => (m.spin && m.ch.tool === 'dig' ? { LA: m.spin.L - (m.spin.hL || 0), RA: m.spin.R - (m.spin.hR || 0) }
  : m.ch.tool === 'build' ? { LA: craneAngle(m), RA: craneAngle(m) } : null);   // the builder's crane: both arms through a swing

// One bucket's scoop (`arm`, 'L' or 'R'): one of your own sites in reach gets
// its work, else the ground the aim finds is bitten. Felt either way, by what
// the bucket met (scoopFeel); `m.scoops` counts them and `m.biteCorners` says
// what the last one turned to air (sim/miner.js reads both).
export function scoop(G, m, arm = 'L') {
  const T = TOOL.dig;
  m.scoops = (m.scoops || 0) + 1;
  m.heat += T.heat;
  const p = runPoint(G, m);   // a digger digs; it doesn't build (builders do, docs/specs/31-builder.md)
  m.biteCorners = 0;
  if (!p) {
    m.dryScoops = (m.dryScoops || 0) + 1;
    if (m === G.player && m.dryScoops >= 3) msg(G, 'NOTHING TO DIG', '#fc3');
    feel(G, 'whiff', { mech: m });
    return;
  }
  const full = (m.ore || 0) >= m.ch.hopper;
  bite(G, m, p, m.digRun.r, m.digRun.fl, m.digRun.sl);
  m.dryScoops = m.biteCorners ? 0 : (m.dryScoops || 0) + 1;
  // Where it stood to dig: a parked digger comes back here (sim/miner.js), and
  // keeps its own heading there, only noting that the scoop dug.
  if (m.biteCorners) { if (m.parked && m.site) m.site.t = G.time; else m.site = { x: m.x, y: m.y, z: m.z, yaw: viewYaw(m), pitch: m.pitch || 0, t: G.time }; }
  scoopFeel(G, m, p, arm);
  // Clods out of the face toward the digger, in what it cut: a seam's colour,
  // rock, or soil. A scoop that turned no corner throws what the run last cut.
  const run = m.digRun;
  if (m.biteCorners) run.kind = m.seamBite ? 'ore' : m.biteRock ? 'rock' : 'low';
  spawnClods(G, p, T.clods[0] + Math.floor(G.rng.next() * (T.clods[1] - T.clods[0] + 1)), G.pal[run.kind || 'low'] || G.pal.low, [m.x, m.y + 2, m.z]);
  if (m.seamBite) {   // a seam (docs/specs/21-mining.md): a sparkle in its colour
    for (let i = 0; i < 4; i++) particle(G, [p[0] + G.rng.range(-1.5, 1.5), p[1] + 1, p[2] + G.rng.range(-1.5, 1.5)], [G.rng.range(-3, 3), G.rng.range(5, 10), G.rng.range(-3, 3)], G.rng.range(0.5, 0.9), G.rng.range(0.3, 0.6), G.pal.ore || G.pal.high, 'spark', 26);
    if (m === G.player && !full) msg(G, 'ORE SEAM', '#7fd');
  }
  if (m === G.player && full) msg(G, 'HOPPER FULL', '#fc3');
}

// How a scoop feels (docs/specs/28-dig-feel.md), by what the bucket met:
// soil or air, a swish (scoopSoft); rock, a clunk (scoop), the arm hitching;
// rock breaking loose, the scoop that takes ore, a crack (scoopCrack): the
// arm hitches further, the crosshair holds a beat, and chips fly. Each scoop
// in a run hits a little harder and sounds a little lower, building to it.
// What the scoop took, and how fast, are the same as ever.
// On the 4 m grid nearly every rock scoop turns a corner, and a corner is a
// fraction of an ore (docs/specs/29-ground-4m.md): the crack is the scoop
// that tips a whole one into the hopper, or that broke rock with it full.
export function scoopTier(G, m, p) {
  if (m.biteRock && (m.biteOre > 0 || (m.ore || 0) >= m.ch.hopper)) return 2;
  return m.biteRock || (G.ter && G.ter.inRock(p[0], p[1], p[2])) ? 1 : 0;
}
function scoopFeel(G, m, p, arm) {
  const D = FEEL.dig, tier = scoopTier(G, m, p), run = m.digRun, T = TOOL.dig;
  const into = run ? min(1, (run.k - 1) / (T.steps - 1)) : 0, at = m === G.player ? null : p;
  feel(G, ['scoopSoft', 'scoop', 'scoopCrack'][tier], { mech: m, k: tier === 2 ? 1 : 1 - D.ramp + D.ramp * into, at });
  G.fx.sfx.scoop(at, m.seamBite, tier, into);
  if (tier && m.spin) m.spin[arm === 'R' ? 'hR' : 'hL'] = tier === 2 ? D.hitchCrack : D.hitchRock;
  if (tier === 2) {
    if (m === G.player) G.hitStop = Math.max(G.hitStop || 0, HIT_STOP);
    for (let i = 0; i < 6; i++) particle(G, [p[0] + G.rng.range(-1, 1), p[1] + G.rng.range(-1, 1), p[2] + G.rng.range(-1, 1)], [G.rng.range(-5, 5), G.rng.range(3, 8), G.rng.range(-5, 5)], G.rng.range(0.4, 0.7), G.rng.range(0.3, 0.6), G.pal.high, 'spark', 26);
  }
}

// The run of scoops into one face: the first is centred TOOL.dig.into past
// the surface the aim finds, radius r0; each next one keeps that centre and
// reaches `grow` further, so the hole widens smoothly and, past about 7 m,
// always takes a corner of the 8 m ground. After `steps`, or when the aim
// leaves the centre (more than `drift` off the line of the aim) or the mech
// moves, or the aim finds no ground at all, the next scoop starts a new run
// at the surface it finds then (none: nothing to dig).
function runPoint(G, m) {
  const T = TOOL.dig, run = m.digRun, a = aimGround(G, m);
  if (AIM.d[0][1] > RAMP_FROM && !m.parked) return rampPoint(G, m);   // aimed well up: a ramp (docs/specs/30-dig-up.md)
  if (a && run && run.k < T.steps && hypot(m.x - run.at[0], m.z - run.at[1]) < 2 && offLine(run.c, AIM.o, AIM.d[run.tilt]) < T.drift) {
    run.r = T.r0 + run.k++ * T.grow;
    return run.c;
  }
  if (!a) { m.digRun = null; return null; }
  // fl: a face's run (aimed within LEVEL of level) is flat-bottomed at the
  // feet; a parked digger's tunnel stays at its mouth's level (sim/miner.js),
  // so no dip deepens into a pit. Aimed down at the floor, it's round (-Infinity).
  // A parked digger in its own tunnel floors it at the mouth, unless it's
  // down in a pit below that. Aimed up, it's a ramp (rampPoint).
  const d = AIM.d[AIM.hit], level = d[1] > -LEVEL, h = hypot(d[0], d[2]) || 1, slope = d[1] > 0 ? min(T.ramp, d[1] / h) : 0;
  const mo = m.parked && m.site?.mouth, fl = !level ? -Infinity : mo && m.y > mo[1] - 1 ? mo[1] : m.y;
  m.digRun = { c: a, r: T.r0, k: 1, at: [m.x, m.z], tilt: AIM.hit, fl, sl: level && slope > 0 ? [slope * d[0] / h, slope * d[2] / h, m.x, m.z] : null };
  return a;
}
// A face's scoop (the level aim) keeps the floor: a flat-bottomed bite down
// to the digger's feet, so it tunnels on level, with no toe of rock left at
// the face and no pit under it (docs/specs/29-ground-4m.md). Aimed at the
// floor in front, it's round and digs down, as it always did.
// The floor is the feet's height where the run began, so scoops that reach
// back under the digger never lower what it stands on.
const LEVEL = sin(15 * PI / 180);
// Aimed up, a run cuts a ramp (docs/specs/30-dig-up.md): not where the aim
// meets the ground (a wall overhead, or nothing in reach), but along the ramp
// itself, centred rampAt metres ahead, rampLift over where its floor will be,
// so each scoop clears the floor and the headroom over it. The floor slopes
// up from the feet as steep as the aim, to TOOL.dig.ramp.
const RAMP_FROM = sin(9 * PI / 180);   // the aim this far above level, or more, digs a ramp
function rampPoint(G, m) {
  const T = TOOL.dig, run = m.digRun, d = AIM.d[0];
  if (run && run.ramp && run.k < T.steps && hypot(m.x - run.at[0], m.z - run.at[1]) < 2) {
    run.r = T.r0 + run.k++ * T.grow;
    return run.c;
  }
  const h = hypot(d[0], d[2]) || 1, fx = d[0] / h, fz = d[2] / h, slope = min(T.ramp, d[1] / h), D = T.rampAt * m.ch.scale;
  const c = [m.x + fx * D, m.y + slope * D + T.rampLift, m.z + fz * D];
  // Nothing to dig (open ground, the sky) if no ground stands over where the
  // ramp would run, at its middle or as far as the run's last scoop reaches.
  const far = D + T.r0 + T.grow * (T.steps - 1), C = G.ter.coarse;
  if (C.height(c[0], c[2]) < c[1] - T.rampLift + 0.5 && C.height(m.x + fx * far, m.z + fz * far) < m.y + slope * far + 0.5) { m.digRun = null; return null; }
  m.digRun = { c, r: T.r0, k: 1, at: [m.x, m.z], tilt: 0, ramp: true, fl: m.y, sl: [slope * fx, slope * fz, m.x, m.z] };
  return c;
}
// How far a point is off a ray (o, unit d), ahead of its start; behind it is far.
function offLine(c, o, d) {
  const vx = c[0] - o[0], vy = c[1] - o[1], vz = c[2] - o[2], t = vx * d[0] + vy * d[1] + vz * d[2];
  if (t < 0) return Infinity;
  return hypot(vx - d[0] * t, vy - d[1] * t, vz - d[2] * t);
}

// Rays from the bucket's height along where the mech looks find the ground
// within reach: first nearly level (the face of a wall or a mesa: mining),
// then tipped well down (the floor in front: a pit). Parked, only ahead,
// never the floor it stands on. The scoop is centred TOOL.dig.into past the
// surface. Null with no ground in reach.
const DIR = [0, 0, 0], TILT = [-0.12, -0.75], AIM = { o: [0, 0, 0], d: [[0, 0, 1], [0, 0, 1]], hit: 0 };   // AIM: the rays the last aim cast, and which hit, for runPoint
export function aimGround(G, m) {
  // On the 8 m ground (docs/specs/27-fine-dig.md), from the bucket's height
  // over where the mech would stand on it (a step up at most, as it walks:
  // sim/mech.js groundUnder): the face a scoop's ore is counted on, so the pace
  // is the punch's as before. The fine ground is that ground with the scoops' round bites out
  // of it (world/finePatch.js patchSample), so the bites land on the face you see.
  const T = TOOL.dig, s = m.ch.scale, yaw = viewYaw(m), reach = T.reach * s;
  const o = [m.x, Math.max(m.y, G.ter.coarse.groundBelow(m.x, m.y + STEP * s, m.z, m.y - 4 * s)) + T.lift * s, m.z];
  let t = null;
  AIM.o = o;
  for (let i = 0; i < TILT.length; i++) { const down = (m.pitch || 0) + TILT[i]; AIM.d[i] = [sin(yaw) * cos(down), sin(down), cos(yaw) * cos(down)]; }
  const up = AIM.d[0][1] > RAMP_FROM;   // aimed well up: only up, to dig a ramp out (docs/specs/30-dig-up.md), never the floor's pit instead
  for (let i = 0; i < (m.parked || up ? 1 : TILT.length) && t == null; i++) {
    DIR[0] = AIM.d[i][0]; DIR[1] = AIM.d[i][1]; DIR[2] = AIM.d[i][2];
    t = G.ter.coarse.ray(o, DIR, reach);
    AIM.hit = i;
  }
  if (t == null) return null;
  t += T.into;
  return [o[0] + DIR[0] * t, o[1] + DIR[1] * t, o[2] + DIR[2] * t];
}

// The nearest live part of one of your team's construction sites in front of
// the buckets and within their reach (docs/specs/23-construction-sites.md).
const ARC = 35 * PI / 180, REACH = 11;
export function siteInReach(G, m) {
  const reach = REACH * m.ch.scale, facing = viewYaw(m);
  let best = null, bd = Infinity;
  for (const s of G.base?.sites || []) for (const e of s.parts) {
    if (!e.alive || e.team !== m.team) continue;
    const dx = e.x - m.x, dz = e.z - m.z, d = hypot(dx, dz) - e.radius;
    if (d > reach || d >= bd || abs(wrapA(atan2(dx, dz) - facing)) > ARC) continue;
    best = e; bd = d;
  }
  return best;
}
export const siteReach = m => REACH * m.ch.scale;   // how near a digger stands to build (sim/miner.js)

