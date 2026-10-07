import { add, mix3, mul, norm, sub } from '../util/math.js';
import { muzzle, rayHit } from './geom.js';
import { damage } from './combat.js';
import { damageEntity } from './entities.js';
import { particle } from './effects.js';
import { hitQueue } from './hitqueue.js';

const { min, max } = Math;

// Lasers: continuous beams whose damage climbs while they stay on target.
// The ramp lives in the target, not the shooter: a mech's armour "melt"
// rises while any beam is on it (once per frame, however many beams) and
// cools whenever nothing is hitting it, whoever is aiming where. Damage is
// dps x meltMult(target). Two pilots on one mech share its melt.
export const MELT_T = 3;         // seconds of beam to melt armour fully
export const MELT_MAX = 3.5;     // damage multiplier at full melt
export const MELT_COOL = 1.5;    // melt-seconds lost per second off the beam: full to cold in 2 s
export const meltMult = t => 1 + (MELT_MAX - 1) * (t => t * t * (3 - 2 * t))(min(1, t / MELT_T));
export const meltFrac = m => min(1, (m?.melt || 0) / MELT_T);
export const beamMult = m => (m.beamMech ? meltMult(m.beamMech.melt || 0) : 1);

// One frame of a mech's lasers firing at `aim`: every live laser draws a
// beam to whatever it hits and costs heat; a mech it hits takes damage
// scaled by that mech's melt, and its melt goes up.
export function beamTick(G, m, dt, aim) {
  const lasers = m.weapons.filter(w => w.def.kind === 'beam' && !w.dead), r = G.rng;
  if (!lasers.length || m.shutdown || !m.alive) { m.beaming = false; m.beamMech = null; return; }
  if (!m.beaming) beamSound(G, m, lasers, m === G.player ? null : muzzle(m, lasers[0]));
  m.beaming = true;
  m.beamEnd = aim;
  m.beamMech = null;
  for (const w of lasers) {
    const mz = muzzle(m, w), dir = norm(sub(aim, mz));
    const hit = rayHit(G, mz, dir, w.def.range, m);
    const end = hit ? hit.point : add(mz, mul(dir, w.def.range));
    const t = hit?.mech, mult = t ? meltMult(t.melt || 0) : 1;
    if (w.def.cone) flameCone(G, mz, end, w.def); else drawBeam(G, mz, end, w.def, mult);
    m.heat += w.def.hps * dt;
    if (m === G.player) G.stats.shots += dt * 4;   // accuracy counts beam time in quarter-seconds
    if (!hit) continue;
    if (r.chance(dt * 25)) particle(G, end, [r.range(-3, 3), r.range(1, 5), r.range(-3, 3)], 0.25, 0.3 + 0.1 * mult, w.def.col, 'fire');
    if (hit.ent) damageEntity(G, hit.ent, w.def.dps * dt, m, end);   // structures don't melt: plain dps
    if (t) {
      m.beamMech = t;
      damage(G, t, end, w.def.dps * mult * dt, m, true);
      if (w.def.targetHeat) toast(G, t, w.def.targetHeat * dt);
      // Melt rises once per frame however many beams are on it, at the fastest rate among them.
      const rate = w.def.meltRate || 1;
      if (t.meltFrame !== G.frame) { t.meltFrame = G.frame; t.meltRate = rate; t.melt = min(MELT_T, (t.melt || 0) + dt * rate); }
      else if (rate > t.meltRate) { t.melt = min(MELT_T, t.melt + dt * (rate - t.meltRate)); t.meltRate = rate; }
      t.meltAt = G.time;
      if (m === G.player) G.stats.hits += dt * 4;
    }
  }
}
// Heat poured into a target (TOASTER). Another pilot's heat is theirs to
// apply: it rides the batched hit as hh.
export function toast(G, t, amt) {
  if (!t.remote) { t.heat += amt; return; }
  const q = hitQueue(G, t);
  if (q) q.hh = (q.hh || 0) + amt;
}
// The start-of-fire sound: each recipe among the beams once (TOASTER's
// roar), and one laser zap for the rest, small for the light ones.
function beamSound(G, m, lasers, at) {
  for (const k of new Set(lasers.map(w => w.def.sfx).filter(Boolean))) G.fx.sfx[k](at);
  const l = lasers.find(w => !w.def.sfx);
  if (l) G.fx.sfx.laser(at, l.def.tons < 5);
}
// A flamer draws no line: a cone of fire puffs from the muzzle that spread
// and reach the end in about a fifth of a second.
export function flameCone(G, a, b, def) {
  const r = G.rng, d = sub(b, a), life = 0.22;
  for (let i = 0; i < 3; i++) {
    const v = add(mul(d, r.range(0.75, 1.05) / life), [r.range(-9, 9), r.range(-3, 7), r.range(-9, 9)]);
    particle(G, add(a, mul(d, r.range(0, 0.15))), v, life, r.range(0.45, 0.8), mix3(def.col, [1, 0.9, 0.4], r.next()), 'flame');
  }
}
// Armour cools whenever no beam touched it this frame.
export function coolArmour(G, dt) {
  for (const m of G.mechs) if (m.melt && m.meltAt !== G.time) m.melt = max(0, m.melt - MELT_COOL * dt);
}
// A beam lasts one frame; it's redrawn every frame it's on. Thicker and
// whiter as the focus climbs.
export function drawBeam(G, a, b, def, mult) {
  const k = (mult - 1) / (MELT_MAX - 1);
  const stut = def.stutter && Math.sin(G.time * Math.PI * 2 * def.stutter) < 0 ? 0.35 : 1;   // a stuttering beam thins on the off-beat
  G.cbeams.push({ a, b, col: mix3(def.col, [1, 1, 1], 0.2 + 0.45 * k), w: def.w * (0.8 + 0.9 * k) * G.rng.range(0.85, 1.15) * stut });
}
// Another pilot's beam, drawn from their lasers to where they say it ends.
// Visual only: their client scores it.
export function remoteBeam(G, m, end) {
  const lasers = m.weapons.filter(w => w.def.kind === 'beam' && m.hp[w.mount] > 0), r = G.rng;
  if (!lasers.length) return;
  if (!m.beaming) beamSound(G, m, lasers, muzzle(m, lasers[0]));
  m.beaming = true;
  for (const w of lasers) {
    const mz = muzzle(m, w);
    if (w.def.cone) flameCone(G, mz, add(mz, mul(norm(sub(end, mz)), Math.min(w.def.range, Math.hypot(...sub(end, mz))))), w.def);
    else drawBeam(G, mz, end, w.def, m.net.bf || 1);   // bf: how melted their target is
  }
  if (r.chance(0.4)) particle(G, end, [r.range(-3, 3), r.range(1, 5), r.range(-3, 3)], 0.25, 0.4, lasers[0].def.col, 'fire');
}
