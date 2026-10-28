import { TOOL } from '../data/tools.js';
import { wrapA } from '../util/math.js';
import { viewYaw } from './geom.js';
import { bite } from './dig.js';
import { buildSwing } from './base.js';
import { feel } from './feel.js';
import { particle, msg, spawnClods } from './effects.js';

const { atan2, hypot, sin, cos, min, abs, PI } = Math;
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
}

// The arms' spin, each arm's angle kept in [0, a turn), 0 hanging down at
// rest. The left arm leads; the right starts as the left passes half a turn,
// so they stay half a turn apart (the left turns on even when it's shot off,
// keeping the beat, and only a bucket that's there scoops). Released, each
// arm turns on to the end of its turn and stops there.
const crosses = (a0, a1, at) => (a0 < at && a1 >= at) || (a0 < at + TAU && a1 >= at + TAU);
function spinArms(G, m, dt) {
  const T = TOOL.dig, s = (m.spin ||= { L: 0, R: 0, w: 0 }), full = TAU / T.turn;
  const held = !!m.toolHold && m.alive && !m.shutdown, arms = { L: m.hp.LA > 0, R: m.hp.RA > 0 };
  if (!held && s.L === 0 && s.R === 0) { s.w = 0; return; }
  s.w = min(full, s.w + full * dt / T.spinUp);   // up to speed, held or finishing a turn (a tap is one bucket's pass)
  const step = s.w * dt;
  const turn = (k, a0, a1) => {   // a1 unwrapped; returns the new angle
    if (!held) a1 = min(a1, TAU);   // finishing its turn
    if (arms[k] && crosses(a0, a1, T.bite)) scoop(G, m);
    return a1 >= TAU ? (held ? a1 - TAU : 0) : a1;
  };
  const L0 = s.L, L1 = held || L0 > 0 ? L0 + step : L0;
  if (L1 !== L0) s.L = turn('L', L0, L1);
  if (s.R > 0 || (held && !arms.L)) s.R = turn('R', s.R, s.R + step);
  else if (held && crosses(L0, L1, PI)) s.R = turn('R', 0, L1 - (L1 >= PI + TAU ? PI + TAU : PI));   // the left passed half a turn: the right sets off behind it
}

// The shoulder angle the renderer gives each arm, forward of hanging down
// (render/scene.js): null when the arms aren't spinning a tool.
export const spinPose = m => (m.spin && m.ch.tool === 'dig' ? { LA: m.spin.L, RA: m.spin.R } : null);

// One bucket's scoop: one of your own sites in reach gets its work, else the
// ground the aim finds is bitten. Felt either way; `m.scoops` counts them and
// `m.biteCorners` says what the last one turned to air (sim/miner.js reads both).
export function scoop(G, m) {
  const T = TOOL.dig;
  m.scoops = (m.scoops || 0) + 1;
  m.heat += T.heat;
  const e = siteInReach(G, m);
  if (e) return scoopSite(G, m, e);
  const p = runPoint(G, m);
  m.biteCorners = 0;
  if (!p) {
    m.dryScoops = (m.dryScoops || 0) + 1;
    if (m === G.player && m.dryScoops >= 3) msg(G, 'NOTHING TO DIG', '#fc3');
    feel(G, 'whiff', { mech: m });
    return;
  }
  const full = (m.ore || 0) >= m.ch.hopper;
  bite(G, m, p, m.digRun.r);
  m.dryScoops = m.biteCorners ? 0 : (m.dryScoops || 0) + 1;
  // Where it stood to dig: a parked digger comes back here (sim/miner.js), and
  // keeps its own heading there, only noting that the scoop dug.
  if (m.biteCorners) { if (m.parked && m.site) m.site.t = G.time; else m.site = { x: m.x, y: m.y, z: m.z, yaw: viewYaw(m), pitch: m.pitch || 0, t: G.time }; }
  feel(G, 'scoop', { mech: m, k: 1, at: m === G.player ? null : p });
  G.fx.sfx.scoop(m === G.player ? null : p, m.seamBite);
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

// The run of scoops into one face: the first is centred TOOL.dig.into past
// the surface the aim finds, radius r0; each next one keeps that centre and
// reaches `grow` further, so the hole widens smoothly and, past about 7 m,
// always takes a corner of the 8 m ground. After `steps`, or when the aim
// leaves the centre (more than `drift` off the line of the aim) or the mech
// moves, or the aim finds no ground at all, the next scoop starts a new run
// at the surface it finds then (none: nothing to dig).
function runPoint(G, m) {
  const T = TOOL.dig, run = m.digRun, a = aimGround(G, m);
  if (a && run && run.k < T.steps && hypot(m.x - run.at[0], m.z - run.at[1]) < 2 && offLine(run.c, AIM.o, AIM.d[run.tilt]) < T.drift) {
    run.r = T.r0 + run.k++ * T.grow;
    return run.c;
  }
  if (!a) { m.digRun = null; return null; }
  m.digRun = { c: a, r: T.r0, k: 1, at: [m.x, m.z], tilt: AIM.hit };
  return a;
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
  const T = TOOL.dig, s = m.ch.scale, yaw = viewYaw(m), reach = T.reach * s, o = [m.x, m.y + 4 * s, m.z];
  let t = null;
  AIM.o = o;
  for (let i = 0; i < TILT.length; i++) { const down = (m.pitch || 0) + TILT[i]; AIM.d[i] = [sin(yaw) * cos(down), sin(down), cos(yaw) * cos(down)]; }
  for (let i = 0; i < (m.parked ? 1 : TILT.length) && t == null; i++) {
    DIR[0] = AIM.d[i][0]; DIR[1] = AIM.d[i][1]; DIR[2] = AIM.d[i][2];
    t = G.ter.ray(o, DIR, reach);
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

// A scoop at a site: TOOL.dig.perSwing of them make one swing of work, the
// punch's pace (base.js buildSwing says BUILDING or NEEDS ORE).
function scoopSite(G, m, e) {
  const s = e.site, dx = e.x - m.x, dz = e.z - m.z, hd = hypot(dx, dz) || 1, p = [e.x - dx / hd * e.radius, e.y + 1, e.z - dz / hd * e.radius];
  s.scoops = (s.scoops || 0) + 1;
  const built = buildSwing(G, m, e, s.scoops >= TOOL.dig.perSwing);
  if (s.scoops >= TOOL.dig.perSwing && built) s.scoops = 0;
  feel(G, built ? 'scoop' : 'whiff', { mech: m, k: 0.8, at: m === G.player ? null : p });
  G.fx.sfx.scoop(m === G.player ? null : p, false);
  if (built) for (let i = 0; i < 4; i++) particle(G, [p[0] + G.rng.range(-2, 2), p[1], p[2] + G.rng.range(-2, 2)], [G.rng.range(-3, 3), G.rng.range(2, 5), G.rng.range(-3, 3)], G.rng.range(0.8, 1.4), G.rng.range(0.6, 1.2), G.pal.low, 'dust');
}
