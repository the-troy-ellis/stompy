import { cheat } from './cheats.js';
import { WEATHER } from '../data/weather.js';
import { clampN, mul } from '../util/math.js';
import { BOUND } from '../world/terrain.js';
import { particle } from './effects.js';
import { gait } from './gait.js';
import { feel, stepFeel } from './feel.js';
import { FEEL } from '../data/feel.js';
import { WALK } from '../data/walk.js';
import { tryStomp } from './melee.js';
import { voice } from './voice.js';
import { stepJets } from './jets.js';
import { geoOf } from '../data/geo.js';

const { sin, cos, min, max } = Math;

// How fast a push dies out, per second: an impulse of v m/s moves the mech about v / PUSH_DECAY metres.
export const PUSH_DECAY = 2.5;
const NO_FLY = [0, 0];

// The highest rise a mech walks up without a jump, times its scale (spec 18):
// anything taller is a wall.
export const STEP = 1.5;
// Where a mech stands at (x, z): the first ground below its step.
export const groundUnder = (G, m, x = m.x, z = m.z) => G.ter.groundBelow(x, m.y + STEP * m.ch.scale, z);
// How far into rock a mech's body would be at (x, z), moving along (dx, dz):
// the density at its step (a wall), at its chest a body's radius ahead, at
// its head (a roof too low for it); and for the mech you are in, just in
// front of its cockpit's eye, a little above it, so the view never goes into
// rock (a pocket the bucket dug at chest height has its roof at eye height).
// Above 0 is in rock. Only yours has a view to keep clear, and each sample
// returns a boxed number (scripts/perf.mjs counts the garbage).
export const CAB_CLEAR = 0.8;   // m in front of the eye that stay clear: the near plane (0.5 m) and its corners
export function rockAt(G, m, x, z, dx, dz) {
  const g = geoOf(m), s = m.ch.scale, ter = G.ter, R = g.radius * s;
  // In a fine patch's pit (docs/specs/27-fine-dig.md) the body is weighed from
  // the 8 m ground over it, not the pit's floor: a pit is never a wall, and a
  // mech climbs out of one step by step wherever the 8 m ground lets it walk.
  const y = ter.patches?.length ? max(m.y, ter.groundBelow(x, m.y + g.height * s * 0.9, z, m.y, true)) : m.y;
  const body = max(ter.sample(x, y + STEP * s, z), ter.sample(x + dx * R, y + g.torsoY * s, z + dz * R), ter.sample(x, y + g.height * s * 0.95, z));
  if (m !== G.player) return body;
  const a = m.yaw + (m.twist || 0), f = g.eye[2] * s + CAB_CLEAR;
  return max(body, ter.sample(x + sin(a) * f, y + (g.torsoY + g.eye[1]) * s + CAB_CLEAR * 0.3, z + cos(a) * f));
}

// A grade (rise over run) as a speed factor: uphill slow, downhill a touch quick.
export const gradeFactor = grade => clampN(grade > 0 ? 1 - grade * WALK.slopeUp : 1 - grade * WALK.slopeDown, WALK.slopeMin, WALK.slopeMax);
// Four legs keep their grip: a crawler (quad) walks a hill at its flat speed (spec 16).
export const grips = m => m.ch.legs === 'quad';

// The grade under the mech along its heading, as a speed factor. Sampled two
// metres fore and aft.
export function slopeFactor(G, m) {
  if (grips(m)) return 1;
  const fx = sin(m.yaw), fz = cos(m.yaw);
  return gradeFactor((groundUnder(G, m, m.x + fx * 2, m.z + fz * 2) - groundUnder(G, m, m.x - fx * 2, m.z - fz * 2)) / 4);
}

