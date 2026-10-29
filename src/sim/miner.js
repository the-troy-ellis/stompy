import { clampN, wrapA } from '../util/math.js';
import { CONSTRUCT } from '../data/construct.js';
import { siteInReach, siteReach } from './tools.js';
import { TOOL } from '../data/tools.js';
import { routeYaw, feelers } from './ai/nav.js';
import { padOf, siteWork } from './base.js';

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
  face: 0.12,     // rad: this square to the site's heading before it holds DIG
  follow: 4,      // m: when no aim digs, the site moves this far ahead, after the face
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
  m.jetting = false; m.beamOn = false;
  const silo = G.base?.silo?.alive ? G.base.silo : null, full = (m.ore || 0) >= m.ch.hopper;
  const e = siteFor(G, m, a, full);
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
      const x = s.x + sin(s.yaw) * MINER.follow, z = s.z + cos(s.yaw) * MINER.follow;
      if ((a.dry = (a.dry || 0) + 1) > MINER.moves || G.ter.groundBelow(x, s.y + 4, z, undefined, true) < s.y - MINER.deep) { m.site = null; m.job = null; return halt(m, dt); }   // dug out, or nothing in reach: it stops (the 8 m ground: a fine scoop's pit isn't a hole, docs/specs/27-fine-dig.md)
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
    if (!siteWork(s) && !(full && s.ore < s.need)) continue;
    for (const e of s.parts) {
      const d = hypot(e.x - m.x, e.z - m.z);
      if (e.alive && d < bd && !(a.skip?.e === e && G.time < a.skip.until)) { best = e; bd = d; }
    }
  }
  return best;
}
// To a site's part, square on, and hold DIG (sim/tools.js builds it with the
// buckets; base.js tipIn takes its ore on the way in).
export function build(G, m, a, e, dt) {
  m.job = 'BUILDING';
  const reach = siteReach(m), d = hypot(e.x - m.x, e.z - m.z) - e.radius;
  if (d > reach * 0.7) {
    const k = e.radius + reach * 0.5, x = e.x + (m.x - e.x) / (d + e.radius) * k, z = e.z + (m.z - e.z) / (d + e.radius) * k;
    return walkTo(G, m, a, x, G.ter.height(x, z), z, dt, () => { a.skip = { e, until: G.time + 20 }; m.job = null; });
  }
  halt(m, dt);
  const yaw = atan2(e.x - m.x, e.z - m.z);
  m.yaw += clampN(wrapA(yaw - m.yaw), -m.ch.turn * dt, m.ch.turn * dt);
  m.pitch = 0;
  m.toolHold = abs(wrapA(yaw - m.yaw)) < MINER.face * 2 && siteInReach(G, m) === e;
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
  const silo = G.base?.silo?.alive ? G.base.silo : null, ore = m.ore || 0;
  if (follow) m.fetch = null;
  else if (fetch(G, m, a, silo, dt)) return;   // a site needs ore: that first (spec 23)
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
export function walkTo(G, m, a, x, y, z, dt, giveUp) {
  const d = hypot(x - m.x, z - m.z), g = a.goal;
  if (!g || g.x !== x || g.z !== z || d < g.best - 1 || G.time - g.seen > 1) a.goal = { x, z, best: d, t: G.time, seen: G.time };   // a new trip, nearer, or back after a break
  else if (G.time - g.t > MINER.stuck) { a.goal = null; giveUp(); return halt(m, dt); }
  else g.seen = G.time;
  let yaw = routeYaw(G, m, x, y, z) ?? atan2(x - m.x, z - m.z);
  yaw = feelers(G, m, yaw);
  const off = abs(wrapA(yaw - m.yaw));
  m.yaw += clampN(wrapA(yaw - m.yaw), -m.ch.turn * dt, m.ch.turn * dt);
  m.twist -= clampN(m.twist, -2 * dt, 2 * dt);
  m.pitch = 0;
  m.throttle = off > 1 ? 0 : min(1, 0.35 + d / 30);   // turn on the spot first; ease in at the end
}
