import { geoOf } from '../data/geo.js';
import { clampN, wrapA } from '../util/math.js';
import { CONSTRUCT } from '../data/construct.js';
import { siteInReach, siteReach } from './tools.js';
import { TOOL } from '../data/tools.js';
import { routeYaw, feelers, walkable, walkGround, FEEL_M } from './ai/nav.js';
import { padOf, siteWork, nearestSilo, oreRoom, needsRepair, repairCost, isRubble } from './base.js';
import { carryFor, thingAt, pickUp, putDown, pileAt } from './production.js';

const { atan2, hypot, sin, cos, abs, min } = Math;

// A digger you leave keeps digging (docs/specs/21-mining.md § Diggers on
// their own). Every scoop that digs remembers where the digger stood and
// looked (`m.site`, set in sim/tools.js), whoever was driving. Parked, it
// walks back there and holds DIG (`m.toolHold`, docs/specs/25-hold-to-dig.md)
// until the hopper is full, walks the ore to the silo's pad
// (base.js stepBase empties it), and goes back. A digger that has never
// bitten has nowhere to go and stands. With a hauler in the crew that has
// room, a full digger walks to the hauler instead, and a parked hauler waits
// behind a digger at work and takes the tub home when it's full (`haul`,
// docs/specs/21-mining.md § The hauler). Construction sites come first
// (docs/specs/23-construction-sites.md): a digger builds one its bucket can
// work, or brings a full hopper to one that needs ore; a hauler fetches silo
// ore for one (`fetch`). `m.job` says which, for the crew strip: 'DIGGING',
// 'HAULING', 'LOADING', 'BUILDING', 'FETCHING', 'DELIVERING' or null.
export const MINER = {
  arrive: 3,      // m: this near its site it stops and digs
  mouth: 6,       // m: this near its tunnel's mouth, it walks on straight (walkTo)
  rampAfter: 3,   // s with no metre nearer and no way on it can walk, and a digger digs itself a ramp (walkTo, docs/specs/30-dig-up.md)
  rampFor: 30,    // s a digger keeps at it before it gives the trip up (others: stuck)
  rampLook: 8,    // m ahead it must be able to walk to stop digging and go on
  rampPitch: 0.45,   // rad: it looks up all the way, for the steepest ramp (TOOL.dig.ramp's cap holds it walkable)
  face: 0.12,     // rad: this square to the site's heading before it holds DIG
  follow: 4,      // m: when no aim digs, the site moves this far ahead, after the face; or, if the face is in sight further on,
  stand: 8,       // m: to this far short of it (the face a run digs back runs well past the bucket's reach on the 4 m grid, docs/specs/29-ground-4m.md)
  moves: 3,       // moves ahead in a row that dig nothing, and it gives the site up
  level: 0.12,    // rad: it aims this far up, so the aim's own tilt (sim/tools.js) digs level and it tunnels on, not down
  deep: 16,       // m: and never moves ahead onto ground this far under where you left it digging
  stuck: 8,       // s: no metre nearer its goal for this long, and it gives up the trip
  behind: 12,     // m: a hauler waits this far behind a digger at work, inside the handover
};

// When TOOL.dig.dry scoops in a row dig nothing (a miss, or the buckets
// scraping the hole's side), it aims off the site's, in turn: [yaw, pitch] in radians.
const AIMS = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.25]];

