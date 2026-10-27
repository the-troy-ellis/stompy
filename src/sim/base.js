import { CONSTRUCT, BUILDINGS, PLACE, PLACE_ORDER } from '../data/construct.js';
import { NAMES } from '../data/names.js';
import { addEntity } from './entities.js';
import { newMech } from './state.js';
import { park } from './crew.js';
import { polar } from './placement.js';
import { viewYaw } from './geom.js';
import { feel } from './feel.js';
import { msg } from './effects.js';

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
// factory `job` (seconds into a mech, or null).
const { sin, cos, hypot, atan2, abs, max, min } = Math;

export function initBase(G, def) {
  G.base = null;
  if (!def.base) return;
  const { x, z } = polar(def.base.silo), silo = addEntity(G, { ...BUILDINGS.silo, x, z, yaw: atan2(-x, -z), hp: CONSTRUCT.siloHp, id: 'silo' });
  G.base = { ore: CONSTRUCT.startOre, salvage: 0, silo, factory: null, bays: [], walls: [], pick: 0, sites: [] };
}

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
    if (kind === 'factory') { e.job = null; b.factory = e; } else b.bays.push(e);
  }
  return site;
}
// How far a site is built: its work, never past what the ore in it pays for.
export const siteProg = s => min(s.work / s.swings, s.ore / s.need);
// Whether a bucket swing would build it now: the work is behind the ore.
export const siteWork = s => s.work < s.swings * s.ore / s.need - 1e-9;
// A bucket swing on a site (melee.js): one swing of work, if the ore allows.
// True if it built.
export function buildSwing(G, m, e) {
  const s = e.site;
  if (!s || !siteWork(s)) { if (m === G.player) msg(G, 'NEEDS ORE', '#fc3'); return false; }
  s.work += 1;
  if (m === G.player) msg(G, 'BUILDING');
  return true;
}
export const placeFactory = (G, m) => placeBuilding(G, m, 'factory');

// BUILD (the missile button while you drive a digger): held, the footprint
// shows (G.buildAt, drawn by the HUD); let go, the picked building goes there.
export function buildTrigger(G, m, held) {
  if (!G.base || !m.ch.tools) { G.buildAt = null; return; }
  if (held) G.buildAt = footprint(G, m);
  else if (G.buildAt) { G.buildAt = null; placeBuilding(G, m); }
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
// unload at the silo; buildings go up; the factory builds; bays mend.
export function stepBase(G, dt) {
  const b = G.base;
  if (!b) return;
  handover(G);
  if (b.silo.alive) {
    const [px, pz] = padOf(b.silo);
    for (const m of G.crew || []) {
      if (!m.alive || !(m.ore > 0) || (m.fetch && m.parked) || hypot(m.x - px, m.z - pz) > CONSTRUCT.unload) continue;   // a hauler fetching for a site keeps what it loaded (sim/miner.js)
      b.ore += m.ore; m.ore = 0;
      if (m === G.player) { G.fx.say('Ore in.'); msg(G, 'ORE IN'); }
    }
  }
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

// A crew digger with ore, near a crew hauler with room (docs/specs/21-mining.md
// § The hauler): its hopper goes into the hauler's tub, as much as fits.
export function handover(G) {
  const crew = G.crew || [];
  for (const h of crew) {
    if (!h.alive || h.ch.tools || !h.ch.hopper) continue;   // a hauler: a hopper and no bucket
    for (const d of crew) {
      const room = h.ch.hopper - (h.ore || 0);
      if (!(room > 0)) break;
      if (!d.alive || !d.ch.tools || !(d.ore > 0) || hypot(d.x - h.x, d.z - h.z) > CONSTRUCT.handover) continue;
      const n = Math.min(room, d.ore);
      d.ore -= n; h.ore = (h.ore || 0) + n;
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
