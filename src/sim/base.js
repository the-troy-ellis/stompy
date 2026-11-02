import { CONSTRUCT, BUILDINGS, PLACE, PLACE_ORDER, HEAP, LINE } from '../data/construct.js';
import { NAMES } from '../data/names.js';
import { addEntity } from './entities.js';
import { newMech } from './state.js';
import { park } from './crew.js';
import { polar } from './placement.js';
import { viewYaw } from './geom.js';
import { feel } from './feel.js';
import { msg } from './effects.js';
import { territory, inTerritory } from './territory.js';
import { stepProduction } from './production.js';

// The base (docs/specs/20-build-and-fight.md § Two buildings): a silo that
// holds the base's ore and salvage, where a digger unloads; a factory that
// a digger places on flat ground for ore, which goes up over a few seconds
// and then turns ore and salvage into a fighting mech for the crew, one at
// a time. A mission has a base when it says `base: { silo: [bearing°, dist] }`.
// Spec 21 (docs/specs/21-mining.md § Buildings) adds what else BUILD can put
// down, picked with BALLISTIC (PLACE_ORDER): repair bays, which mend a crew
// mech standing on their pad, and walls, slabs side by side. Spec 23
// (docs/specs/23-construction-sites.md): what BUILD puts down is a site, a
// building at prog 0 with `site = { ore, need, work, swings }`, which rises
// only as ore is carried to it (`tipIn`) and a digger's bucket works it
// (`buildSwing`, from melee.js), never past what the ore pays for. A wall's
// slabs share one site. G.base = { ore, salvage, silo, factory, bays, walls,
// pick, sites }; a building carries `prog` (0..1) and its full height; the
// factory `job` (seconds into a mech, or null). Spec 33
// (docs/specs/33-production.md): any number of silos (`silos`; `silo` is the
// mission's own), the ore one pool with room for CONSTRUCT.siloRoom a silo
// standing, ore spilled from a fallen one in `heaps`; `beacons`; and `land`,
// the territory the silos and beacons make, with each building `exposed`
// outside it. Builders repair for ore (`repairSwing`).
const { sin, cos, hypot, atan2, abs, max, min } = Math;

export function initBase(G, def) {
  G.base = null;
  if (!def.base) return;
  const { x, z } = polar(def.base.silo), silo = addEntity(G, { ...BUILDINGS.silo, x, z, yaw: atan2(-x, -z), hp: CONSTRUCT.siloHp, id: 'silo' });
  G.base = { ore: CONSTRUCT.startOre, iso: 0, salvage: 0, silo, silos: [silo], beacons: [], heaps: [], shops: [], lines: [], plants: [], things: [], factory: null, bays: [], walls: [], pick: 0, sites: [], land: null, landT: 0 };
  silo.counted = true;
  survey(G);
}

// Spec 33 § Silos and the pool. A building is up when it stands and isn't a
// site still going up (the mission's own silo never was one).
export const isUp = e => e.alive && !e.site && (e.prog ?? 1) >= 1;
export const silosUp = G => (G.base?.silos || []).filter(isUp);
export const oreRoom = G => silosUp(G).length * CONSTRUCT.siloRoom;
export const isoRoom = G => silosUp(G).length * CONSTRUCT.isoRoom;   // isotopes, a pool of their own (spec 33 part 3)
// The nearest silo standing to (x, z), or null.
export function nearestSilo(G, x, z) {
  let best = null, bd = Infinity;
  for (const e of G.base?.silos || []) { const d = hypot(e.x - x, e.z - z); if (isUp(e) && d < bd) { best = e; bd = d; } }
  return best;
}
// The base's own buildings that are up: what territory covers, or doesn't.
export const buildingsUp = G => G.entities.filter(e => e.team === 0 && e.kind === 'structure' && isUp(e) && G.base && (e.tags.includes('silo') || e.place || e === G.base.factory));

// Territory (spec 33 § Beacons and territory): the silos and beacons that are
// up are the nodes; G.base.land = { nodes, links, tris }, and each building
// up gets `exposed` (outside every triangle). Rebuilt a few times a second.
export function survey(G) {
  const b = G.base;
  const nodes = [...b.silos, ...b.beacons].filter(isUp);
  b.land = { nodes, ...territory(nodes, CONSTRUCT.link) };
  for (const e of buildingsUp(G)) e.exposed = !inTerritory(nodes, b.land, e.x, e.z);
}
// Whether (x, z) is in the base's territory.
export const inLand = (G, x, z) => !!G.base?.land && inTerritory(G.base.land.nodes, G.base.land, x, z);