export function mine(G, m, dt) {
  const a = (m.ai ||= {});   // the nav's route and the feelers' side live here, as a foe's do
  if (m.site && !m.site.mouth) m.site.mouth = [m.site.x, m.site.y, m.site.z];   // where its dig began: the way in and out of the tunnel it makes
  m.jetting = false; m.beamOn = false;
  // A builder builds (docs/specs/31-builder.md): the nearest site with work its
  // ore pays for; with none, it stands. A digger only digs, and brings a full
  // hopper to a site that needs ore (base.js tipIn takes it).
  if (m.ch.tool === 'build') {
    const e = siteFor(G, m, a, false) || mendFor(G, m, a) || rubbleFor(G, m, a);   // sites first, then mending, then rubble (spec 33)
    if (e) return build(G, m, a, e, dt);
    m.job = null;
    return halt(m, dt);
  }
  const silo = siloFor(G, m), full = (m.ore || 0) >= m.ch.hopper;
  const e = full && siteFor(G, m, a, true);
  if (e) return build(G, m, a, e, dt);
  const h = full && hauler(G, m);
  if (h) {   // a hauler with room: into its tub (base.js handover), a far shorter walk than the silo's
    m.job = 'HAULING';
    if (hypot(h.x - m.x, h.z - m.z) < CONSTRUCT.handover * 0.6) return halt(m, dt);
    return walkTo(G, m, a, h.x, h.y, h.z, dt, () => { m.job = null; });
  }
  if (full && silo) {
    const [px, pz] = padOf(silo);
    m.job = 'HAULING';
    if (hypot(px - m.x, pz - m.z) < CONSTRUCT.unload * 0.5) return halt(m, dt);   // on the pad: the silo takes it
    return walkTo(G, m, a, px, G.ter.height(px, pz), pz, dt, () => { m.job = null; });
  }
  const s = m.site;
  if (!s || full) { m.job = null; return halt(m, dt); }   // nowhere to dig, or full with no silo to take it
  m.job = 'DIGGING';
  // A scoop since the last look: did it dig? (sim/tools.js counts them, and the dry ones in a row.)
  if (a.seen !== (m.scoops || 0)) {
    a.seen = m.scoops || 0;
    if (!m.dryScoops) a.aim = a.dry = 0;   // it dug
    else if (m.dryScoops % TOOL.dig.dry === 0 && (a.aim = (a.aim || 0) + 1) >= AIMS.length) {   // dry, and every way round the hole tried: the face has moved back, so after it, unless that is down a hole
      const t = G.ter.coarse.ray([m.x, m.y + 4 * m.ch.scale, m.z], [sin(s.yaw), 0, cos(s.yaw)], 60), ahead = t != null && t - MINER.stand > MINER.follow ? t - MINER.stand : MINER.follow;   // from where it stands, at its bucket's height
      const x = m.x + sin(s.yaw) * ahead, z = m.z + cos(s.yaw) * ahead;
      if ((a.dry = (a.dry || 0) + 1) > MINER.moves || G.ter.coarse.groundBelow(x, s.y + 4, z) < s.y - MINER.deep) { m.site = null; m.job = null; return halt(m, dt); }   // dug out, or nothing in reach: it stops (the 8 m ground: a fine scoop's pit isn't a hole, docs/specs/27-fine-dig.md)
      a.aim = 0; s.x = x; s.z = z;
    }
  }
  if (hypot(s.x - m.x, s.z - m.z) > MINER.arrive) return walkTo(G, m, a, s.x, s.y, s.z, dt, () => { m.site = null; m.job = null; });   // s.y: a site down its own tunnel, not on the mesa's top
  halt(m, dt);
  const [dy, dp] = AIMS[a.aim || 0], yaw = s.yaw + dy;
  m.yaw += clampN(wrapA(yaw - m.yaw), -m.ch.turn * dt, m.ch.turn * dt);
  m.pitch = MINER.level + dp;
  m.toolHold = abs(wrapA(yaw - m.yaw)) < MINER.face;   // square on: DIG
}

