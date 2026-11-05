import { plantTrees, cellsNear, trunkOf } from '../world/forest.js';
import { flatZones } from './objectives.js';

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

// Mechs this client owns are pushed off standing trunks (saplings fold:
// part 2 lays them flat). Once a frame, after the entities' push.
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
        if (T.state[i]) continue;
        const tr = trunkOf(T, i);
        if (!tr || m.y > T.y[i] + T.h[i]) continue;
        const dx = m.x - T.x[i], dz = m.z - T.z[i], r = rm + tr, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
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
