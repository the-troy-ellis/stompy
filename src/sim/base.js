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
// mech standing on their pad, and walls, slabs side by side. G.base = { ore,
// salvage, silo, factory, bays, walls, pick, rising }; a building going up
// carries `prog` (0..1) and its full height; the factory `job` (seconds into
// a mech, or null).
const { sin, cos, hypot, atan2, abs, max, min } = Math;

export function initBase(G, def) {
  G.base = null;
  if (!def.base) return;
  const { x, z } = polar(def.base.silo), silo = addEntity(G, { ...BUILDINGS.silo, x, z, yaw: atan2(-x, -z), hp: CONSTRUCT.siloHp, id: 'silo' });
  G.base = { ore: CONSTRUCT.startOre, salvage: 0, silo, factory: null, bays: [], walls: [], pick: 0, rising: [] };
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
// it can go there, else 'ore' (not enough), 'room' (not flat, or a mech or a
// building in it) or 'built' (the one there can be is up).
export function footprint(G, m, kind = pickOf(G)) {
  const P = PLACE[kind], yaw = viewYaw(m), dist = P.d / 2 + 14, x = m.x + sin(yaw) * dist, z = m.z + cos(yaw) * dist, b = G.base;
  const fx = sin(yaw), fz = cos(yaw), rx = cos(yaw), rz = -sin(yaw), hw = P.w / 2, hd = P.d / 2;
  let why = null;
  if (P.one && kind === 'factory' && b.factory) why = 'built';
  else if (b.ore < P.ore) why = 'ore';
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

// Put the picked building down where the footprint says, paying for it. True if it went up.
export function placeBuilding(G, m, kind = pickOf(G)) {
  const f = footprint(G, m, kind), P = PLACE[kind], b = G.base;
  if (f.why) { if (m === G.player) msg(G, f.why === 'ore' ? `${P.ore} ORE` : f.why === 'room' ? 'NO ROOM' : 'BUILT', '#fc3'); return false; }
  b.ore -= P.ore;
  const rise = e => { e.full = e.height; e.height = 0.5; e.prog = 0; e.place = kind; b.rising.push(e); return e; };
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
  feel(G, 'land', { mech: m, k: 0.6 });
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
      if (!m.alive || !(m.ore > 0) || hypot(m.x - px, m.z - pz) > CONSTRUCT.unload) continue;
      b.ore += m.ore; m.ore = 0;
      if (m === G.player) { G.fx.say('Ore in.'); msg(G, 'ORE IN'); }
    }
  }
  // Going up. A wall's slabs come up together and are called once.
  for (const e of b.rising) {
    e.prog = min(1, e.prog + dt / PLACE[e.place].time);
    e.height = max(0.5, e.full * e.prog);
  }
  const up = b.rising.filter(e => e.prog >= 1);
  if (up.length) {
    b.rising = b.rising.filter(e => e.prog < 1);
    for (const kind of new Set(up.map(e => e.place))) G.fx.say(`${NAMES.buildings[kind][0]}${NAMES.buildings[kind].slice(1).toLowerCase()} up.`);
  }
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
