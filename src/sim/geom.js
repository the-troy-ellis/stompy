import { M, add, chain, mul, sub, len } from '../util/math.js';
import { geoOf } from '../data/geo.js';

const { sqrt, min } = Math;

export const frame = m => chain(M.T(m.x, m.y + (m.bob || 0), m.z), M.RY(m.yaw), M.S(m.ch.scale));
export const torsoFrame = m => chain(frame(m), M.T(0, geoOf(m).torsoY, 0), M.RY(m.twist));
export const center = m => [m.x, m.y + 4.2 * m.ch.scale, m.z];
// Where a shell fired now from `from` at `speed` m/s meets a mech walking
// on its heading: two passes of time-of-flight are plenty at these ranges.
export function leadPoint(from, t, speed) {
  const c = center(t), v = [Math.sin(t.yaw) * t.speed, 0, Math.cos(t.yaw) * t.speed];
  let p = c;
  for (let i = 0; i < 2; i++) { const tof = len(sub(p, from)) / speed; p = add(c, mul(v, tof)); }
  return p;
}
export function muzzle(m, w) {
  const tf = torsoFrame(m), g = geoOf(m);
  if (w.mount === 'T') return M.apply(tf, w.def.kind === 'missile' ? [w.side % 2 ? -1.25 : 1.25, g.rackY, 0.6] : [-0.9, g.acY, 1.6]);
  return M.apply(tf, [(w.mount === 'LA' ? 1 : -1) * g.armX, g.armY - 1.2, 2.4]);
}
export const eyeOf = m => M.apply(torsoFrame(m), geoOf(m).eye);
export const viewYaw = m => m.yaw + m.twist;

// Mechs are vertical cylinders for hits.
export function rayCyl(o, d, m) {
  const [R, Hh] = m.cyl || [geoOf(m).radius * m.ch.scale, geoOf(m).height * m.ch.scale];
  const ox = o[0] - m.x, oz = o[2] - m.z, a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-8) return null;
  const b = 2 * (ox * d[0] + oz * d[2]), c = ox * ox + oz * oz - R * R, disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0) continue;
    const y = o[1] + d[1] * t;
    if (y >= m.y && y <= m.y + Hh) return t;
  }
  return null;
}
// Terrain is ray-marched in 4 m steps, then bisected.
export function rayTerrain(G, o, d, maxT) {
  if (!(maxT > 0) || !Number.isFinite(o[0] + o[1] + o[2] + d[0] + d[1] + d[2])) return null;   // a NaN here would march forever
  const ter = G.ter, step = 4;
  let prev = 0;
  for (let t = min(step, maxT); ; t = min(t + step, maxT)) {
    const p = add(o, mul(d, t));
    if (p[1] < ter.height(p[0], p[2])) {
      let lo = prev, hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2, q = add(o, mul(d, mid));
        if (q[1] < ter.height(q[0], q[2])) hi = mid; else lo = mid;
      }
      return hi;
    }
    if (t >= maxT) return null;
    prev = t;
  }
}
// Structures and vehicles are cylinders too (entities.js); a nav point has no body.
export function rayEnt(o, d, e) { return rayCyl(o, d, { x: e.x, y: e.y, z: e.z, ch: { scale: 1, legs: null }, cyl: [e.radius, e.height] }); }
export function rayHit(G, o, d, maxT, ignore) {
  let best = null;
  for (const m of G.mechs) {
    if (!m.alive || m === ignore) continue;
    const t = rayCyl(o, d, m);
    if (t != null && t <= maxT && (!best || t < best.t)) best = { t, mech: m };
  }
  for (const e of G.entities || []) {
    if (!e.alive || e.kind === 'nav') continue;
    const t = rayEnt(o, d, e);
    if (t != null && t <= maxT && (!best || t < best.t)) best = { t, mech: null, ent: e };
  }
  const tt = rayTerrain(G, o, d, best ? best.t : maxT);
  if (tt != null) best = { t: tt, mech: null, ent: null };
  if (best) best.point = add(o, mul(d, best.t));
  return best;
}
