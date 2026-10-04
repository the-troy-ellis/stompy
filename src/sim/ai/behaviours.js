import { clampN, norm, sub, len, wrapA } from '../../util/math.js';
import { BOUND } from '../../world/terrain.js';
import { geoOf } from '../../data/geo.js';
import { center, rayTerrain } from '../geom.js';
import { BEHAVIOUR as B } from '../../data/ai.js';

const { sin, cos, atan2, abs, hypot, min, PI } = Math;

// The movement behaviour library (docs/specs/05-ai.md § Movement). A driver
// is `(G, e, ctx, dt) -> { moveYaw, thr, jets } | null`: null means no
// opinion and the next driver in the plan speaks. A shaper is
// `(G, e, ctx, out) -> out` and adjusts whatever the drivers decided. A plan
// is { drive: [...], shape: [...] }; #19 gives each chassis its own.
//
// ctx: { P, tx, tz, dist, toYaw, seen } from think(): the target's believed
// position and the bearing and distance to it.

const eyeAt = (G, e, x, z) => [x, G.ter.height(x, z) + geoOf(e).eye[1] + geoOf(e).torsoY * e.ch.scale, z];
const blocked = (G, from, to) => { const d = sub(to, from), L = len(d); return rayTerrain(G, from, norm(d), L) != null; };
const towards = (e, x, z) => atan2(x - e.x, z - e.z);
const inMap = v => clampN(v, -BOUND + 40, BOUND - 40);

// Strafe side and its timer, shared by everything that orbits.
export function strafeTick(G, e, dt) {
  e.ai.strafeT -= dt;
  if (e.ai.strafeT <= 0) { e.ai.strafe *= -1; e.ai.strafeT = G.rng.range(3, 7); }
  return e.ai.strafe;
}

// Today's dance: approach above the band, back off below it, orbit inside it.
export const keepRange = (pref, band = [0.6, 1.35]) => (G, e, ctx) => {
  const s = e.ai.strafe, { dist, toYaw } = ctx;
  if (dist > pref * band[1]) return { moveYaw: toYaw + (e.ai.group?.flank ? s * PI / 2 : s * 0.35), thr: 1 };   // the group's lightest comes round the side
  if (dist < pref * band[0]) return { moveYaw: toYaw + PI - s * 0.6, thr: 1 };
  return { moveYaw: toYaw + s * PI / 2, thr: 0.75 };
};

// Light mechs: orbit close, flip the strafe when hit, and when the player is
// near enough, jump straight over them and land behind. With `stomp` the
// jump becomes a dive: over the target it cuts the jets and drops on it.
export const harass = (G, e, ctx, dt, { stomp = false } = {}) => {
  const a = e.ai, { dist, toYaw, seen } = ctx;
  if (a.hitAt != null && a.hitAt !== a.flippedAt) { a.flippedAt = a.hitAt; a.strafe *= -1; a.strafeT = G.rng.range(3, 7); }
  if (a.jump) {
    if (stomp && e.air && dist < B.stompOver) { a.jump.until = 0; return { moveYaw: toYaw, thr: 0, jets: false }; }   // right on top: drop
    if (G.time < a.jump.until) return { moveYaw: stomp ? toYaw : a.jump.yaw, thr: 1, jets: true };
    if (e.air) return { moveYaw: a.jump.yaw, thr: 1, jets: false };   // carry through the landing
    a.jump = null; a.jumpCd = G.time + B.jumpCooldown;
  }
  if (seen && dist < B.jumpWithin && !e.air && e.fuel > 0.5 && !(a.jumpCd > G.time) && !e.melee) {
    a.jump = { until: G.time + B.jumpFor, yaw: toYaw };
    return { moveYaw: toYaw, thr: 1, jets: true };
  }
  void dt;
  return keepRange((B.harassBand[0] + B.harassBand[1]) / 2, [B.harassBand[0] / ((B.harassBand[0] + B.harassBand[1]) / 2), B.harassBand[1] / ((B.harassBand[0] + B.harassBand[1]) / 2)])(G, e, ctx);
};

export const harassStomp = (G, e, ctx, dt) => harass(G, e, ctx, dt, { stomp: true });

