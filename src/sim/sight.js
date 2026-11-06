// Line of sight over the terrain (docs/specs/15-mission-editor.md § Shared
// parts): one test, used by the AI to see the player and to pick cover, and
// by the mission editor to shade what a foe can see. A point is seen when
// the straight line to it clears the ground (geom.js's rayTerrain).
import { norm, sub, len } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { rayTerrain } from './geom.js';
import { woodsAt } from '../world/forest.js';
import { TREES } from '../data/forest.js';
import { fogOf } from '../data/weather.js';

// Where a mech's eyes would be if it stood at (x, z).
export const eyeAt = (G, e, x, z) => [x, G.ter.height(x, z) + geoOf(e).eye[1] + geoOf(e).torsoY * e.ch.scale, z];
// The ground (not mechs or props) between two points.
export const blocked = (G, from, to) => { const d = sub(to, from), L = len(d); return rayTerrain(G, from, norm(d), L) != null; };

// The woods between two points (docs/specs/39-forest.md part 3): the metres
// of standing forest along the line, from the density grid every 8 m (the
// ends' own 4 m left out, so a mech at the woods' edge isn't in them).
const STEP = 8;
export function woodsBetween(G, from, to) {
  const T = G.trees;
  if (!T) return 0;
  const dx = to[0] - from[0], dz = to[2] - from[2], L = Math.hypot(dx, dz);
  let m = 0;
  for (let t = STEP / 2; t < L - STEP / 2 + 1e-6; t += STEP) m += STEP * woodsAt(T, from[0] + dx * t / L, from[2] + dz * t / L);
  return m;
}
// What's left of a sight range looking through them: each 10 m of woods
// takes TREES.hide off. 60 m of thick woods leaves about 40%.
export const woodsCut = (G, from, to) => (G.trees ? (1 - TREES.hide) ** (woodsBetween(G, from, to) / 10) : 1);
// Seen from `from` at `to`, with a sight range of `range` m: near enough
// through the woods in between, and the ground not in the way.
export function sees(G, from, to, range) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  if (d > range || d > range * woodsCut(G, from, to)) return false;
  return !blocked(G, from, to);
}

// The pilot's own sight: the target brackets and enemy chevrons show out to
// 1.2x what the fog lets you see (spec 07; in clear weather that is past the
// radar anyway), and in the woods (spec 39) only as far as they let you:
// `inView` is that for a mech or a structure `m` from `eye`. No hills: the
// HUD has always drawn through them.
const FOG_TMP = [0, 0];
export const sightLine = G => (G.pal ? fogOf(G, FOG_TMP)[1] * 1.2 : Infinity);
const MID = [0, 0, 0];
export function inView(G, eye, m, range = sightLine(G)) {
  const d = Math.hypot(m.x - eye[0], m.z - eye[2]);
  if (d >= range) return false;
  if (!G.trees) return true;
  MID[0] = m.x; MID[1] = m.y; MID[2] = m.z;
  return d < range * woodsCut(G, eye, MID);
}

// What can be seen from `eye` out to `range` m, on a grid of `cell` m: the
// middle of each cell, `above` m over the ground (a mech's middle), through
// the woods as well as over the hills (spec 39), in
// [{ x, z, seen }], only for cells inside the range. Worked out on demand,
// never per frame: a 600 m range on 30 m cells is about 1,300 rays.
export function sightGrid(G, eye, range, { cell = 30, above = 4.2 } = {}) {
  const out = [], n = Math.ceil(range / cell);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const x = eye[0] + i * cell, z = eye[2] + j * cell;
    if (Math.hypot(x - eye[0], z - eye[2]) > range) continue;
    const p = [x, G.ter.height(x, z) + above, z];
    out.push({ x, z, seen: Math.hypot(x - eye[0], z - eye[2]) <= range * woodsCut(G, eye, p) && !blocked(G, eye, p) });
  }
  return out;
}