// Touchdown dust: a puff under the feet, and for a hard landing (force over
// 0.7) a ring that races outward along the ground. (The shockwave mesh is M4.)
function landingDust(G, m, ground, force) {
  const r = G.rng, s = m.ch.scale, col = mul(G.pal.low, 0.85), n = Math.round(4 * FEEL.land.dust * force * s);
  for (let i = 0; i < n; i++) particle(G, [m.x + r.range(-1.5, 1.5) * s, ground + 0.3, m.z + r.range(-1.5, 1.5) * s], [r.range(-3, 3), r.range(1, 3), r.range(-3, 3)], r.range(0.7, 1.2), r.range(0.6, 1.1) * s, col, 'smoke');
  if (force > 0.7) {
    const ring = Math.round(6 * FEEL.land.dust * s);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + r.range(-0.1, 0.1), v = r.range(9, 14) * force;
      particle(G, [m.x + sin(a) * 1.2 * s, ground + 0.2, m.z + cos(a) * 1.2 * s], [sin(a) * v, r.range(0.5, 1.5), cos(a) * v], r.range(0.5, 0.9), r.range(0.8, 1.4) * s, col, 'smoke');
    }
  }
}

// One mech, one frame: speed, jets, gravity, heat, shutdown, cooldowns, legs.
export function stepMech(G, m, dt) {
  const r = G.rng, legs = (m.hp.LL > 0 ? 0.5 : 0) + (m.hp.RL > 0 ? 0.5 : 0);
  let maxS = (m.maxSpeed ?? m.ch.speed) * (legs >= 1 ? 1 : legs > 0 ? 0.45 : 0);   // no legs: sat down, a turret
  if (m.heat > 85) maxS *= 0.65;
  // The ground: a grade under the heading slows the climb and hurries the descent,
  // and a landing holds the legs for a moment while the feet dig in.
  if (!m.air) maxS *= slopeFactor(G, m);
  if (m.dig > 0) { m.dig = max(0, m.dig - dt); maxS *= WALK.digSlow; }
  const target = !m.alive || m.shutdown ? 0 : m.throttle * maxS;
  m.speed += clampN(target - m.speed, -11 * dt, 7 * dt);
  const push = m.push || (m.push = [0, 0]);
  // Walls: each axis moves only if the body fits there, so a mech slides
  // along a wall it meets at an angle. One already in rock (a roof dug lower,
  // a step up under a low ceiling) may only move to where it is less so.
  const fly = m.air && m.jet?.blasted ? m.jet.fly : NO_FLY;   // a blast-off's speed along (sim/jets.js): it carries the flight, undying, until it lands
  const x0 = m.x, z0 = m.z, nx = clampN(m.x + (sin(m.yaw) * m.speed + push[0] + fly[0]) * dt, -BOUND, BOUND), nz = clampN(m.z + (cos(m.yaw) * m.speed + push[1] + fly[1]) * dt, -BOUND, BOUND);
  const here = rockAt(G, m, x0, z0, 0, 0), fits = r => r <= 0 || r < here;
  let walled = false;
  if (nx !== x0 && !fits(rockAt(G, m, nx, z0, Math.sign(nx - x0), 0))) { walled = true; push[0] = 0; if (fly !== NO_FLY) fly[0] = 0; } else m.x = nx;
  if (nz !== z0 && !fits(rockAt(G, m, m.x, nz, 0, Math.sign(nz - z0)))) { walled = true; push[1] = 0; if (fly !== NO_FLY) fly[1] = 0; } else m.z = nz;
  // Against a wall the legs walk only as fast as the body goes (gait.js reads
  // `slide`), so planted feet stay put; the throttle's speed is kept for when it's clear.
  m.walled = walled;
  m.slide = walled && dt > 0 ? Math.sign(m.speed) * Math.hypot(m.x - x0, m.z - z0) / dt : m.speed;
  const keep = max(0, 1 - PUSH_DECAY * dt);   // a push carries about PUSH_DECAY^-1 of its speed in metres
  push[0] *= keep; push[1] *= keep;
  // Skidding: dust streaks behind the feet while the push is strong.
  const skid = Math.hypot(push[0], push[1]);
  if (skid > 2 && m.alive && !m.air && r.chance(dt * FEEL.knock.skidDust * min(1, skid / 10))) {
    particle(G, [m.x - push[0] / skid * 1.5 * m.ch.scale + r.range(-1, 1), m.y + 0.3, m.z - push[1] / skid * 1.5 * m.ch.scale + r.range(-1, 1)],
      [-push[0] * 0.3 + r.range(-1, 1), r.range(1, 2.5), -push[1] * 0.3 + r.range(-1, 1)], r.range(0.5, 0.9), r.range(0.6, 1.1) * m.ch.scale, mul(G.pal.low, 0.8), 'smoke');
  }

  const ground = groundUnder(G, m);
  // Blast-off jets (sim/jets.js, docs/specs/26-blast-off.md): held, they
  // charge; let go, the mech blasts off. No thrust after that: it flies.
  stepJets(G, m, dt);
  m.vy -= 18 * dt;
  // A ceiling: a blast-off takes the head into rock no further.
  if (m.vy > 0 && G.ter.solid(m.x, m.y + geoOf(m).height * m.ch.scale + m.vy * dt, m.z)) m.vy = 0;
  m.y += m.vy * dt;
  if (m.air) {
    m.airT = (m.airT || 0) + dt;
    // A dust storm shoves a mech that is up on its jets (spec 07), never one on the ground.
    const w = G.weather, push = w && WEATHER[w.kind].push;
    if (push) { const s = Math.hypot(w.wind[0], w.wind[1]) || 1; m.x += w.wind[0] / s * push * w.intensity * dt; m.z += w.wind[1] / s * push * w.intensity * dt; }
    // Coming down onto a mech: a stomp, and a bounce back up off it.
    if (m.vy < 0 && tryStomp(G, m, m.airT)) m.airT = 0;
  }
  if (m.vy <= 0 && m.y - ground < 1.2) {
    if (m.air) {
      const force = clampN(-m.vy / 20, 0.25, 1);
      m.airT = 0;
      feel(G, 'land', { mech: m, k: force, at: m === G.player ? null : [m.x, m.y, m.z] });
      if (m === G.player) G.fx.sfx.land(force);
      else G.fx.sfx.step(m, force * 0.8);
      landingDust(G, m, ground, force);
      // Dig-in: the landing takes the run out of the legs for a beat.
      m.speed *= 1 - WALK.digCut * force; m.dig = WALK.digHold * force;
    }
    m.y = ground; m.vy = 0; m.air = false;
  } else if (m.y > ground + 1.2) m.air = true;
  if (m.y < ground) { m.y = ground; m.vy = max(0, m.vy); }

  return finishStep(G, m, dt);
}

// Heat, shutdown, cooldowns, springs and legs: the second half of a step.
function finishStep(G, m, dt) {
  m.heat = m === G.player && cheat(G, 'heat') ? 0 : max(0, m.heat - (m.shutdown ? 20 : m.sink ?? m.ch.sink) * dt);   // NO HEAT (sim/cheats.js)
  if (!m.shutdown && m.heat >= 100) {
    m.shutdown = true;
    feel(G, 'shutdown', { mech: m, at: m === G.player ? null : [m.x, m.y, m.z] });
    if (m === G.player) { G.fx.sfx.powerdown(); voice(G, 'shutdown'); }
  } else if (m.shutdown && m.heat < 45) {
    m.shutdown = false;
    feel(G, 'restart', { mech: m, at: m === G.player ? null : [m.x, m.y, m.z] });
    if (m === G.player) { G.fx.sfx.powerup(); voice(G, 'online'); }
  }
  if (m === G.player && m.heat > 80 && !m.shutdown) G.fx.say('Warning. Heat critical.');
  for (const w of m.weapons) w.cd = max(0, w.cd - dt);
  if (m.scramble > 0) m.scramble = max(0, m.scramble - dt);

  stepFeel(m, dt);
  gait(G, m, dt);
}
