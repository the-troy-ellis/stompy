import { CONSTRUCT, BUILDINGS } from '../data/construct.js';
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
// G.base = { ore, salvage, silo, factory }; the factory entity carries
// `prog` (0..1 going up) and `job` (seconds into a mech, or null).
const { sin, cos, hypot, atan2, abs, max } = Math;

export function initBase(G, def) {
  G.base = null;
  if (!def.base) return;
  const { x, z } = polar(def.base.silo), silo = addEntity(G, { ...BUILDINGS.silo, x, z, yaw: atan2(-x, -z), hp: CONSTRUCT.siloHp, id: 'silo' });
  G.base = { ore: CONSTRUCT.startOre, salvage: 0, silo, factory: null };
}

// Where a building's pad is: in front of it (its nose, +z turned by its yaw).
export const padOf = (e, out = 0.9) => [e.x + sin(e.yaw) * e.radius * out, e.z + cos(e.yaw) * e.radius * out];

// The factory's footprint in front of the digger (its near edge 14 m off, so you see it go up), and whether it can go there:
// `why` is null when it can, else 'ore' (not enough), 'room' (not flat, or a
// mech on it) or 'built' (there is one).
export function footprint(G, m) {
  const R = CONSTRUCT.footprint / 2, yaw = viewYaw(m), d = R + 14, x = m.x + sin(yaw) * d, z = m.z + cos(yaw) * d, b = G.base;
  let why = null;
  if (b.factory) why = 'built';
  else if (b.ore < CONSTRUCT.factory) why = 'ore';
  else {
    const h0 = G.ter.height(x, z);
    for (let i = -2; i <= 2 && !why; i++) for (let k = -2; k <= 2 && !why; k++) if (abs(G.ter.height(x + i * R / 2, z + k * R / 2) - h0) > CONSTRUCT.flat) why = 'room';
    for (const o of G.mechs) if (!why && o.alive && hypot(o.x - x, o.z - z) < R + 3) why = 'room';
    for (const e of G.entities) if (!why && e.alive && e.kind !== 'nav' && hypot(e.x - x, e.z - z) < R + e.radius) why = 'room';
  }
  return { x, z, yaw, r: R, why };
}

// Put the factory down where the footprint says, paying for it. True if it went up.
export function placeFactory(G, m) {
  const f = footprint(G, m);
  if (f.why) { if (m === G.player) msg(G, f.why === 'ore' ? `${CONSTRUCT.factory} ORE` : f.why === 'room' ? 'NO ROOM' : 'BUILT', '#fc3'); return false; }
  G.base.ore -= CONSTRUCT.factory;
  const e = addEntity(G, { ...BUILDINGS.factory, x: f.x, z: f.z, yaw: f.yaw + Math.PI, hp: CONSTRUCT.factoryHp, id: 'factory' });   // its door toward the digger
  e.full = e.height; e.height = 0.5; e.prog = 0; e.job = null;
  G.base.factory = e;
  feel(G, 'land', { mech: m, k: 0.6 });
  return true;
}

// BUILD (the missile button while you drive a digger): held, the footprint
// shows (G.buildAt, drawn by the HUD); let go, the factory goes there.
export function buildTrigger(G, m, held) {
  if (!G.base || !m.ch.tools) { G.buildAt = null; return; }
  if (held) G.buildAt = footprint(G, m);
  else if (G.buildAt) { G.buildAt = null; placeFactory(G, m); }
}

// Once a frame: diggers unload at the silo; the factory goes up, then builds.
export function stepBase(G, dt) {
  const b = G.base;
  if (!b) return;
  if (b.silo.alive) {
    const [px, pz] = padOf(b.silo);
    for (const m of G.crew || []) {
      if (!m.alive || !(m.ore > 0) || hypot(m.x - px, m.z - pz) > CONSTRUCT.unload) continue;
      b.ore += m.ore; m.ore = 0;
      if (m === G.player) { G.fx.say('Ore in.'); msg(G, 'ORE IN'); }
    }
  }
  const f = b.factory;
  if (!f || !f.alive) return;
  if (f.prog < 1) {
    f.prog = Math.min(1, f.prog + dt / CONSTRUCT.buildTime);
    f.height = max(0.5, f.full * f.prog);
    if (f.prog >= 1) G.fx.say('Factory up.');
    return;
  }
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