// Where a building's pad is: in front of it (its nose, +z turned by its yaw).
export const padOf = (e, out = 0.9) => [e.x + sin(e.yaw) * e.radius * out, e.z + cos(e.yaw) * e.radius * out];
// What BUILD puts down now, and BALLISTIC's turn to the next.
export const pickOf = G => PLACE_ORDER[G.base?.pick || 0];
export function pickNext(G) {
  if (!G.base) return;
  G.base.pick = ((G.base.pick || 0) + 1) % PLACE_ORDER.length;
}

// A building's footprint in front of the digger (its near edge 14 m off, so
// you see it go up): w across your view and d along it. `why` is null when
// it can go there, else 'room' (not flat, or a mech or a building in it) or
// 'built' (the one there can be is up, or its site is down). Ore isn't
// needed: it's carried to the site (spec 23).
export function footprint(G, m, kind = pickOf(G)) {
  const P = PLACE[kind], yaw = viewYaw(m), dist = P.d / 2 + 14;
  return footprintAt(G, m.x + sin(yaw) * dist, m.z + cos(yaw) * dist, yaw, kind);
}
// The same at a point, `yaw` the way across it faces (the command view's BUILD).
export function footprintAt(G, x, z, yaw, kind = pickOf(G)) {
  const P = PLACE[kind], b = G.base;
  const fx = sin(yaw), fz = cos(yaw), rx = cos(yaw), rz = -sin(yaw), hw = P.w / 2, hd = P.d / 2;
  let why = null;
  if (P.one && kind === 'factory' && b.factory?.alive) why = 'built';
  else {
    const h0 = G.ter.height(x, z);
    for (let i = -2; i <= 2 && !why; i++) for (let k = -2; k <= 2 && !why; k++) {
      const px = x + rx * hw * i / 2 + fx * hd * k / 2, pz = z + rz * hw * i / 2 + fz * hd * k / 2;
      if (abs(G.ter.height(px, pz) - h0) > P.flat) why = 'room';
    }
    // In it: across and along, by the other thing's radius.
    const inside = (ox, oz, r) => { const dx = ox - x, dz = oz - z; return abs(dx * rx + dz * rz) < hw + r && abs(dx * fx + dz * fz) < hd + r; };
    for (const o of G.mechs) if (!why && o.alive && inside(o.x, o.z, 3)) why = 'room';
    for (const e of G.entities) if (!why && e.alive && e.kind !== 'nav' && inside(e.x, e.z, e.radius)) why = 'room';
  }
  return { x, z, yaw, w: P.w, d: P.d, r: max(hw, hd), kind, why };
}

// Where a wall placed near (x, z) snaps to (spec 23 § Snapping walls): on
// from the free end of a wall or wall site already there, in line with it or
// turning a right angle, slabs a slab apart. The nearest such spot within
// PLACE.wall.snap of (x, z), as { x, z, yaw }, or null.
export function snapWall(G, x, z) {
  const step = BUILDINGS.wall.radius * 1.9, n = PLACE.wall.segs, mid = (n - 1) / 2;
  const walls = G.entities.filter(e => e.alive && e.tags?.includes('wall'));
  const taken = (px, pz) => walls.some(o => Math.hypot(o.x - px, o.z - pz) < step * 0.6);
  let best = null, bd = PLACE.wall.snap;
  const offer = (cx, cz, yaw) => { const d = hypot(cx - x, cz - z); if (d < bd) { bd = d; best = { x: cx, z: cz, yaw }; } };
  for (const e of walls) {
    const y = e.yaw || 0, rx = cos(y), rz = -sin(y), fx = sin(y), fz = cos(y);
    for (const s of [-1, 1]) {
      const ex = e.x + rx * s * step, ez = e.z + rz * s * step;   // the next slab's spot, past this end
      if (taken(ex, ez)) continue;
      offer(e.x + rx * s * step * (1 + mid), e.z + rz * s * step * (1 + mid), y);   // in line
      for (const t of [-1, 1]) offer(ex + fx * t * step * mid, ez + fz * t * step * mid, y - Math.PI / 2);   // a corner, its first slab at that spot
    }
  }
  return best;
}

