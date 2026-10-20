import { Builder } from '../mesh/builder.js';
import { M, chain, clampN, mul } from '../util/math.js';
import { N, CELL, HALF, BOUND } from './terrain.js';
import { outposts } from './props.js';

const { hypot } = Math;

// What stands on the ground, baked: the rocks and the abandoned outposts (the
// ground itself is voxels: world/voxels.js, world/mesher.js). Cut into
// CHUNKS × CHUNKS squares, each its own mesh with a box, so the renderer skips
// the ones out of view or past the fog (spec 11, the performance pass).
export const CHUNKS = 4, CHUNK_CELLS = N / CHUNKS;

// [{ b, lo, hi (the box), c, r (the sphere round it) }], row by row from -HALF.
export function buildGroundExtras(ter, pal, seed) {
  const size = CHUNK_CELLS * CELL;
  const chunks = [];
  for (let k = 0; k < CHUNKS * CHUNKS; k++) chunks.push({ b: new Builder() });
  const idx = v => clampN(Math.floor((v + HALF) / size), 0, CHUNKS - 1);
  const at = (x, z) => chunks[idx(z) * CHUNKS + idx(x)].b;
  let s = seed * 9301 + 49297;
  const r01 = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let k = 0; k < N * N * 2; k++) r01();   // the old height mesh's colours came off this sequence first: the rocks stay where they were
  // Rocks.
  for (let k = 0; k < 150; k++) {
    const x = (r01() - 0.5) * 2 * BOUND, z = (r01() - 0.5) * 2 * BOUND;
    if (hypot(x, z) < 60) continue;
    const sz = 2 + r01() * 7;
    at(x, z).cube(chain(M.T(x, ter.height(x, z) + sz * 0.15, z), M.RY(r01() * 6), M.RX((r01() - 0.5) * 0.6),
      M.S(sz, sz * (0.5 + r01() * 0.8), sz * (0.7 + r01() * 0.6))), mul(pal.rock, 0.85 + r01() * 0.3), 0.55 + r01() * 0.3, 0.55 + r01() * 0.3);
  }
  // A few abandoned outposts.
  for (const { blocks, tower } of outposts(seed)) {   // the props cluster round them (world/props.js)
    for (const { x, z, w, h: hgt, d: dd, g, yaw } of blocks) {
      const base = ter.height(x, z) - 2;
      at(x, z).cube(chain(M.T(x, base + hgt / 2, z), M.RY(yaw), M.S(w, hgt, dd)), [g, g * 0.97, g * 0.93], 0.97, 0.97);
      at(x, z).cube(chain(M.T(x, base + hgt + 0.6, z), M.S(w * 0.6, 1.2, dd * 0.6)), [g * 0.6, g * 0.6, g * 0.6]);
    }
    const tx = tower.x, tz = tower.z, tb = ter.height(tx, tz);
    at(tx, tz).cube(chain(M.T(tx, tb + 22, tz), M.S(1.4, 44, 1.4)), [0.35, 0.33, 0.3], 0.4, 0.4);
    at(tx, tz).cube(chain(M.T(tx, tb + 44, tz), M.S(2.5, 1, 2.5)), [0.9, 0.15, 0.1]);
  }
  // Each chunk's bounds, from what is actually in it.
  for (const ch of chunks) {
    const d = ch.b.d;
    if (!d.length) { ch.lo = ch.hi = ch.c = [0, 0, 0]; ch.r = 0; continue; }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let o = 0; o < d.length; o += 9) for (let k = 0; k < 3; k++) { if (d[o + k] < lo[k]) lo[k] = d[o + k]; if (d[o + k] > hi[k]) hi[k] = d[o + k]; }
    ch.c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    ch.r = hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    ch.lo = lo; ch.hi = hi;
  }
  return chunks;
}
