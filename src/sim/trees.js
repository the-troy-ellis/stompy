import { plantTrees, cellsNear, trunkOf } from '../world/forest.js';
import { flatZones } from './objectives.js';
import { TREES } from '../data/forest.js';
import { BX, BZ } from '../world/terrain.js';
import { fellTree } from './pieces.js';
import { rayUpright } from './geom.js';
import { particle } from './effects.js';

// The forest in the sim (docs/specs/39-forest.md): the trees planted for a
// forest match (`G.trees`, world/forest.js), their trunks stopping mechs,
// and trees riding the ground down when it's dug. Part 2 folds saplings,
// lets heavy mechs shove through and fells trees.
const { hypot } = Math;

// A forest match's trees: clear of the start, the mission's zones, its
// structures and every mech's footing. Anything else: none.
export function initTrees(G, def, start) {
  G.trees = null;
  if (G.biome !== 'forest' || !G.ter || G.ter.flat || def.trees === false) return;
  const avoid = [[start.x, start.z, 45], ...flatZones(def).map(([x, z, r]) => [x, z, r + 10]),
    ...G.entities.map(e => [e.x, e.z, e.radius + 20]), ...G.mechs.map(m => [m.x, m.z, 10])];
  G.trees = plantTrees(G.ter.seed, G.ter, { avoid });
}

// Mechs this client owns, against the standing trees (part 2): a sapling a
// mech walks into folds flat; a tree's trunk stops it, unless it's heavy
// enough (TREES.push tons) and going at it, when the tree goes over the way
// it's pushed and the mech slows (TREES.shove). Once a frame, after the
// entities' push.
const NEAR = [0, 0, 0, 0];
export function pushOutOfTrees(G, radiusOf) {
  const T = G.trees;
  if (!T) return;
  for (const m of G.mechs) {
    if (!m.alive || m.remote) continue;
    const rm = radiusOf(m), [x0, x1, z0, z1] = cellsNear(T, m.x, m.z, rm + 1.5, NEAR);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const c = cx + T.nx * cz;
      for (let i = T.start[c]; i < T.start[c + 1]; i++) {
        if (T.state[i] || m.y > T.y[i] + T.h[i]) continue;
        const tr = trunkOf(T, i), dx = m.x - T.x[i], dz = m.z - T.z[i], d2 = dx * dx + dz * dz;
        if (!tr) {   // a sapling: folds under it, the way it's walking
          if (d2 < (rm * 0.8) ** 2) fold(G, i, m.yaw);
          continue;
        }
        const r = rm + tr;
        if (d2 >= r * r) continue;
        if (m.ch.tons >= TREES.push && Math.abs(m.speed) > 1) {   // heavy, and on the move: over it goes
          fellTree(G, i, Math.atan2(-dx, -dz), m);
          m.speed *= TREES.shove;
          continue;
        }
        const d = Math.sqrt(d2), nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
        m.x = T.x[i] + nx * r; m.z = T.z[i] + nz * r;
      }
    }
  }
}

// After a dig: trees in reach sit down onto what's left under them.
export function settleTrees(G, x, z, rad) {
  const T = G.trees;
  if (!T) return;
  const [x0, x1, z0, z1] = cellsNear(T, x, z, rad, NEAR);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const c = cx + T.nx * cz;
    for (let i = T.start[c]; i < T.start[c + 1]; i++) {
      if (hypot(T.x[i] - x, T.z[i] - z) > rad) continue;
      T.y[i] = Math.min(T.y[i], G.ter.groundBelow(T.x[i], T.y[i] + 1, T.z[i]) - 0.3);
    }
  }
}

// A sapling folds flat at once, the way it was pushed: a few leaves.
function fold(G, i, yaw) {
  const T = G.trees;
  T.state[i] = 2; T.fall[i] = ((yaw / (2 * Math.PI)) * 256 + 256) & 255;
  const r = G.rng;
  for (let k = 0; k < 3; k++) particle(G, [T.x[i], T.y[i] + 1.5, T.z[i]], [r.range(-2, 2), r.range(0.5, 2), r.range(-2, 2)], r.range(0.6, 1), r.range(0.4, 0.8), [0.33, 0.49, 0.22], 'debris', 12);
}

// A tree takes `amt` (a punch's, a shell's, a beam's dps * dt): past TREES.hp
// it falls, the way it was hit (`yaw`), credited to `by`. A sapling folds.
export function hurtTree(G, i, amt, by, yaw) {
  const T = G.trees;
  if (!T || T.state[i]) return;
  if (!trunkOf(T, i)) { fold(G, i, yaw); return; }
  const H = (G.treeHurt ||= new Map()), got = (H.get(i) || 0) + amt;
  if (got < TREES.hp) { H.set(i, got); return; }
  H.delete(i);
  fellTree(G, i, yaw, by);
}

// A blast at `p`: every standing tree within `rad` goes over, away from it.
export function fellNear(G, p, rad, by) {
  const T = G.trees;
  if (!T) return;
  const [x0, x1, z0, z1] = cellsNear(T, p[0], p[2], rad, NEAR);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const c = cx + T.nx * cz;
    for (let i = T.start[c]; i < T.start[c + 1]; i++) {
      if (T.state[i]) continue;
      const dx = T.x[i] - p[0], dz = T.z[i] - p[2];
      if (dx * dx + dz * dz > rad * rad || p[1] > T.y[i] + T.h[i] + 2) continue;
      if (!trunkOf(T, i)) fold(G, i, Math.atan2(dx, dz));
      else fellTree(G, i, Math.atan2(dx, dz), by);
    }
  }
}

// The nearest standing trunk along a ray (o, unit d, out to maxT): its t
// and index, into `out`, or null. Trunks are upright cylinders of at least
// TREES.hitR; saplings take nothing. The cells the ray crosses, stepped half
// a cell at a time.
const SEEN = new Set();
export function rayTrees(G, o, d, maxT, out = { t: 0, i: -1 }) {
  const T = G.trees;
  if (!T) return null;
  const C = TREES.cell, steps = Math.ceil(maxT / (C / 2)) + 1;
  let best = Infinity, bi = -1;
  SEEN.clear();
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(maxT, s * C / 2), x = o[0] + d[0] * t, z = o[2] + d[2] * t;
    const cx0 = Math.floor((x + BX) / C), cz0 = Math.floor((z + BZ) / C);
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {   // and round it: a crown's trunk can sit a cell over
      const cx = cx0 + k, cz = cz0 + j;
      if (cx < 0 || cz < 0 || cx >= T.nx || cz >= T.nz) continue;
      const c = cx + T.nx * cz;
      if (SEEN.has(c)) continue;
      SEEN.add(c);
      for (let i = T.start[c]; i < T.start[c + 1]; i++) {
        if (T.state[i]) continue;
        const tr = trunkOf(T, i);
        if (!tr) continue;
        const h = rayUpright(o, d, T.x[i], T.y[i], T.z[i], Math.max(tr, TREES.hitR), T.h[i]);
        if (h != null && h <= maxT && h < best) { best = h; bi = i; }
      }
    }
    if (t >= maxT || best <= t) break;
  }
  if (bi < 0) return null;
  out.t = best; out.i = bi;
  return out;
}
