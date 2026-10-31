import { wrapA, clampN } from '../util/math.js';
import { crewOf } from './crew.js';
import { MINER, haul, halt, walkTo, build } from './miner.js';
import { think } from './ai.js';
import { alertEnemy } from './ai/perception.js';

const { atan2, hypot, sin, cos, abs } = Math;

// Orders from the command view (docs/specs/22-command-view.md § Giving
// orders): plain data on a crew mech, `m.order = { kind, x, y, z, yaw,
// target }`, which a parked one carries out (`obey`, from update.js) before
// its own job. The view gives them through `give`, and so can a test. The
// mech you drive ignores its order; leave it and the order holds again.
//
//   go      walk to (x, z) and stay there
//   stay    stand where it is
//   dig     a digger: walk to a stand point short of the spot, face it, and
//           take it as its site (spec 21); its own `mine` goes on from there
//   follow  a hauler: wait behind `target`, that digger, and take its loads
//   build   a builder: build `target`, a construction site's part, until it's
//           up (docs/specs/23-construction-sites.md, 31-builder.md)
//   attack  a fighter: fight `target`, a foe, with the foes' own brain
//           (ai.js think), until it's dead; then stay
//   guard   a fighter: stay by `target`, one of your buildings, and fight any
//           foe that comes within ORDER.guard of it, never chasing it past
//           ORDER.leash
//   work    (given, never kept) back to its own job
export const ORDER = {
  arrive: 4,      // m: this near a GO point, it stays
  standOff: 9,    // m: a digger told to DIG stands this far short of the spot (by its scale)
  guard: 160,     // m: GUARD fights a foe this near the building
  leash: 260,     // m: and lets it go past this far from the building
  post: 18,       // m: off the building's side, where a guard waits
};
export const ORDERS = ['go', 'dig', 'follow', 'build', 'attack', 'guard', 'stay', 'work'];
export const SAY = { go: 'Going.', dig: 'Digging.', follow: 'Following.', build: 'Building.', attack: 'Attacking.', guard: 'Guarding.', stay: 'Staying.', work: 'Back to work.' };

// Who can take an order: anyone GO and STAY; DIG a digger; BUILD a builder;
// FOLLOW a hauler; WORK whoever has a job of its own; ATTACK and GUARD a
// fighter (no hopper and no tool: a mech with guns or fists).
export function can(m, kind) {
  if (kind === 'attack' || kind === 'guard') return !m.ch.hopper && !m.ch.tool;
  if (kind === 'dig') return m.ch.tool === 'dig';
  if (kind === 'build') return m.ch.tool === 'build';   // builders build (docs/specs/31-builder.md)
  if (kind === 'follow') return !!m.ch.hopper && !m.ch.tool;
  if (kind === 'work') return !!m.ch.hopper || !!m.ch.tool;
  return kind === 'go' || kind === 'stay';
}

// `order`: { kind, x, z } for GO and DIG (the ground point), { kind, target }
// for FOLLOW (a digger) and BUILD (a site's part), { kind } for STAY and WORK. Each live crew mech in `mechs`
// that can take it does; the voice answers once. The number that took it.
export function give(G, mechs, order) {
  const { kind } = order, crew = crewOf(G);
  if (kind === 'follow' && !(order.target?.alive && order.target.ch.tool && crew.includes(order.target))) return 0;
  if (kind === 'build' && !(order.target?.alive && order.target.site)) return 0;
  if (kind === 'attack' && !(order.target?.alive && order.target.team !== 0 && G.mechs.includes(order.target))) return 0;
  if (kind === 'guard' && !(order.target?.alive && order.target.team === 0 && order.target.kind === 'structure')) return 0;
  let n = 0;
  for (const m of mechs) {
    if (!m.alive || !crew.includes(m) || !can(m, kind)) continue;
    if (kind === 'work') m.order = null;
    else if (kind === 'stay') m.order = { kind };
    else if (kind === 'follow' || kind === 'build' || kind === 'attack' || kind === 'guard') m.order = { kind, target: order.target };
    else if (kind === 'go') m.order = { kind, x: order.x, y: G.ter.height(order.x, order.z), z: order.z };
    else if (kind === 'dig') {
      const yaw = atan2(order.x - m.x, order.z - m.z), d = standAt(G, m, order.x, order.z, yaw);
      const x = m.x + sin(yaw) * d, z = m.z + cos(yaw) * d;
      m.order = { kind, x, y: G.ter.height(x, z), z, yaw, at: [order.x, order.z] };
    }
    if (m.ai) m.ai.goal = null;   // a fresh trip
    n++;
  }
  if (n) G.fx.say(SAY[kind]);
  return n;
}

