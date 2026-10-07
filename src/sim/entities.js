import { norm, sub, wrapA, clampN } from '../util/math.js';
import { explode, particle } from './effects.js';
import { feel } from './feel.js';
import { flatZones } from './placement.js';
import { missionAvoid, scatterProps } from '../world/props.js';
import { entQueue } from './hitqueue.js';

const { hypot, atan2, sin, cos, min, PI } = Math;

// World entities (docs/specs/03-objectives.md § Entities): structures,
// vehicles, turrets and nav points, in G.entities. Each is
// { kind, id, tags, team, x, y, z, yaw, hp, max, radius, height, mesh, col, alive }
// plus, for a vehicle, a waypoint `path` [[x, z], ...] and a `speed`; for a
// turret, a `weapon` (turrets.js; a turret is a structure that shoots).
// Structures and vehicles are vertical cylinders for hits and footprints,
// like mechs; a nav point has no body, only a `trigger` radius.
// `hp: Infinity` makes a decorative structure (it sparks, never falls).
export const BLOCK_AHEAD = 15;   // m: a vehicle stops for a mech or vehicle this close in front
export const FALL_TIME = 1.2;    // s: a punched-down structure's topple

// `ch` is a stand-in so the HUD's target box and center() work on a structure
// the same way they do on a mech: a name and a scale that puts the centre at
// half height.
export function addEntity(G, spec) {
  const e = makeEntity(G, spec);
  G.entities.push(e);
  return e;
}
function makeEntity(G, spec) {
  const kind = spec.kind || 'structure', height = spec.height ?? (kind === 'vehicle' ? 3 : kind === 'nav' ? 0 : kind === 'turret' ? 6 : 10);
  const e = {
    kind, id: spec.id || `${kind}${G.entities.length}`, tags: spec.tags || [], team: spec.team ?? (kind === 'vehicle' ? 0 : 1),
    x: spec.x, z: spec.z, y: G.ter.height(spec.x, spec.z), yaw: spec.yaw || 0,
    hp: spec.hp ?? (kind === 'nav' ? Infinity : 40), radius: spec.radius ?? (kind === 'vehicle' ? 2.2 : 3), height,
    mesh: spec.mesh || (kind === 'turret' ? 'launcher' : null), col: spec.col || [0.5, 0.5, 0.48], alive: true, speed: 0,
    weapon: spec.weapon || null, path: spec.path || null, wp: 0, cruise: spec.speed || 0, trigger: spec.trigger ?? 40,
    ch: { scale: Math.max(0.3, height / 8.2), name: spec.label || (kind === 'vehicle' ? 'TRUCK' : kind === 'turret' ? 'LAUNCHER' : 'STRUCTURE') },
  };
  e.max = e.hp;
  e.targetable = kind !== 'nav' && e.team !== 0 && Number.isFinite(e.hp);
  return e;
}

// The map's scenery (world/props.js): indestructible structures with a mesh
// each, kept apart from G.entities in G.scenery, with a grid of SCENERY_CELL
// metre cells that lists each prop in every cell its footprint touches. They
// never move, and there are about a hundred, so the per-frame questions
// (pushing a mech out, a punch, a shot) look only in the cells concerned:
// walking the whole list from code that runs a few times a frame made
// garbage. Placed after the mission's own entities so it keeps clear of them;
// `props: false` in a mission leaves the map bare, as does a flat test map.
export const SCENERY_CELL = 64;
const cellOf = v => Math.floor(v / SCENERY_CELL), key = (i, j) => i * 4096 + j;
export function placeScenery(G, def, start = { x: 0, z: 0 }) {
  G.scenery = []; G.sceneryGrid = new Map();
  if (def.props === false || G.ter.flat) return;
  for (const p of scatterProps(G.ter.seed, G.biome, G.ter, missionAvoid(start, flatZones(def), G.entities))) {
    const e = makeEntity(G, { ...p, kind: 'structure', hp: Infinity });
    G.scenery.push(e);
    for (let i = cellOf(e.x - e.radius); i <= cellOf(e.x + e.radius); i++) for (let j = cellOf(e.z - e.radius); j <= cellOf(e.z + e.radius); j++) {
      const cell = G.sceneryGrid.get(key(i, j));
      if (cell) cell.push(e); else G.sceneryGrid.set(key(i, j), [e]);
    }
  }
}
// The scenery whose cells lie within r of (x, z), into `out`; returns how
// many (a prop may come twice, and a little further: callers test exactly).
export function sceneryNear(G, x, z, r, out) {
  const grid = G.sceneryGrid;
  let n = 0;
  if (!grid || !grid.size) return 0;
  const i0 = cellOf(x - r), i1 = cellOf(x + r), j0 = cellOf(z - r), j1 = cellOf(z + r);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const cell = grid.get(key(i, j));
    if (cell) for (let k = 0; k < cell.length; k++) out[n++] = cell[k];
  }
  return n;
}
// The scenery in the cells a segment (x0, z0) to (x1, z1) crosses, the same
// way: cell by cell along it (a 2D DDA).
export function sceneryAlong(G, x0, z0, x1, z1, out) {
  const grid = G.sceneryGrid, C = SCENERY_CELL;
  let n = 0;
  if (!grid || !grid.size) return 0;
  let i = cellOf(x0), j = cellOf(z0);
  const i1 = cellOf(x1), j1 = cellOf(z1), dx = x1 - x0, dz = z1 - z0, si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz), tdx = adx > 1e-9 ? C / adx : Infinity, tdz = adz > 1e-9 ? C / adz : Infinity;
  let tx = adx > 1e-9 ? (si > 0 ? (i + 1) * C - x0 : x0 - i * C) / adx : Infinity, tz = adz > 1e-9 ? (sj > 0 ? (j + 1) * C - z0 : z0 - j * C) / adz : Infinity;
  for (let steps = Math.abs(i1 - i) + Math.abs(j1 - j); steps >= 0; steps--) {
    const cell = grid.get(key(i, j));
    if (cell) for (let k = 0; k < cell.length; k++) out[n++] = cell[k];
    if (tx < tz) { tx += tdx; i += si; } else { tz += tdz; j += sj; }
  }
  return n;
}