// Put the picked building's site down where the footprint says (spec 23):
// nothing is paid now. True if it went down.
export function placeBuilding(G, m, kind = pickOf(G)) {
  const f = footprint(G, m, kind);
  if (f.why) { if (m === G.player) msg(G, f.why === 'room' ? 'NO ROOM' : 'BUILT', '#fc3'); return false; }
  placeSite(G, f);
  feel(G, 'land', { mech: m, k: 0.6 });
  return true;
}
// A site where footprint `f` says (its x, z, yaw and kind), assumed to fit.
export function placeSite(G, f) {
  const kind = f.kind, P = PLACE[kind], b = G.base, site = { kind, ore: 0, need: P.ore, work: 0, swings: P.swings, parts: [] };
  const rise = e => { e.full = e.height; e.height = 0.5; e.prog = 0; e.place = kind; e.site = site; e.foot = [f.w, f.d, f.yaw]; site.parts.push(e); return e; };
  b.sites.push(site);
  if (kind === 'wall') {
    // Slabs side by side across your view, facing you.
    const rx = cos(f.yaw), rz = -sin(f.yaw), step = BUILDINGS.wall.radius * 1.9;
    for (let i = 0; i < P.segs; i++) {
      const o = (i - (P.segs - 1) / 2) * step;
      b.walls.push(rise(addEntity(G, { ...BUILDINGS.wall, x: f.x + rx * o, z: f.z + rz * o, yaw: f.yaw, hp: P.hp })));
    }
  } else {
    const e = rise(addEntity(G, { ...BUILDINGS[kind], x: f.x, z: f.z, yaw: f.yaw + Math.PI, hp: P.hp, ...(kind === 'factory' ? { id: 'factory' } : {}) }));   // its door or pad toward the digger
    if (kind === 'factory') { e.job = null; b.factory = e; } else if (kind === 'silo') b.silos.push(e); else if (kind === 'beacon') b.beacons.push(e);
    else if (kind === 'shop') { e.press = null; b.shops.push(e); } else if (kind === 'plant') { e.brew = null; b.plants.push(e); } else if (kind === 'line') { e.bays = new Array(LINE.bays).fill(null); e.queue = []; b.lines.push(e); } else b.bays.push(e);
  }
  return site;
}
// How far a site is built: its work, never past what the ore in it pays for.
export const siteProg = s => min(s.work / s.swings, s.ore / s.need);
export const siteDone = s => s.work >= s.swings && s.ore >= s.need;   // its last piece in (docs/specs/31-builder.md)
// Whether a bucket swing would build it now: the work is behind the ore.
export const siteWork = s => s.work < s.swings * s.ore / s.need - 1e-9;
// A bucket swing on a site (melee.js): one swing of work, if the ore allows.
// True if it built.
export function buildSwing(G, m, e, work = true) {   // work false: a scoop between swings (sim/tools.js), only the word
  const s = e.site;
  if (!s || !siteWork(s)) { if (m === G.player) msg(G, 'NEEDS ORE', '#fc3'); return false; }
  if (work) s.work += 1;
  if (m === G.player) msg(G, 'BUILDING');
  return true;
}
export const placeFactory = (G, m) => placeBuilding(G, m, 'factory');
// Repairs (spec 33 § Repairs): a builder's swing on a damaged building of the
// base's mends a swing's share of it (as many swings as building one piece
// of it took) and takes CONSTRUCT.repairOre of that share of its price from
// the pool. No ore for it: NEEDS ORE, and nothing mended.
export const kindOf = e => e.place || PLACE_ORDER.find(k => e.tags.includes(k)) || null;
export const needsRepair = e => !!e && e.team === 0 && isUp(e) && Number.isFinite(e.hp) && e.hp < e.max - 1e-6 && !!PLACE[kindOf(e)];
export function repairCost(e) {
  const P = PLACE[kindOf(e)], n = P.segs || 1, swings = P.swings / n;
  return { ore: P.ore / n * CONSTRUCT.repairOre / swings, hp: e.max / swings };
}
export function repairSwing(G, m, e) {
  if (!needsRepair(e)) return false;
  const c = repairCost(e), k = min(1, (e.max - e.hp) / c.hp), ore = c.ore * k;
  if (G.base.ore < ore - 1e-9) { if (m === G.player) msg(G, 'NEEDS ORE', '#fc3'); return false; }
  G.base.ore = max(0, G.base.ore - ore); e.hp = min(e.max, e.hp + c.hp * k);
  if (m === G.player) msg(G, 'FIXING');
  return true;
}


