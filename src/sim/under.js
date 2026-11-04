import { UNDER } from '../data/construct.js';
import { geoOf } from '../data/geo.js';

// Tunnelling in, part 1 (docs/specs/37-tunnelling.md): where you are under
// the ground, and the mark you follow through it.
const { hypot } = Math;

// The top of a mech's cab (m).
export const cabTop = m => m.y + geoOf(m).height * m.ch.scale;
// Metres of ground over the cab: from its top to the ground's surface
// straight above it. 0 in the open (a pit dug from above has its floor as
// the surface, so it's open too).
export function depthOf(G, m) {
  if (!G.ter) return 0;
  return Math.max(0, G.ter.height(m.x, m.z) - cabTop(m));
}
// Underground: at least UNDER.above of ground over the cab.
export const underground = (G, m) => depthOf(G, m) >= UNDER.above;
// Digging up toward the surface, and near it: SURFACE on the HUD.
export const nearSurface = (G, m) => underground(G, m) && (m.pitch || 0) > UNDER.up && depthOf(G, m) < UNDER.surface;

// The mark: one at a time (`G.mark`), on a thing (a mech or a structure: it
// follows it, and goes when the thing does) or on a spot of ground.
export function setMark(G, at) {
  G.mark = at && at.x != null && (at.kind || at.ch) ? { thing: at } : at ? { x: at.x, z: at.z } : null;
  return G.mark;
}
export const clearMark = G => { G.mark = null; };
// Where the mark is now, [x, y, z], or null (no mark, or its thing is gone,
// which clears it).
export function markAt(G) {
  const k = G.mark;
  if (!k) return null;
  if (k.thing) {
    const t = k.thing;
    if (!t.alive) { G.mark = null; return null; }
    return [t.x, t.y + (t.ch ? geoOf(t).height * t.ch.scale : t.height || 4) / 2, t.z];
  }
  return [k.x, G.ter ? G.ter.height(k.x, k.z) : 0, k.z];
}

// What's above you, underground: every standing structure and live mech
// (not `m`) within UNDER.sense flat, as boxes [x0, y0, z0, x1, y1, z1] with
// whose it is (`foe`: not your team). For the HUD's outlines.
export function above(G, m, out = []) {
  out.length = 0;
  const r = UNDER.sense;
  for (const e of G.entities) {
    if (!e.alive || e.kind !== 'structure' || hypot(e.x - m.x, e.z - m.z) > r) continue;
    const w = e.radius || 3, h = e.height || 6;
    out.push({ box: [e.x - w, e.y, e.z - w, e.x + w, e.y + h, e.z + w], foe: e.team !== m.team });
  }
  for (const o of G.mechs) {
    if (o === m || !o.alive || hypot(o.x - m.x, o.z - m.z) > r) continue;
    const g = geoOf(o), w = g.radius * o.ch.scale, h = g.height * o.ch.scale;
    out.push({ box: [o.x - w, o.y, o.z - w, o.x + w, o.y + h, o.z + w], foe: o.team !== m.team });
  }
  return out;
}
