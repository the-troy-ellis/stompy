import { M, add, chain, mul, sub, len } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { sceneryAlong } from './entities.js';
import { mechsAlong, nearRadius } from './near.js';

const { sqrt } = Math;

export const frame = m => chain(M.T(m.x, m.y + (m.bob || 0), m.z), M.RY(m.yaw), M.S(m.ch.scale));
export const torsoFrame = m => chain(frame(m), M.T(0, geoOf(m).torsoY + (m.torsoDrop || 0), 0), M.RY(m.twist));   // torsoDrop: the pendulum body's lag (sim/gait.js)
// torsoFrame without the garbage (spec 34 part 4): the same Float32 steps in
// the same order, into scratch matrices, so the numbers are the same to the
// bit. Good until the next call: read it at once (muzzle, eyeOf).
const F16 = () => new Float32Array(16), W = [F16(), F16(), F16(), F16(), F16(), F16(), F16(), F16(), F16()];
function mulInto(o, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
const idInto = o => { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; };
const tInto = (o, x, y, z) => { idInto(o); o[12] = x; o[13] = y; o[14] = z; return o; };
const ryInto = (o, a) => { const c = Math.cos(a), s = Math.sin(a); idInto(o); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; };
const sInto = (o, k) => { idInto(o); o[0] = o[5] = o[10] = k; return o; };
function torsoNow(m) {
  const [t1, r1, s1, t2, r2, a, b, c, d] = W;
  mulInto(a, tInto(t1, m.x, m.y + (m.bob || 0), m.z), ryInto(r1, m.yaw));
  mulInto(b, a, sInto(s1, m.ch.scale));
  mulInto(c, b, tInto(t2, 0, geoOf(m).torsoY + (m.torsoDrop || 0), 0));
  return mulInto(d, c, ryInto(r2, m.twist));
}
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
  const tf = torsoNow(m), g = geoOf(m);
  if (w.mount === 'T') return M.apply(tf, w.def.kind === 'missile' ? [w.side % 2 ? -1.25 : 1.25, g.rackY, 0.6] : [-0.9, g.acY, 1.6]);
  return M.apply(tf, [(w.mount === 'LA' ? 1 : -1) * g.armX, g.armY - 1.2, 2.4]);
}
export const eyeOf = m => M.apply(torsoNow(m), geoOf(m).eye);
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
// Where a ray first meets the ground (world/voxels.js ray: the density
// marched in 4 m steps, then bisected), or null. Overhangs, arches and tunnel
// roofs stop it as the top surface does.
export function rayTerrain(G, o, d, maxT) {
  if (!(maxT > 0) || !Number.isFinite(o[0] + o[1] + o[2] + d[0] + d[1] + d[2])) return null;   // a NaN here would march forever
  return G.ter.ray(o, d, maxT);
}
// Structures and vehicles are cylinders too (entities.js); a nav point has no body.
export function rayEnt(o, d, e) { return rayUpright(o, d, e.x, e.y, e.z, e.radius, e.height); }
const NEAR = [], BY = [];
export function rayHit(G, o, d, maxT, ignore) {
  let bt = Infinity, bm = null, be = null;
  const k = mechsAlong(G, o[0], o[2], o[0] + d[0] * maxT, o[2] + d[2] * maxT, nearRadius(G), BY);   // spec 34: only the mechs along it
  for (let j = 0; j < k; j++) {
    const m = BY[j];
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