export const solid = e => e.alive && e.kind !== 'nav';

// Vehicles drive their waypoints at their speed; a vehicle stops while a mech
// (or another vehicle) stands within BLOCK_AHEAD in front of it, and resumes
// when the way is clear. A toppling structure finishes its fall.
export function stepEntities(G, dt) {
  for (let i = 0; i < G.entities.length; i++) {
    const e = G.entities[i];
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
  for (let i = 0; i < G.entities.length; i++) { const o = G.entities[i]; if (o !== e && o.kind === 'vehicle' && solid(o) && near(o.x, o.z, o.radius)) return true; }
  return false;
}

// Damage to an entity: one pool of hp. `how.punch` with `how.yaw` topples a
// structure toward the puncher's facing when it goes down.
export function damageEntity(G, e, amt, src, p, how = {}) {
  if (!solid(e) || !(amt > 0)) return;
  const r = G.rng;
  for (let i = 0; i < 3; i++) particle(G, p || [e.x, e.y + e.height / 2, e.z], [r.range(-4, 4), r.range(1, 6), r.range(-4, 4)], 0.3, 0.3, [1, 0.8, 0.4], 'fire');
  if (!Number.isFinite(e.hp)) return;   // decorative: it sparks, nothing more
  if (G.role === 'guest') {
    // Co-op: the host owns the mission's entities; it applies this and says so (docs/specs/09-coop.md).
    const q = entQueue(G, e, p || [e.x, e.y + e.height / 2, e.z]);
    q.amt += amt; q.p = p || q.p;
    if (how.punch) { q.me = 1; q.yaw = how.yaw; }
    if (src === G.player) { G.stats.dealt += amt; G.hitMark = 0.25; }
    return;
  }
  e.hp -= amt;
  e.lastHitBy = src; e.lastHitAt = G.time;
  if (src === G.player) { G.stats.dealt += amt; G.hitMark = 0.25; }
  if (e.hp <= 0) destroyEntity(G, e, src, how);
}

export function destroyEntity(G, e, src, how = {}) {
  if (!e.alive) return;
  e.alive = false; e.hp = 0; e.wreck = true; e.killedBy = src || null; e.downAt = G.time;
  if (how.punch && e.kind !== 'vehicle') e.fall = { yaw: how.yaw ?? e.yaw, t: 0 };   // over it goes, away from the fist
  if (G.role === 'host') G.fx.netSend(how.punch ? { t: 'entx', id: e.id, punch: 1, yaw: Math.round((how.yaw ?? e.yaw) * 100) / 100 } : { t: 'entx', id: e.id });   // co-op: down on every screen at once
  const big = e.height >= 6, top = [e.x, e.y + e.height * 0.6, e.z];
  explode(G, top, big);
  G.fx.sfx.boom(top, big);
  feel(G, 'blast', { mech: null, k: Math.max(0, 1 - hypot(G.player.x - e.x, G.player.z - e.z) / 120) * (big ? 0.8 : 0.4), at: top });
  if (G.target === e) G.target = null;
}

// Nothing walks through a structure or a vehicle: mechs this client owns are
// pushed out of their footprints (unless they are clear above them).
// Indexed loops and a squared-distance reject: with a map's scenery this runs
// for about a hundred props a frame, not often enough for V8 to optimize, and
// an unoptimized for-of or hypot makes garbage.
export function pushOutOfEntities(G, radiusOf) {
  const E = G.entities, ms = G.mechs;
  for (let i = 0; i < E.length; i++) {
    const e = E[i];
    if (!solid(e)) continue;
    for (let j = 0; j < ms.length; j++) {
      const m = ms[j];
      if (!m.alive || m.remote || m.y > e.y + e.height - 0.5) continue;
      const dx = m.x - e.x, dz = m.z - e.z, r = e.radius + radiusOf(m);
      if (dx * dx + dz * dz >= r * r) continue;
      pushOff(m, e, r, dx, dz);
    }
  }
  for (let j = 0; j < ms.length; j++) {
    const m = ms[j];
    if (!m.alive || m.remote) continue;
    const rm = radiusOf(m), n = sceneryNear(G, m.x, m.z, rm, NEAR);
    for (let k = 0; k < n; k++) {
      const e = NEAR[k], dx = m.x - e.x, dz = m.z - e.z, r = e.radius + rm;
      if (m.y > e.y + e.height - 0.5 || dx * dx + dz * dz >= r * r) continue;
      pushOff(m, e, r, dx, dz);
    }
  }
}
const NEAR = [];
function pushOff(m, e, r, dx, dz) {
  const d = Math.sqrt(dx * dx + dz * dz), nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
  m.x = e.x + nx * r; m.z = e.z + nz * r;
}

// A toppling or fallen structure's rotation: about the base, toward fall.yaw.
export function fallAngle(e) {
  if (!e.fall) return 0;
  const u = e.fall.t / FALL_TIME;
  return (PI / 2) * u * u;   // accelerates into the ground
}
export const entityCenter = e => [e.x, e.y + e.height / 2, e.z];
export const towards = (from, e) => norm(sub(entityCenter(e), from));
