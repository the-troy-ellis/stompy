import { DIG, WEAPONS } from '../data/weapons.js';
import { sceneryNear } from './entities.js';
import { particle } from './effects.js';

const { hypot, min, round } = Math;

// Digging in play (docs/specs/18-voxel-ground.md § Digging in play, § Sync).
// Every blast that digs comes through `dig`: the ground is carved (soft
// ground to the full radius, the rock band to DIG.rock of it, bedrock not at
// all), scorches, props and structures in reach settle onto what's left, and,
// in a networked game, the dig is queued to go out (net/client.js flushes
// G.pendingDigs with the hits). Only the client that owns a blast digs it:
// another pilot's shell explodes here without digging, and their `digs`
// arrive from the relay. Re-applying a dig changes nothing (carving takes the
// smaller of the ground and the hole), so each client applies every dig the
// relay echoes, its own included, in any order.

// Whether this client decides blasts by `m` (a mech, a turret or null for the
// world): everything in single player; in the arena, your own; in co-op, your
// own, and as host the enemies' and the world's.
export function ownsDigs(G, m) {
  if (G.mode !== 'mp' && (G.role || 'solo') === 'solo') return true;
  if (m) return m === G.player || (!m.remote && G.role === 'host');
  return G.role === 'host';
}
// How big a hole a weapon's hit digs (data/weapons.js `dig`), and a mech's death blast.
export const digOf = type => WEAPONS[type]?.dig || 0;
export const deathDig = m => min(DIG.death * m.ch.scale, DIG.deathMax);

const q = (v, s) => round(v / s) * s;   // on the wire: positions to 0.25 m, radii to 0.5 m
const NEAR = [];

// A blast at `p` digging a hole of radius `r`, if this client owns it.
export function dig(G, p, r, owned = true) {
  if (!(r > 0) || !owned || !G.ter) return;
  const x = q(p[0], 0.25), y = q(p[1], 0.25), z = q(p[2], 0.25), rr = q(r, 0.5);
  // Nothing within reach below it (a missile popping in the air): nothing to dig, nothing to send.
  if (G.ter.groundBelow(x, y + rr, z, y - rr) <= y - rr) return;
  applyDig(G, 0, x, y, z, rr);
  if (G.mode === 'mp' || (G.role || 'solo') !== 'solo') G.pendingDigs.push([0, x, y, z, rr]);
}

// Digs off the wire (the relay's `digs`, or the room's list in `welcome`):
// [seq, op, x, y, z, r] each, in the relay's order. Anything malformed is skipped.
export function applyDigList(G, l) {
  if (!Array.isArray(l) || !G.ter) return;
  for (const d of l) {
    if (!Array.isArray(d) || d.length !== 6 || !d.every(Number.isFinite)) continue;
    const [seq, op, x, y, z, r] = d;
    if (r > 0 && r <= DIG.deathMax) applyDig(G, op, x, y, z, r);
    if (seq > G.digSeq) G.digSeq = seq;
  }
}

// Carve and settle what stands there: for a local dig and for one off the wire.
export function applyDig(G, op, x, y, z, r) {
  if (op !== 0) return;   // carving is all that play does until construction gear exists
  G.ter.dig([x, y, z], r, DIG.rock);
  settle(G, x, z, r);
}

// What stood in reach of a dig: scorches, wrecks and debris move down onto
// the new ground, structures and props settle onto it, and a prop with nothing under it breaks.
function settle(G, x, z, r) {
  const ter = G.ter;
  for (const s of G.scorches) {
    if (hypot(s.x - x, s.z - z) > r + s.r) continue;
    const y = ter.groundBelow(s.x, (s.y ?? ter.height(s.x, s.z)) + 1, s.z);
    if (y !== s.y) { s.y = y; s.v = (s.v || 0) + 1; G.scorchRev++; }
  }
  for (const w of G.wrecks) if (hypot(w.x - x, w.z - z) < r + 4 * w.scale) w.y = Math.min(w.y, ter.groundBelow(w.x, w.y + 1, w.z));
  for (const d of G.debris) if (d.landed && hypot(d.p[0] - x, d.p[2] - z) < r + 1) { d.landed = false; d.bounced = true; }   // it drops onto the new ground
  for (const e of G.entities) {
    if (hypot(e.x - x, e.z - z) > r + e.radius) continue;
    e.y = Math.min(e.y, ter.groundBelow(e.x, e.y + 1, e.z));   // a mission's own structures settle; the host decides if they break
  }
  const n = sceneryNear(G, x, z, r + 8, NEAR);
  for (let i = 0; i < n; i++) {
    const e = NEAR[i];
    if (!e.alive || hypot(e.x - x, e.z - z) > r + e.radius) continue;
    const g = ter.groundBelow(e.x, e.y + 1, e.z), drop = e.y - g;
    if (drop <= 0.05) continue;
    if (drop > PROP_DROP) breakProp(G, e, x, z);
    else e.y = g;
  }
}
// A prop that loses more than this much ground under it breaks instead of settling.
export const PROP_DROP = 3;
function breakProp(G, e, x, z) {
  e.alive = false; e.wreck = true; e.downAt = G.time;
  e.fall = { yaw: Math.atan2(e.x - x, e.z - z), t: 0 };   // over it goes, away from the blast
  const r = G.rng;
  for (let i = 0; i < 6; i++) particle(G, [e.x, e.y + e.height * 0.5, e.z], [r.range(-3, 3), r.range(1, 4), r.range(-3, 3)], r.range(1, 2), r.range(1, 2), [0.3, 0.28, 0.25], 'smoke');
}