// How far toward (x, z) a digger should walk to dig there: up to the face in
// between (where a level line at its bucket's height first meets ground,
// which an overhang's top doesn't), less ORDER.standOff; or, with no face on
// the way, to standOff short of the spot itself.
function standAt(G, m, x, z, yaw) {
  const far = hypot(x - m.x, z - m.z), off = ORDER.standOff * m.ch.scale;
  const t = G.ter.ray([m.x, G.ter.height(m.x, m.z) + 4 * m.ch.scale, m.z], [sin(yaw), 0, cos(yaw)], far + off);
  return Math.max(0, t != null ? t - off * 0.6 : far - off);
}

// One parked crew mech, one frame. True if an order ran it; false if it has
// none (or the order just ended), and its own job should.
export function obey(G, m, dt) {
  const o = m.order;
  if (!o) return false;
  const a = (m.ai ||= {});
  m.jetting = false; m.beamOn = false;
  if (o.kind === 'stay') { m.job = 'STAYING'; halt(m, dt); return true; }
  if (o.kind === 'follow') {
    const t = o.target;
    if (!t.alive || !(t === G.player || t.site)) { m.order = null; return false; }   // gone, or not digging
    haul(G, m, dt, t);
    return true;
  }
  if (o.kind === 'attack') {
    if (!o.target.alive) { m.order = { kind: 'stay' }; return obey(G, m, dt); }   // done: it stays where it is
    m.job = 'ATTACKING';
    fight(G, m, o.target, dt);
    return true;
  }
  if (o.kind === 'guard') {
    const b = o.target;
    if (!b.alive) { m.order = { kind: 'stay' }; return obey(G, m, dt); }   // nothing left to guard
    m.job = 'GUARDING';
    let foe = null, fd = ORDER.guard;
    for (const f of G.mechs) { const d = hypot(f.x - b.x, f.z - b.z); if (f.alive && f.team !== m.team && d < fd) { foe = f; fd = d; } }
    if (!foe && a.prey?.alive && hypot(a.prey.x - b.x, a.prey.z - b.z) < ORDER.leash && hypot(m.x - b.x, m.z - b.z) < ORDER.leash) foe = a.prey;   // one it's on: until the leash
    if (foe) { a.prey = foe; fight(G, m, foe, dt); return true; }
    a.prey = null;
    // Back to its post: off the building's side toward where it is.
    const k = b.radius + ORDER.post, d0 = hypot(m.x - b.x, m.z - b.z) || 1, x = b.x + (m.x - b.x) / d0 * k, z = b.z + (m.z - b.z) / d0 * k;
    if (hypot(x - m.x, z - m.z) > ORDER.arrive * 2) walkTo(G, m, a, x, G.ter.height(x, z), z, dt, () => {});
    else halt(m, dt);
    return true;
  }
  if (o.kind === 'build') {
    if (!o.target.alive || !o.target.site) { m.order = null; return false; }   // up, or gone
    build(G, m, a, o.target, dt);
    return true;
  }
  const d = hypot(o.x - m.x, o.z - m.z);
  if (o.kind === 'go') {
    m.job = 'GOING';
    if (d < ORDER.arrive) { m.order = { kind: 'stay' }; halt(m, dt); return true; }
    walkTo(G, m, a, o.x, o.y, o.z, dt, () => { m.order = { kind: 'stay' }; });
    return true;
  }
  if (o.kind === 'dig') {
    m.job = 'GOING';
    if (d > MINER.arrive) { walkTo(G, m, a, o.x, o.y, o.z, dt, () => { m.order = null; }); return true; }
    // There: is the face in the bucket's reach from here? (Ground under an overhang can hide how far in it is.)
    const t = G.ter.ray([m.x, m.y + 4 * m.ch.scale, m.z], [sin(o.yaw), 0, cos(o.yaw)], 60), off = ORDER.standOff * m.ch.scale;
    if (t != null && t > off && (o.moved = (o.moved || 0) + 1) <= 4) {   // no: on toward it
      o.x = m.x + sin(o.yaw) * (t - off * 0.6); o.z = m.z + cos(o.yaw) * (t - off * 0.6); o.y = G.ter.height(o.x, o.z);
      return true;
    }
    halt(m, dt);
    m.yaw += clampN(wrapA(o.yaw - m.yaw), -m.ch.turn * dt, m.ch.turn * dt);
    if (abs(wrapA(o.yaw - m.yaw)) > MINER.face) return true;
    // Square on: this is its site now, as if it had bitten here; its own job digs it.
    m.site = { x: m.x, y: m.y, z: m.z, yaw: o.yaw, pitch: 0, t: G.time };
    a.aim = a.dry = 0;
    m.order = null;
    return false;
  }
  m.order = null;
  return false;
}

// Fight `foe` with the foes' own brain (ai.js think): it knows where the foe
// is from the order, so it never wanders off looking.
function fight(G, m, foe, dt) {
  const a = m.ai;
  if (!a.aware || a.prey !== foe) { a.prey = foe; alertEnemy(G, m, foe, [foe.x, foe.y, foe.z]); a.belief = { x: foe.x, y: foe.y, z: foe.z, vx: 0, vz: 0, at: G.time }; }
  think(G, m, dt, foe);
}

