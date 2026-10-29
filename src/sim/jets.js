import { JETS, JETS_FLIGHT } from '../data/systems.js';
import { geoOf } from '../data/geo.js';
import { feel } from './feel.js';
import { particle, scorch } from './effects.js';
import { center } from './geom.js';
import { dot, norm, sub } from '../util/math.js';

const { min, max, sin, cos, hypot, sqrt } = Math;

// Blast-off jets (docs/specs/26-blast-off.md). Hold JUMP (`m.jetting`) on
// the ground with the jets ready and they charge (`m.jet.charge`, 0 to 1 in
// JETS[level].charge s): the mech crouches and the jets build. Let go and it
// blasts off, up and along the way it walks, higher the fuller the charge,
// with a thunk, a ring of dust and a shockwave where it stood, and a smoke
// streak up the climb. `m.fuel` is how ready the jets are: 0 after a blast,
// back to 1 over JETS[level].recharge s; only full can charge.

export function stepJets(G, m, dt) {
  const lvl = m.jets ?? 1, T = JETS[lvl], j = (m.jet ||= { charge: 0, blasted: false, top: 0, fly: [0, 0] });
  if (!T) { j.charge = 0; return; }
  const able = m.alive && !m.shutdown && !m.air && m.fuel >= 1;
  if (m.jetting && able) j.charge = min(1, j.charge + dt / T.charge);
  else if (j.charge > 0) {
    if (!m.jetting && able) blastOff(G, m, T);   // let go: off it goes
    j.charge = 0;   // or lost: shut down, knocked into the air, the jets spent
  }
  if (!j.charge) m.fuel = min(1, m.fuel + dt / T.recharge);
  if (m.air) j.top = max(j.top, m.y);
  else if (j.blasted && m.vy <= 0) { j.blasted = false; j.lock = null; j.at = null; }   // down again
  if (j.blasted && m.vy > 0) streak(G, m);
}

// The blast: up by the charge, and the thunk, the ring and the heat. Along:
// with a lock (jetLock), aimed at where it'll be when this lands; without one,
// or backing up, along the legs' heading by the charge and the throttle.
const vyOf = (T, c) => T.vy[0] + (T.vy[1] - T.vy[0]) * (max(c, T.tap) - T.tap) / (1 - T.tap);
export function blastOff(G, m, T = JETS[m.jets ?? 1]) {
  const j = m.jet, c = max(j.charge, T.tap), k = (c - T.tap) / (1 - T.tap);
  m.vy = vyOf(T, c);
  const lock = j.lock?.alive && !(m.throttle < 0) ? j.lock : null;
  const along = T.fwd * c * (m.throttle || 0);   // backing up blasts back
  j.fly = lock ? aimBlast(m, lock, m.vy, T) : [sin(m.yaw) * along, cos(m.yaw) * along];   // carried until it lands (sim/mech.js)
  m.y += 0.5; m.air = true;
  m.heat += T.heat[0] + (T.heat[1] - T.heat[0]) * k;
  m.fuel = 0;
  j.blasted = true; j.top = m.y; j.base = null;
  j.lock = lock; j.used = 0; j.away = 0;
  feel(G, 'blastoff', { mech: m, k: 0.4 + 0.6 * c, at: m === G.player ? null : [m.x, m.y, m.z] });
  blastRing(G, [m.x, m.y, m.z], c, m.ch.scale);
  G.fx.sfx.blastoff(m === G.player ? null : [m.x, m.y, m.z], c);
}