// The nearest part of a site this digger should go to: one its bucket can
// work now, or, with a full hopper, one that still needs ore. Null if none
// (or the last trip to it got stuck, for a while).
function siteFor(G, m, a, full) {
  let best = null, bd = Infinity;
  for (const s of G.base?.sites || []) {
    if (full ? !(s.ore < s.need) : !siteWork(s)) continue;   // full: a digger bringing ore; else a builder's work
    for (const e of s.parts) {
      const d = hypot(e.x - m.x, e.z - m.z);
      if (e.alive && d < bd && !(a.skip?.e === e && G.time < a.skip.until)) { best = e; bd = d; }
    }
  }
  return best;
}
// The nearest damaged building of the base's a builder can mend now: the
// pool has the ore for a swing. Null if none (or the last trip got stuck).
function mendFor(G, m, a) {
  if (!G.base) return null;
  let best = null, bd = Infinity;
  for (const e of G.entities) {
    if (!needsRepair(e) || G.base.ore < repairCost(e).ore) continue;
    const d = hypot(e.x - m.x, e.z - m.z);
    if (d < bd && !(a.skip?.e === e && G.time < a.skip.until)) { best = e; bd = d; }
  }
  return best;
}
// The nearest rubble, or null (or the last trip to it got stuck).
function rubbleFor(G, m, a) {
  let best = null, bd = Infinity;
  for (const e of G.entities) {
    if (!isRubble(e)) continue;
    const d = hypot(e.x - m.x, e.z - m.z);
    if (d < bd && !(a.skip?.e === e && G.time < a.skip.until)) { best = e; bd = d; }
  }
  return best;
}
// To a site's part, square on: a builder holds BUILD (sim/tools.js slams the
// pieces in); a digger bringing ore stands there while base.js tipIn takes it.
export function build(G, m, a, e, dt) {
  m.job = m.ch.tool !== 'build' ? 'DELIVERING' : e.site ? 'BUILDING' : isRubble(e) ? 'CLEARING' : 'FIXING';
  const reach = siteReach(m), d = hypot(e.x - m.x, e.z - m.z) - e.radius;
  if (d > reach * 0.7) {
    const k = e.radius + reach * 0.5, x = e.x + (m.x - e.x) / (d + e.radius) * k, z = e.z + (m.z - e.z) / (d + e.radius) * k;
    return walkTo(G, m, a, x, G.ter.height(x, z), z, dt, () => { a.skip = { e, until: G.time + 20 }; m.job = null; });
  }
  halt(m, dt);
  const yaw = atan2(e.x - m.x, e.z - m.z);
  m.yaw += clampN(wrapA(yaw - m.yaw), -m.ch.turn * dt, m.ch.turn * dt);
  m.pitch = 0;
  m.toolHold = m.ch.tool === 'build' && abs(wrapA(yaw - m.yaw)) < MINER.face * 2 && siteInReach(G, m) === e;
}

// The nearest live crew hauler with room in its tub, or null.
function hauler(G, m) {
  let best = null, bd = Infinity;
  for (const h of G.crew || []) {
    if (h === m || !h.alive || h.ch.tool || !h.ch.hopper || (h.ore || 0) >= h.ch.hopper) continue;
    const d = hypot(h.x - m.x, h.z - m.z);
    if (d < bd) { best = h; bd = d; }
  }
  return best;
}

// A hauler you leave (docs/specs/21-mining.md § The hauler): full, or with
// ore and no digger at work, it takes the tub to the silo's pad; otherwise it
// waits MINER.behind metres behind the nearest digger at work (the one you
// drive, or a parked one with a site), where that digger's hopper tips into it when full.
// `follow`: that digger and no other (a FOLLOW order, sim/orders.js).
export function haul(G, m, dt, follow = null) {
  const a = (m.ai ||= {});
  m.jetting = false; m.beamOn = false;
  let dig = follow, bd = Infinity;
  if (!follow) for (const d of G.crew || []) {
    if (d === m || !d.alive || !d.ch.tool || !(d === G.player || d.site)) continue;   // at work: yours, or parked with a site
    const k = hypot(d.x - m.x, d.z - m.z);
    if (k < bd) { dig = d; bd = k; }
  }
  const silo = siloFor(G, m), ore = m.ore || 0;
  if (follow) { m.fetch = null; if (m.carry) putDown(G, m); }
  else if (carry(G, m, a, dt)) return;   // a part an assembly line wants: that first (spec 33)
  else if (fetch(G, m, a, nearestSilo(G, m.x, m.z), dt)) return;   // a site needs ore: that first (spec 23), from the nearest silo
  const heap = !follow && ore < m.ch.hopper && nearestHeap(G, m);
  if (heap && silo) {   // a fallen silo's ore on the ground (spec 33): scoop it up (base.js), then home with it
    m.job = 'LOADING';
    if (hypot(heap.x - m.x, heap.z - m.z) < CONSTRUCT.pickup * 0.6 + heap.radius) return halt(m, dt);
    return walkTo(G, m, a, heap.x, heap.y, heap.z, dt, () => { m.job = null; });
  }
  if (silo && (ore >= m.ch.hopper || (ore > 0 && !dig))) {
    const [px, pz] = padOf(silo);
    m.job = 'HAULING';
    if (hypot(px - m.x, pz - m.z) < CONSTRUCT.unload * 0.5) return halt(m, dt);
    return walkTo(G, m, a, px, G.ter.height(px, pz), pz, dt, () => { m.job = null; });
  }
  if (!dig || ore >= m.ch.hopper) { m.job = null; return halt(m, dt); }   // no digger at work; or full, and no silo
  m.job = follow ? 'FOLLOWING' : 'LOADING';
  const yaw = dig.site ? dig.site.yaw : dig.yaw, x = dig.x - sin(yaw) * MINER.behind, z = dig.z - cos(yaw) * MINER.behind;
  if (hypot(x - m.x, z - m.z) < MINER.arrive * 2) return halt(m, dt);
  walkTo(G, m, a, x, dig.y, z, dt, () => {});
}