// A repair bay mends a crew mech on its pad: CONSTRUCT.bayRate a second, the
// most damaged section first, never a section that is gone. Returns how much.
export function mend(m, amount) {
  let left = amount;
  while (left > 1e-6) {
    let worst = null, wf = 1;
    for (const k of Object.keys(m.max)) {
      const f = m.hp[k] / m.max[k];
      if (m.hp[k] > 0 && f < wf) { wf = f; worst = k; }
    }
    if (!worst) break;
    const add = min(left, m.max[worst] - m.hp[worst]);
    m.hp[worst] += add; left -= add;
  }
  return amount - left;
}

// Once a frame: diggers tip into a hauler beside them; diggers and haulers
// unload at any silo; a fallen silo spills; heaps are scooped; territory is
// looked at; buildings go up; the factory builds; bays mend.
export function stepBase(G, dt) {
  const b = G.base;
  if (!b) return;
  handover(G);
  // Any silo standing takes ore into the one pool, as far as there's room.
  for (const silo of b.silos) {
    if (!isUp(silo)) continue;
    const [px, pz] = padOf(silo);
    for (const m of G.crew || []) {
      if (!m.alive || !(m.ore > 0 || m.iso > 0) || (m.fetch && m.parked) || hypot(m.x - px, m.z - pz) > CONSTRUCT.unload) continue;   // a hauler fetching for a site keeps what it loaded (sim/miner.js)
      if (m.iso > 0) { const k = min(m.iso, isoRoom(G) - b.iso); if (k > 0) { b.iso += k; m.iso -= k; if (m === G.player) msg(G, 'ISOTOPES IN'); } }
      if (!(m.ore > 0)) continue;
      const n = min(m.ore, oreRoom(G) - b.ore);
      if (!(n > 0)) { if (m === G.player && !G.siloFull) msg(G, 'SILO FULL', '#fc3'); if (m === G.player) G.siloFull = true; continue; }
      b.ore += n; m.ore -= n; G.siloFull = false;
      if (m === G.player) { G.fx.say('Ore in.'); msg(G, 'ORE IN'); }
    }
  }
  spill(G);
  scoopHeaps(G);
  if ((b.landT -= dt) <= 0) { b.landT = 0.25; survey(G); }
  stepProduction(G, dt);   // shops press parts, lines put mechs together (spec 33)
  // Sites (spec 23): ore tips in, and each rises as far as it's built. A
  // wall's slabs share one and come up together; a site with none of its
  // parts standing is gone, and its ore with it.
  tipIn(G);
  b.sites = b.sites.filter(s => s.parts.some(e => e.alive));
  for (const s of b.sites) {
    const p = siteProg(s);
    for (const e of s.parts) { e.prog = p; e.height = max(0.5, e.full * p); }
    if (p < 1) continue;
    for (const e of s.parts) e.site = null;
    G.fx.say(`${NAMES.buildings[s.kind][0]}${NAMES.buildings[s.kind].slice(1).toLowerCase()} up.`);
  }
  b.sites = b.sites.filter(s => siteProg(s) < 1);
  // The bays: a crew mech on a finished bay's pad gets its armour back.
  let mending = false;
  for (const bay of b.bays) {
    if (!bay.alive || bay.prog < 1) continue;
    const [px, pz] = padOf(bay);
    for (const m of G.crew || []) {
      if (!m.alive || hypot(m.x - px, m.z - pz) > CONSTRUCT.bayPad) continue;
      if (mend(m, CONSTRUCT.bayRate * dt) > 0 && m === G.player) mending = true;
    }
  }
  if (mending && !G.mending) msg(G, 'REPAIRING');
  G.mending = mending;
  const f = b.factory;
  if (!f || !f.alive || f.prog < 1) return;
  const c = CONSTRUCT.mechCost;
  if (f.job == null && b.ore >= c.ore && b.salvage >= c.salvage) { b.ore -= c.ore; b.salvage -= c.salvage; f.job = 0; }
  if (f.job == null) return;
  f.job += dt;
  if (f.job < CONSTRUCT.mechTime) return;
  f.job = null;
  const [x, z] = padOf(f, 1.6), k = newMech(G, 'kestrel', 0, x, z, f.yaw);
  park(k); G.mechs.push(k);
  (G.crew ||= [G.player]).push(k);
  G.fx.say('New mech ready.');
}

