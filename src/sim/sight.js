// Line of sight over the terrain (docs/specs/15-mission-editor.md § Shared
// parts): one test, used by the AI to see the player and to pick cover, and
// by the mission editor to shade what a foe can see. A point is seen when
// the straight line to it clears the ground (geom.js's rayTerrain).
import { norm, sub, len } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { rayTerrain } from './geom.js';

// Where a mech's eyes would be if it stood at (x, z).
export const eyeAt = (G, e, x, z) => [x, G.ter.height(x, z) + geoOf(e).eye[1] + geoOf(e).torsoY * e.ch.scale, z];
// The ground (not mechs or props) between two points.
export const blocked = (G, from, to) => { const d = sub(to, from), L = len(d); return rayTerrain(G, from, norm(d), L) != null; };

// What can be seen from `eye` out to `range` m, on a grid of `cell` m: the
// middle of each cell, `above` m over the ground (a mech's middle), in
// [{ x, z, seen }], only for cells inside the range. Worked out on demand,
// never per frame: a 600 m range on 30 m cells is about 1,300 rays.
export function sightGrid(G, eye, range, { cell = 30, above = 4.2 } = {}) {
  const out = [], n = Math.ceil(range / cell);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const x = eye[0] + i * cell, z = eye[2] + j * cell;
    if (Math.hypot(x - eye[0], z - eye[2]) > range) continue;
    out.push({ x, z, seen: !blocked(G, eye, [x, G.ter.height(x, z) + above, z]) });
  }
  return out;
}
