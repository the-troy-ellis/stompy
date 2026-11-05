import { UNDER } from '../data/construct.js';
import { geoOf } from '../data/geo.js';
import { damageEntity } from './entities.js';
import { feel } from './feel.js';
import { particle } from './effects.js';
import { alertEnemy } from './ai/perception.js';
import { diffOf } from '../data/ai.js';
import { mechsNear } from './near.js';

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

// Tunnels on the map (part 2): while a crew mech is underground, a point
// every UNDER.trail moved, one line per stretch underground
// (`G.tunnels = [{ m, pts: [[x, y, z], ...], open }]`); surfacing ends it.
// At most UNDER.points in all, the oldest dropped first. Once a frame.
export function stepTunnels(G) {
  if (!G.crew) return;
  const T = (G.tunnels ||= []);
  for (const m of G.crew) {
    let line = null;
    for (let i = T.length - 1; i >= 0; i--) if (T[i].m === m && T[i].open) { line = T[i]; break; }
    if (!m.alive || !underground(G, m)) { if (line) line.open = false; continue; }
    if (!line) { line = { m, pts: [], open: true }; T.push(line); }
    const last = line.pts[line.pts.length - 1];
    if (!last || hypot(m.x - last[0], m.z - last[2], m.y - last[1]) >= UNDER.trail) { line.pts.push([m.x, m.y, m.z]); G.tunnelPts = (G.tunnelPts || 0) + 1; }
  }
  while ((G.tunnelPts || 0) > UNDER.points && T.length) {
    T[0].pts.shift(); G.tunnelPts--;
    if (!T[0].pts.length) T.shift();
  }
}

// Undermining (part 3): a structure whose footprint lost its ground. After a
// dig, each structure within its reach has five points tested just under
// its base (its middle and four corners at UNDER.inset of its radius);
// with fewer than UNDER.hold solid, it falls to the ground under its middle
// and loses UNDER.dropHp of its full hp plus UNDER.perM a metre fallen. If
// that brings it down, it topples toward the side with least under it.
// One still held up stays where it is (a hole under its middle alone
// doesn't sink it). `by`: whoever dug, for the kill and the voice.
const FOOT = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export function undermine(G, x, z, r, by = null) {
  const ter = G.ter;
  for (const e of G.entities) {
    if (e.kind !== 'structure' || !e.alive || e.fall || hypot(e.x - x, e.z - z) > r + e.radius) continue;
    const k = e.radius * UNDER.inset, y0 = e.y - 0.5;
    let held = 0, ax = 0, az = 0;
    for (const [u, v] of FOOT) {
      if (ter.solid(e.x + u * k, y0, e.z + v * k)) held++;
      else { ax += u; az += v; }   // toward what's gone
    }
    if (held >= UNDER.hold) continue;
    const floor = ter.groundBelow(e.x, y0, e.z), drop = e.y - floor;
    if (!(drop > 0.25)) continue;
    e.y = floor;
    thud(G, e, drop);
    if (!Number.isFinite(e.hp) || G.role === 'guest') continue;   // scenery doesn't break; in co-op the host decides
    const yaw = ax || az ? Math.atan2(ax, az) : e.yaw;
    damageEntity(G, e, e.max * Math.min(1, UNDER.dropHp + UNDER.perM * drop) + 1e-6, by, null, { punch: true, yaw });
    if (!e.alive && by === G.player) G.fx.say('It fell over.');
  }
}
// The thunk of a building landing in its hole: felt as a landing, by how near
// you are and how big it is, and its dust.
function thud(G, e, drop) {
  const P = G.player, near = P ? Math.max(0, 1 - hypot(P.x - e.x, P.z - e.z) / 120) : 0, at = [e.x, e.y, e.z];
  if (near > 0) feel(G, 'land', { mech: null, k: near * Math.min(1, 0.4 + e.height / 20 + drop / 20), at });
  G.fx.sfx.settle?.(at);
  const n = 10 + Math.round(e.radius * 2);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, v = G.rng.range(3, 7);
    particle(G, [e.x + Math.sin(a) * e.radius, e.y + 0.5, e.z + Math.cos(a) * e.radius], [Math.sin(a) * v, G.rng.range(0.5, 3), Math.cos(a) * v], G.rng.range(1.2, 2.2), G.rng.range(1.5, 3), G.pal.low, 'dust');
  }
}

// Being heard (part 4): a crew digger's bite underground at `p` is heard by
// foes within UNDER.hear, as a point up to UNDER.blur off. By difficulty
// (data/ai.js DIFF.hear): 'none' nothing; 'look' each becomes aware and
// believes you're there (searching, it comes to look); 'wait' that, and the
// nearest goes to the spot itself, unblurred, to be there when you come up.
// A foe that can see you keeps what it sees. The player hears `They heard
// you.` once a tunnel, on 'wait'.
const BY = [];
export function heard(G, m, p) {
  const how = diffOf(G).hear;
  if (!how || how === 'none' || !underground(G, m)) return;
  const n = mechsNear(G, p[0], p[2], UNDER.hear, BY);
  let near = null, nd = Infinity;
  for (let i = 0; i < n; i++) {
    const e = BY[i];
    if (e.team === m.team || !e.alive || !e.ai || e.ai.seen) continue;
    const d = hypot(e.x - p[0], e.z - p[2]);
    if (d > UNDER.hear) continue;
    const a = G.rng.range(0, Math.PI * 2), r = G.rng.range(0, UNDER.blur), at = [p[0] + Math.sin(a) * r, p[1], p[2] + Math.cos(a) * r];
    alertEnemy(G, e, m, at);
    e.ai.belief = { x: at[0], z: at[2], vx: 0, vz: 0, at: G.time };
    if (d < nd) { near = e; nd = d; }
  }
  if (how !== 'wait' || !near) return;
  near.ai.belief = { x: p[0], z: p[2], vx: 0, vz: 0, at: G.time };
  near.ai.state = 'search'; near.ai.searchT = 0;
  near.ai.waitAt = { x: p[0], z: p[2], until: G.time + UNDER.wait };   // off to the spot, to stand over it (sim/ai.js)
  const line = (G.tunnels || []).find(t => t.m === m && t.open);
  if (m === G.player && !(line ? line.heard : m.heardSaid)) { G.fx.say('They heard you.'); if (line) line.heard = true; else m.heardSaid = true; }
}