// Parts to an assembly line (docs/specs/33-production.md § Physical things
// and haulers): carrying one, to the line's pile; with an empty tub, to the
// nearest part a line wants (claimed, so two haulers don't go for one).
// False when there's nothing to carry.
function carry(G, m, a, dt) {
  const b = G.base;
  if (!b?.lines.length) return false;
  if (m.carry && !b.things.includes(m.carry)) m.carry = null;
  if (m.carry) {
    const line = m.carry.to;
    if (!line?.alive) { putDown(G, m); return false; }
    const [x, z] = pileAt(line, b.things.filter(o => o.at === line).length);
    m.job = 'CARRYING';
    if (Math.hypot(x - m.x, z - m.z) < CONSTRUCT.handover * 0.6) { putDown(G, m, line); halt(m, dt); return true; }
    walkTo(G, m, a, x, G.ter.height(x, z), z, dt, () => { putDown(G, m); });
    return true;
  }
  if ((m.ore || 0) > 0) return false;   // the tub's for ore now: that first
  const job = carryFor(G, m);
  if (!job) { if (m.carryFor) m.carryFor.claim = null; m.carryFor = null; return false; }
  if (m.carryFor && m.carryFor !== job.t && m.carryFor.claim === m) m.carryFor.claim = null;
  job.t.claim = m; job.t.for = job.line; m.carryFor = job.t;
  const [x, z] = thingAt(G, job.t);
  m.job = 'FETCHING';
  if (Math.hypot(x - m.x, z - m.z) < CONSTRUCT.handover * 0.6) { pickUp(job.t, m, job.line); halt(m, dt); return true; }
  walkTo(G, m, a, x, G.ter.height(x, z), z, dt, () => { job.t.claim = null; m.carryFor = null; });
  return true;
}
// Where a mech with ore takes it (spec 33): the nearest silo standing, if the
// pool has room; null if it hasn't, or there's no silo.
function siloFor(G, m) {
  const e = nearestSilo(G, m.x, m.z);
  return e && G.base.ore < oreRoom(G) ? e : null;
}
// The nearest heap of spilled ore, or null.
function nearestHeap(G, m) {
  let best = null, bd = Infinity;
  for (const h of G.base?.heaps || []) { const d = hypot(h.x - m.x, h.z - m.z); if (h.alive && d < bd) { best = h; bd = d; } }
  return best;
}

// A site that needs ore and no other hauler is feeding (spec 23): with ore,
// take it there (base.js tipIn empties it in); without, load it at the
// silo's pad, as much as the site still needs. `m.fetch` is the site; while
// it's set the silo doesn't take this hauler's ore back (base.js). False
// when there's nothing to fetch for, or nothing to fetch.
function fetch(G, m, a, silo, dt) {
  const sites = G.base?.sites || [], crew = G.crew || [];
  if (m.fetch && (!sites.includes(m.fetch) || m.fetch.ore >= m.fetch.need)) m.fetch = null;
  const ore = m.ore || 0, stock = silo && G.base.ore > 0;
  if (!m.fetch) {
    if (!(ore > 0 || stock)) return false;
    m.fetch = sites.find(s => s.ore < s.need && !crew.some(h => h !== m && h.alive && h.fetch === s)) || null;
    if (!m.fetch) return false;
  }
  const s = m.fetch;
  if (ore > 0) {
    let e = null, bd = Infinity;
    for (const p of s.parts) { const d = hypot(p.x - m.x, p.z - m.z) - p.radius; if (p.alive && d < bd) { e = p; bd = d; } }
    m.job = 'DELIVERING';
    if (bd < CONSTRUCT.handover * 0.6) { halt(m, dt); return true; }
    walkTo(G, m, a, e.x, e.y, e.z, dt, () => { m.fetch = null; });
    return true;
  }
  if (!stock) { m.fetch = null; return false; }
  const [px, pz] = padOf(silo);
  m.job = 'FETCHING';
  if (hypot(px - m.x, pz - m.z) < CONSTRUCT.unload * 0.5) {
    const take = min(m.ch.hopper, s.need - s.ore, G.base.ore);
    m.ore = take; G.base.ore -= take;
    halt(m, dt);
    return true;
  }
  walkTo(G, m, a, px, G.ter.height(px, pz), pz, dt, () => { m.fetch = null; });
  return true;
}