// Where a mech blasted off: the shockwave ring, a scorch, a ring of dust
// racing out along the ground and a puff of smoke, bigger with the charge.
export function blastRing(G, p, c, s = 1) {
  const r = G.rng, gy = G.ter ? G.ter.groundBelow(p[0], p[1] + 1, p[2]) : p[1];
  particle(G, [p[0], gy + 0.3, p[2]], [0, 0, 0], 0.45, (12 + 22 * c) * s, [0.95, 0.86, 0.66], 'shock', 0, 0);
  if (c > 0.5) particle(G, [p[0], gy + 0.2, p[2]], [0, 0, 0], 0.8, (20 + 26 * c) * s, [0.85, 0.7, 0.5], 'shock', 0, 0);   // a full charge: a second, wider, slower ring
  scorch(G, p[0], p[2], (2.2 + 3.2 * c) * s, gy);
  const n = Math.round(18 + 30 * c);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.1, 0.1), v = r.range(10, 20) * (0.6 + 0.7 * c);
    particle(G, [p[0] + sin(a) * 2 * s, gy + 0.6, p[2] + cos(a) * 2 * s], [sin(a) * v, r.range(0.5, 3), cos(a) * v], r.range(0.8, 1.5), r.range(1.2, 2.4) * s, G.pal.low, 'dust');
  }
  // The ground kicked up: chunks thrown out and up, a pillar of flame where it stood.
  for (let i = 0; i < Math.round(4 + 8 * c); i++) {
    const a = r.range(0, Math.PI * 2), v = r.range(6, 14) * (0.5 + 0.5 * c);
    particle(G, [p[0], gy + 0.8, p[2]], [sin(a) * v, r.range(6, 14) * (0.5 + 0.5 * c), cos(a) * v], r.range(0.9, 1.6), r.range(0.4, 0.8) * s, G.pal.low, 'debris', 18);
  }
  for (let i = 0; i < Math.round(3 + 6 * c); i++) particle(G, [p[0] + r.range(-1, 1) * s, gy + 0.5, p[2] + r.range(-1, 1) * s], [r.range(-2, 2), r.range(2, 8), r.range(-2, 2)], r.range(0.25, 0.5), r.range(1.4, 2.4) * s, [1, 0.6, 0.2], 'fire');
  for (let i = 0; i < 12; i++) particle(G, [p[0] + r.range(-3, 3), gy + 1, p[2] + r.range(-3, 3)], [r.range(-2, 2), r.range(1, 4), r.range(-2, 2)], r.range(1.6, 2.6), r.range(1.8, 3.2) * s, [0.3, 0.28, 0.26], 'smoke');
}

// In the air after a blast (the player's, from update.js, every frame): the
// movement controls (`along`, `across`, each -1 to 1: forward and to the
// left) push the flight a little, up to steerOver m/s past the blast's own
// speed along. With a lock, the auto-steer then pulls toward where the target
// will be when this lands: at most `assist` m/s² and `assistMax` over the
// flight, never against your own steering. Steering away from the target for
// `letGo` s drops the lock, as does the target dying or getting `escape` m
// clear. `j.at` is where it'll land now (render/scene.js draws the ring).
export function airSteer(G, m, along, across, dt) {
  const j = m.jet, T = JETS[m.jets ?? 1];
  if (!T || !j?.blasted || !m.air) return;
  const fx = sin(m.yaw), fz = cos(m.yaw), sx = fx * along + fz * across, sz = fz * along - fx * across;
  if (along || across) {
    if (j.base == null) j.base = hypot(j.fly[0], j.fly[1]);
    j.fly[0] += sx * T.steer * dt; j.fly[1] += sz * T.steer * dt;
    const cap = j.base + JETS_FLIGHT.steerOver, sp = hypot(j.fly[0], j.fly[1]);
    if (sp > cap) { j.fly[0] *= cap / sp; j.fly[1] *= cap / sp; }
  }
  const at = j.at = landingAt(G, m), o = j.lock;
  if (!o) return;
  if (!o.alive || !at) { j.lock = null; return; }
  j.away = (along || across) && sx * (o.x - m.x) + sz * (o.z - m.z) < 0 ? (j.away || 0) + dt : 0;
  const v = groundVel(o), mx = o.x + v[0] * at.t - at.x, mz = o.z + v[1] * at.t - at.z, miss = hypot(mx, mz);
  if (j.away >= T.letGo || miss > JETS_FLIGHT.escape) { j.lock = null; return; }
  if (miss < 0.05 || at.t < 0.1) return;
  const k = min(miss / at.t, T.assist * dt, T.assistMax - (j.used || 0));
  if (k <= 0) return;
  j.fly[0] += mx / miss * k; j.fly[1] += mz / miss * k; j.used = (j.used || 0) + k;
}

// The lock (the player's, from update.js, while charging on the ground): the
// foe it would blast at, `m.jet.lock`. G.target if it's alive, within the
// jets' reach and inside the lock cone; else the foe nearest the crosshair
// that is, which becomes G.target (the brackets and the missiles share it). Then where this
// charge would land (`j.at`), and whether that's on it (`j.on`, with the
// missile lock's chirp as it comes true). Off the ground or not charging it
// lets go, unless it's carrying a flight.
export function jetLock(G, m) {
  const j = m.jet, T = JETS[m.jets ?? 1];
  if (!j || !T || j.blasted) return;
  const was = j.on;
  j.lock = null; j.on = false; j.at = null;
  if (!(j.charge > 0) || m.air || !m.alive) return;
  const cone = cos(JETS_FLIGHT.cone);
  const looks = o => o.alive && o.team !== m.team && !o.mate && hypot(o.x - m.x, o.z - m.z) <= T.reach && dot(norm(sub(center(o), G.eye)), G.view) > cone;
  let lock = G.target && looks(G.target) ? G.target : null;
  if (!lock) {
    let best = cone;
    for (const o of G.mechs) {
      if (o === m || !looks(o)) continue;
      const d = dot(norm(sub(center(o), G.eye)), G.view);
      if (d > best) { best = d; lock = o; }
    }
    if (lock) G.target = lock;
  }
  // This charge's flight, as blastOff would make it.
  const vy = vyOf(T, j.charge), w = walkVel(m), back = m.throttle < 0;
  const along = T.fwd * max(j.charge, T.tap) * (m.throttle || 0);
  const fly = lock && !back ? aimBlast(m, lock, vy, T) : [sin(m.yaw) * along, cos(m.yaw) * along];
  j.lock = lock;
  j.at = flight(G, m, m.x, m.y + 0.5, m.z, w[0] + fly[0], vy, w[1] + fly[1]);
  j.on = !!(lock && !back && j.at?.mech === lock);
  if (j.on && !was && m === G.player) G.fx.sfx.lock();
}

