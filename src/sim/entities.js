import { norm, sub, wrapA, clampN } from '../util/math.js';
import { explode, particle } from './effects.js';
import { feel } from './feel.js';

const { hypot, atan2, sin, cos, min, PI } = Math;

// World entities (docs/specs/03-objectives.md § Entities): structures,
// vehicles and nav points, in G.entities. Each is
// { kind, id, tags, team, x, y, z, yaw, hp, max, radius, height, mesh, col, alive }
// plus, for a vehicle, a waypoint `path` [[x, z], ...] and a `speed`.
// Structures and vehicles are vertical cylinders for hits and footprints,
// like mechs; a nav point has no body, only a `trigger` radius.
// `hp: Infinity` makes a decorative structure (it sparks, never falls).
export const BLOCK_AHEAD = 15;   // m: a vehicle stops for a mech or vehicle this close in front
export const FALL_TIME = 1.2;    // s: a punched-down structure's topple

// `ch` is a stand-in so the HUD's target box and center() work on a structure
// the same way they do on a mech: a name and a scale that puts the centre at
// half height.
export function addEntity(G, spec) {
  const kind = spec.kind || 'structure', height = spec.height ?? (kind === 'vehicle' ? 3 : kind === 'nav' ? 0 : 10);
  const e = {
    kind, id: spec.id || `${kind}${G.entities.length}`, tags: spec.tags || [], team: spec.team ?? (kind === 'vehicle' ? 0 : 1),
    x: spec.x, z: spec.z, y: G.ter.height(spec.x, spec.z), yaw: spec.yaw || 0,
    hp: spec.hp ?? (kind === 'nav' ? Infinity : 40), radius: spec.radius ?? (kind === 'vehicle' ? 2.2 : 3), height,
    mesh: spec.mesh || null, col: spec.col || [0.5, 0.5, 0.48], alive: true, speed: 0,
    path: spec.path || null, wp: 0, cruise: spec.speed || 0, trigger: spec.trigger ?? 40,
    ch: { scale: Math.max(0.3, height / 8.2), name: spec.label || (kind === 'vehicle' ? 'TRUCK' : 'STRUCTURE') },
  };
  e.max = e.hp;
  e.targetable = kind !== 'nav' && e.team !== 0 && Number.isFinite(e.hp);
  G.entities.push(e);
  return e;
}

export const solid = e => e.alive && e.kind !== 'nav';

// Vehicles drive their waypoints at their speed; a vehicle stops while a mech
// (or another vehicle) stands within BLOCK_AHEAD in front of it, and resumes
// when the way is clear. A toppling structure finishes its fall.
export function stepEntities(G, dt) {
  for (const e of G.entities) {
    if (e.fall && e.fall.t < FALL_TIME) e.fall.t = min(FALL_TIME, e.fall.t + dt);
    if (e.kind !== 'vehicle' || !e.alive || !e.path) continue;
    if (e.wp >= e.path.length) { e.speed = 0; e.arrived = true; continue; }
    const [tx, tz] = e.path[e.wp], dx = tx - e.x, dz = tz - e.z, d = hypot(dx, dz);
    if (d < 3) { e.wp++; continue; }
    const want = atan2(dx, dz);
    e.yaw += clampN(wrapA(want - e.yaw), -1.5 * dt, 1.5 * dt);
    const fx = sin(e.yaw), fz = cos(e.yaw);
    e.blocked = ahead(G, e, fx, fz);
    e.speed = e.blocked ? 0 : e.cruise;
    const step = min(d, e.speed * dt);
    e.x += fx * step; e.z += fz * step;
    e.y = G.ter.height(e.x, e.z);
  }
}
function ahead(G, e, fx, fz) {
  const near = (x, z, r) => { const ox = x - e.x, oz = z - e.z, along = ox * fx + oz * fz, side = Math.abs(ox * fz - oz * fx); return along > 0 && along < BLOCK_AHEAD + r && side < e.radius + r; };
  for (const m of G.mechs) if (m.alive && near(m.x, m.z, 2)) return true;
  for (const o of G.entities) if (o !== e && solid(o) && o.kind === 'vehicle' && near(o.x, o.z, o.radius)) return true;
  return false;
}

// Damage to an entity: one pool of hp. `how.punch` with `how.yaw` topples a
// structure toward the puncher's facing when it goes down.
export function damageEntity(G, e, amt, src, p, how = {}) {
  if (!solid(e) || !(amt > 0)) return;
  const r = G.rng;
  for (let i = 0; i < 3; i++) particle(G, p || [e.x, e.y + e.height / 2, e.z], [r.range(-4, 4), r.range(1, 6), r.range(-4, 4)], 0.3, 0.3, [1, 0.8, 0.4], 'fire');
  if (!Number.isFinite(e.hp)) return;   // decorative: it sparks, nothing more
  e.hp -= amt;
  e.lastHitBy = src; e.lastHitAt = G.time;
  if (src === G.player) { G.stats.dealt += amt; G.hitMark = 0.25; }
  if (e.hp <= 0) destroyEntity(G, e, src, how);
}

export function destroyEntity(G, e, src, how = {}) {
  if (!e.alive) return;
  e.alive = false; e.hp = 0; e.wreck = true; e.killedBy = src || null; e.downAt = G.time;
  if (how.punch && e.kind !== 'vehicle') e.fall = { yaw: how.yaw ?? e.yaw, t: 0 };   // over it goes, away from the fist
  const big = e.height >= 6, top = [e.x, e.y + e.height * 0.6, e.z];
  explode(G, top, big);
  G.fx.sfx.boom(top, big);
  feel(G, 'blast', { mech: null, k: Math.max(0, 1 - hypot(G.player.x - e.x, G.player.z - e.z) / 120) * (big ? 0.8 : 0.4), at: top });
  if (G.target === e) G.target = null;
}

// Nothing walks through a structure or a vehicle: mechs this client owns are
// pushed out of their footprints (unless they are clear above them).
export function pushOutOfEntities(G, radiusOf) {
  for (const e of G.entities) {
    if (!solid(e)) continue;
    for (const m of G.mechs) {
      if (!m.alive || m.remote || m.y > e.y + e.height - 0.5) continue;
      const dx = m.x - e.x, dz = m.z - e.z, d = hypot(dx, dz), r = e.radius + radiusOf(m);
      if (d >= r) continue;
      const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
      m.x = e.x + nx * r; m.z = e.z + nz * r;
    }
  }
}

// A toppling or fallen structure's rotation: about the base, toward fall.yaw.
export function fallAngle(e) {
  if (!e.fall) return 0;
  const u = e.fall.t / FALL_TIME;
  return (PI / 2) * u * u;   // accelerates into the ground
}
export const entityCenter = e => [e.x, e.y + e.height / 2, e.z];
export const towards = (from, e) => norm(sub(entityCenter(e), from));