export function halt(m, dt) { m.throttle = 0; m.twist -= clampN(m.twist, -2 * dt, 2 * dt); }

// Toward (x, y, z) by the nav's way round, the feelers along walls; `giveUp`
// when it hasn't got a metre nearer in MINER.stuck seconds of walking.
// The steepest a mech walks up, rise over run, with a margin: its torso
// meets a slope steeper than its height over its radius (sim/mech.js rockAt).
const climbOf = m => { const g = geoOf(m); return 0.85 * g.torsoY / g.radius; };
const headOf = m => geoOf(m).height * m.ch.scale * 0.95;   // the room it needs overhead: what its body is weighed to (sim/mech.js rockAt), so a tunnel it dug fits it
export function walkTo(G, m, a, x, y, z, dt, giveUp) {
  // In or out of its own tunnel (docs/specs/29-ground-4m.md: on the 4 m grid
  // its walls are walls): when the straight way isn't one it can walk, by the
  // tunnel's mouth first, the way it came.
  const mo = m.site?.mouth;
  if (mo && hypot(mo[0] - m.x, mo[2] - m.z) > MINER.mouth && hypot(x - m.x, z - m.z) > MINER.mouth && !walkable(walkGround(G.ter), m.x, m.y, m.z, x, z, 40, climbOf(m), headOf(m))) { x = mo[0]; y = mo[1]; z = mo[2]; }
  const d = hypot(x - m.x, z - m.z), g = a.goal, digs = m.ch.tool === 'dig';
  if (!g || g.x !== x || g.z !== z || d < g.best - 1 || G.time - g.seen > 1) a.goal = { x, z, best: d, t: G.time, seen: G.time };   // a new trip, nearer, or back after a break
  else if (G.time - g.t > (digs ? MINER.rampFor : MINER.stuck)) { a.goal = null; giveUp(); return halt(m, dt); }
  else g.seen = G.time;
  // A digger that's got no nearer for a while, with no way on it can walk (a
  // pit, a wall too steep, a roof too low), digs one (docs/specs/30-dig-up.md):
  // it faces the way it's going, looks up and holds DIG, and a scoop aimed up
  // cuts a ramp (sim/tools.js). As soon as the way on is one it can walk, it walks it.
  if (digs && a.goal && G.time - a.goal.t > MINER.rampAfter) {
    const want = atan2(x - m.x, z - m.z), look = min(MINER.rampLook, d);
    if (!walkable(walkGround(G.ter), m.x, m.y, m.z, m.x + sin(want) * look, m.z + cos(want) * look, Infinity, climbOf(m), headOf(m))) {
      halt(m, dt);
      m.yaw += clampN(wrapA(want - m.yaw), -m.ch.turn * dt, m.ch.turn * dt);
      m.pitch = MINER.rampPitch;
      m.toolHold = abs(wrapA(want - m.yaw)) < MINER.face;
      return;
    }
  }
  let yaw = routeYaw(G, m, x, y, z) ?? atan2(x - m.x, z - m.z);
  yaw = feelers(G, m, yaw, min(FEEL_M, d + 2), climbOf(m), headOf(m));
  const off = abs(wrapA(yaw - m.yaw));
  m.yaw += clampN(wrapA(yaw - m.yaw), -m.ch.turn * dt, m.ch.turn * dt);
  m.twist -= clampN(m.twist, -2 * dt, 2 * dt);
  m.pitch = 0;
  m.throttle = off > 1 ? 0 : min(1, 0.35 + d / 30);   // turn on the spot first; ease in at the end
}