// Hot or hurt: find the nearest spot nearby from which the target cannot be
// seen, walk there and wait until cool. Sample 8 bearings x 3 distances.
export function findCover(G, e, target) {
  const tc = center(target);
  let best = null;
  for (const d of B.coverDists) for (let k = 0; k < 8; k++) {
    const a = k * PI / 4, x = inMap(e.x + sin(a) * d), z = inMap(e.z + cos(a) * d);
    if (!blocked(G, eyeAt(G, e, x, z), tc)) continue;
    if (!best || d < best.d) best = { x, z, d };
    if (best && best.d === B.coverDists[0]) return best;
  }
  return best;
}
// `hurt: false` makes a profile that only hides from its own heat (the JACKAL);
// `torso` sets how hurt is hurt (PIPSQUEAK breaks off at half).
export const cover = ({ hurt: byTorso = true, torso = B.coverTorso } = {}) => (G, e, ctx) => {
  const a = e.ai, hot = e.heat > B.coverHeat, hurt = byTorso && e.hp.T < e.max.T * torso;
  if (!a.cover) {
    if (!(hot || (hurt && !(a.coverCd > G.time)))) return null;
    if (a.coverLookT > G.time) return null;
    a.coverLookT = G.time + B.coverEvery;
    const c = findCover(G, e, ctx.P);
    if (!c) return null;
    a.cover = { x: c.x, z: c.z, since: G.time };
  }
  if (e.heat < B.coverLeave && (!hurt || G.time - a.cover.since > B.coverMaxWait)) { a.cover = null; a.coverCd = G.time + B.coverRetry; return null; }
  const d = hypot(a.cover.x - e.x, a.cover.z - e.z);
  a.lastSeen = G.time;   // hiding on purpose is not losing contact
  if (d < B.coverArrive) return { moveYaw: e.yaw, thr: 0 };
  return { moveYaw: towards(e, a.cover.x, a.cover.z), thr: 1 };
};
export const useCover = cover();
export const coverWhenHot = cover({ hurt: false });

// Snipers: a spot well above the target with line of sight, re-sampled on a
// slow timer from a ring around the target. No opinion once it is there.
export function findRidge(G, e, target) {
  const tc = center(target), base = G.ter.height(target.x, target.z);
  let best = null;
  for (const r of B.ridgeRadii) for (let k = 0; k < 16; k++) {
    const a = k * PI / 8, x = inMap(target.x + sin(a) * r), z = inMap(target.z + cos(a) * r);
    const h = G.ter.height(x, z);
    if (h < base + B.ridgeAbove) continue;
    if (blocked(G, eyeAt(G, e, x, z), tc)) continue;
    const d = hypot(x - e.x, z - e.z);
    if (!best || d < best.d) best = { x, z, d };
  }
  return best;
}
export const ridge = (G, e, ctx) => {
  const a = e.ai;
  if (!(a.ridgeLookT > G.time)) {
    a.ridgeLookT = G.time + B.ridgeEvery;
    const r = findRidge(G, e, ctx.P);
    a.ridge = r ? { x: r.x, z: r.z } : null;
  }
  if (!a.ridge) return null;
  const d = hypot(a.ridge.x - e.x, a.ridge.z - e.z);
  if (d < B.ridgeArrive) return null;
  return { moveYaw: towards(e, a.ridge.x, a.ridge.z), thr: 1 };
};

// Close along the shortest line and stay in reach; the punch decision in
// think() does the rest. Never retreats.
export const brawler = (G, e, ctx) => ({ moveYaw: ctx.toYaw, thr: ctx.dist > ctx.reachE * 0.8 ? 1 : 0 });

// --- shapers ---------------------------------------------------------------

// Heavies advance together: no faster than the slowest ally within 150 m.
export const holdLine = (G, e, ctx, out) => {
  const top = m => m.maxSpeed ?? m.ch.speed;
  let slowest = top(e);
  for (const o of G.mechs) {
    if (o === e || o.team !== e.team || !o.alive) continue;
    if (hypot(o.x - e.x, o.z - e.z) <= B.lineRange) slowest = min(slowest, top(o));
  }
  return slowest < top(e) ? { ...out, thr: min(out.thr, slowest / top(e)) } : out;
};

// Turn for home well before the fence.
export const avoidEdge = (G, e, ctx, out) => (abs(e.x) > BOUND - 60 || abs(e.z) > BOUND - 60 ? { ...out, moveYaw: atan2(-e.x, -e.z) } : out);

// Steer around an ally that is close and ahead; the collision pass only
// separates once they touch.
export const avoidAllies = (G, e, ctx, out) => {
  const re = geoOf(e).radius * e.ch.scale;
  for (const o of G.mechs) {
    if (o === e || o.team !== e.team || !o.alive) continue;
    const dx = o.x - e.x, dz = o.z - e.z, d = hypot(dx, dz), gap = re + geoOf(o).radius * o.ch.scale + B.allyGap;
    if (d > gap) continue;
    const rel = wrapA(atan2(dx, dz) - out.moveYaw);
    if (abs(rel) > PI / 2) continue;   // behind: not in the way
    return { ...out, moveYaw: out.moveYaw - Math.sign(rel || 1) * 0.7 * (1 - d / gap) - Math.sign(rel || 1) * 0.3 };
  }
  return out;
};

// Run a plan: the first driver with an opinion, then every shaper.
export function steer(G, e, ctx, dt, plan) {
  let out = null;
  for (const d of plan.drive) { out = d(G, e, ctx, dt); if (out) break; }
  if (!out) out = { moveYaw: ctx.toYaw, thr: 1 };
  if (out.jets == null) out.jets = false;
  for (const s of plan.shape) out = s(G, e, ctx, out);
  return out;
}

// The baseline: today's dance, cover when hot or hurt, and the two steering
// shapers. Profiles (ai/profiles.js) compose the rest.
export const defaultPlan = e => ({ drive: [useCover, keepRange(e.ch.pref)], shape: [avoidAllies, avoidEdge] });