// The speed along an aimed blast takes: to where `o` will be when a flight
// up at `vy` comes down on its top, at its pace now, less what the mech's own
// walk carries; capped at `aimFwd` (too short a charge falls short, aimed).
export function aimBlast(m, o, vy, T) {
  const y0 = m.y + 0.5, d = vy * vy + 36 * (y0 - topOf(o));
  const t = d > 0 ? (vy + sqrt(d)) / 18 : vy / 9 + sqrt(max(0, 2 * y0 / 18));
  const v = groundVel(o), w = walkVel(m);
  let ax = (o.x + v[0] * t - m.x) / t - w[0], az = (o.z + v[1] * t - m.z) / t - w[1];
  const sp = hypot(ax, az);
  if (sp > T.aimFwd) { ax *= T.aimFwd / sp; az *= T.aimFwd / sp; }
  return [ax, az];
}

const topOf = o => o.y + geoOf(o).height * o.ch.scale;
// A mech's speed over the ground: its walk, a push (decaying, so counted at
// 0.4), and a blast's flight.
const walkVel = m => [sin(m.yaw) * m.speed + (m.push?.[0] || 0) * 0.4, cos(m.yaw) * m.speed + (m.push?.[1] || 0) * 0.4];
const groundVel = m => { const w = walkVel(m), f = m.air && m.jet?.blasted ? m.jet.fly : null; return f ? [w[0] + f[0], w[1] + f[1]] : w; };

// Where a flight comes down, as it goes now (no more steering): `flight`
// from here at its speed.
export function landingAt(G, m) {
  if (!m.air) return null;
  const v = groundVel(m);
  return flight(G, m, m.x, m.y, m.z, v[0], m.vy, v[1]);
}
// A flight from (x, y, z) at (vx, vy, vz), stepped at 20 a second for up to
// 6 s until it meets the ground or a mech's top, the other mechs walking on
// as they go now. { x, y, z, t, mech } (mech: the one it lands on, a stomp),
// or null.
function flight(G, m, x, y, z, vx, vy, vz) {
  const rm = geoOf(m).radius * m.ch.scale, h = 0.05;
  for (let t = h; t < 6; t += h) {
    vy -= 18 * h; x += vx * h; y += vy * h; z += vz * h;
    if (vy < 0) for (const o of G.mechs) {
      if (o === m || !o.alive) continue;
      const go = geoOf(o), top = topOf(o);
      if (y > top + 0.5 || y <= top - 2) continue;
      const v = groundVel(o);
      if (hypot(o.x + v[0] * t - x, o.z + v[1] * t - z) < go.radius * o.ch.scale + rm * 0.6) return { x, y: top, z, t, mech: o };
    }
    const g = G.ter.groundBelow(x, y + 2, z);
    if (y <= g) return { x, y: g, z, t, mech: null };
  }
  return null;
}

// The climb's streak: flame at the nozzles and smoke left hanging behind, as
// a missile's trail.
function streak(G, m) {
  const r = G.rng, s = m.ch.scale, at = [m.x + r.range(-0.6, 0.6) * s, m.y + 0.8 * s, m.z + r.range(-0.6, 0.6) * s];
  particle(G, at, [r.range(-1, 1), -10 - m.vy * 0.3, r.range(-1, 1)], 0.3, 1.2 * s, [1, 0.6, 0.2], 'fire');
  particle(G, at, [r.range(-1.5, 1.5), -14 - m.vy * 0.4, r.range(-1.5, 1.5)], 0.18, 0.7 * s, [1, 0.9, 0.5], 'flame');
  particle(G, at, [r.range(-0.6, 0.6), r.range(-1, 0.5), r.range(-0.6, 0.6)], r.range(1.4, 2.2), r.range(0.9, 1.5) * s, [0.62, 0.6, 0.58], 'smoke');
}