// A silo that has fallen since the last look (spec 33 § Silos and the pool):
// the pool drops to the room the rest have, and what's over spills as a heap
// where it stood. A beacon or silo that falls: `Beacon lost.` / `Silo lost.`,
// and territory is looked at again at once.
function spill(G) {
  const b = G.base;
  let changed = false;
  for (const e of b.silos) {
    if (!e.counted && isUp(e)) { e.counted = true; changed = true; }
    if (!e.counted || e.alive) continue;
    e.counted = false; changed = true;
    const over = b.ore - oreRoom(G);
    if (over > 0) { b.ore -= over; addHeap(G, e.x, e.z, over); }
    G.fx.say('Silo lost.');
  }
  for (const e of b.beacons) {
    if (!e.counted && isUp(e)) { e.counted = true; changed = true; }
    if (!e.counted || e.alive) continue;
    e.counted = false; changed = true;
    G.fx.say('Beacon lost.');
  }
  if (changed) { b.landT = 0; survey(G); }
}
// A heap of `ore` at (x, z), its size by how much is in it.
const heapR = ore => 2 + Math.sqrt(ore) * 0.45;
export function addHeap(G, x, z, ore) {
  const e = addEntity(G, { ...HEAP, x, z, radius: heapR(ore) });
  e.ore = ore;
  G.base.heaps.push(e);
  return e;
}
// A crew mech with room in its hopper, beside a heap, scoops it up.
function scoopHeaps(G) {
  const b = G.base;
  for (const h of b.heaps) {
    for (const m of G.crew || []) {
      if (!h.alive || !m.alive || !m.ch.hopper || hypot(m.x - h.x, m.z - h.z) > CONSTRUCT.pickup + h.radius) continue;
      const n = min(m.ch.hopper - (m.ore || 0), h.ore);
      if (!(n > 0)) continue;
      m.ore = (m.ore || 0) + n; h.ore -= n; h.radius = heapR(h.ore);
      if (h.ore <= 1e-6) h.alive = false;
      if (m === G.player) msg(G, 'ORE UP');
    }
  }
  if (b.heaps.some(h => !h.alive)) b.heaps = b.heaps.filter(h => h.alive);
}

// A crew digger with ore, near a crew hauler with room (docs/specs/21-mining.md
// § The hauler): its hopper goes into the hauler's tub, as much as fits.
export function handover(G) {
  const crew = G.crew || [];
  for (const h of crew) {
    if (!h.alive || h.ch.tool || !h.ch.hopper) continue;   // a hauler: a hopper and no bucket
    for (const d of crew) {
      const room = h.ch.hopper - (h.ore || 0);
      if (!(room > 0)) break;
      if (!d.alive || !d.ch.tool || !(d.ore > 0) || hypot(d.x - h.x, d.z - h.z) > CONSTRUCT.handover) continue;
      const n = Math.min(room, d.ore);
      d.ore -= n; h.ore = (h.ore || 0) + n;
      if (d.iso > 0) { const k = Math.min(d.iso, CONSTRUCT.isoMax - (h.iso || 0)); d.iso -= k; h.iso = (h.iso || 0) + k; }   // its isotopes go across with the ore (spec 33)
      if (d === G.player || h === G.player) msg(G, 'ORE ACROSS');
    }
  }
}

// A crew mech with ore near a site that needs it tips in (spec 23), as much
// as the site still needs: within CONSTRUCT.handover of any of its parts.
export function tipIn(G) {
  for (const s of G.base.sites) {
    for (const m of G.crew || []) {
      const left = s.need - s.ore;
      if (!(left > 0)) break;
      if (!m.alive || !(m.ore > 0) || !s.parts.some(e => e.alive && hypot(m.x - e.x, m.z - e.z) < CONSTRUCT.handover + e.radius)) continue;
      const n = min(left, m.ore);
      m.ore -= n; s.ore += n;
      if (m === G.player) msg(G, 'ORE ACROSS');
    }
  }
}
