import { M, add, chain, mul, sub, len } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { sceneryAlong } from './entities.js';

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
  if (m.cyl) return rayUpright(o, d, m.x, m.y, m.z, m.cyl[0], m.cyl[1]);
  const g = geoOf(m);
  return rayUpright(o, d, m.x, m.y, m.z, g.radius * m.ch.scale, g.height * m.ch.scale);
}
// A ray against an upright cylinder standing at (x, y, z): the nearest t >= 0
// on its side that's within its height, or null. Plain numbers, no garbage:
// every shot and sight line tests every mech and prop.
function rayUpright(o, d, x, y, z, R, H) {
  const ox = o[0] - x, oz = o[2] - z, a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-8) return null;
  const b = 2 * (ox * d[0] + oz * d[2]), c = ox * ox + oz * oz - R * R, disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = sqrt(disc), t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
  if (t0 >= 0) { const h = o[1] + d[1] * t0; if (h >= y && h <= y + H) return t0; }
  if (t1 >= 0) { const h = o[1] + d[1] * t1; if (h >= y && h <= y + H) return t1; }
  return null;
}
// Terrain is ray-marched in 4 m steps, then bisected.
export function rayTerrain(G, o, d, maxT) {
  if (!(maxT > 0) || !Number.isFinite(o[0] + o[1] + o[2] + d[0] + d[1] + d[2])) return null;   // a NaN here would march forever
  const ter = G.ter, step = 4;
  let prev = 0;
  const below = t => o[1] + d[1] * t < ter.height(o[0] + d[0] * t, o[2] + d[2] * t);   // plain numbers: no arrays per step
  for (let t = min(step, maxT); ; t = min(t + step, maxT)) {
    if (below(t)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid; else lo = mid;
      }
      return hi;
    }
    if (t >= maxT) return null;
    prev = t;
  }
}
// Structures and vehicles are cylinders too (entities.js); a nav point has no body.
export function rayEnt(o, d, e) { return rayUpright(o, d, e.x, e.y, e.z, e.radius, e.height); }
const NEAR = [];
export function rayHit(G, o, d, maxT, ignore) {
  let bt = Infinity, bm = null, be = null;
  for (const m of G.mechs) {
    if (!m.alive || m === ignore) continue;
    const t = rayCyl(o, d, m);
    if (t != null && t <= maxT && t < bt) { bt = t; bm = m; be = null; }
  }
  // The entities, then the map's scenery in the grid cells the ray crosses
  // (entities.js), both indexed: see pushOutOfEntities.
  const E = G.entities || [];
  for (let i = 0; i < E.length; i++) {
    const e = E[i];
    if (!e.alive || e.kind === 'nav' || e === ignore) continue;   // a turret's own volley leaves through it
    const t = rayEnt(o, d, e);
    if (t != null && t <= maxT && t < bt) { bt = t; bm = null; be = e; }
  }
  const n = sceneryAlong(G, o[0], o[2], o[0] + d[0] * maxT, o[2] + d[2] * maxT, NEAR);
  for (let i = 0; i < n; i++) {
    const t = rayEnt(o, d, NEAR[i]);
    if (t != null && t <= maxT && t < bt) { bt = t; bm = null; be = NEAR[i]; }
  }
  let best = bt < Infinity ? { t: bt, mech: bm, ent: be } : null;
  const tt = rayTerrain(G, o, d, best ? best.t : maxT);
  if (tt != null) best = { t: tt, mech: null, ent: null };
  if (best) best.point = add(o, mul(d, best.t));
  return best;
}
