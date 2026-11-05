import { makeRng } from '../sim/rng.js';
import { BX, BZ } from './terrain.js';
import { TREES, TREE_KINDS } from '../data/forest.js';

// The forest's trees (docs/specs/39-forest.md part 1): not entities and not
// voxels but a field of typed arrays, a few bytes a tree, from the seed and
// nothing else, so every client of a seed has the same woods. Thick woods on
// a jittered grid TREES.gap apart, thinned by a noise field into clearings,
// cut by a few straight old roads, and kept off steep ground and out of
// `avoid` (circles [x, z, r]: the start, a mission's zones and structures).
// Kept sorted by TREES.cell cells (`start[c]..start[c + 1]`), so what's near
// a point is a few cells' runs. `state`: 0 standing (part 2 fells them).
const { sin, cos, hypot, floor, max, min, PI } = Math;

export function plantTrees(seed, ter, { avoid = [] } = {}) {
  const r = makeRng(seed * 23 + 11), C = TREES.cell, s = (seed % 1009) * 0.61;
  const nx = Math.ceil((2 * BX) / C), nz = Math.ceil((2 * BZ) / C);
  const roads = Array.from({ length: TREES.paths }, () => { const a = r.range(0, PI), x = r.range(-BX, BX) * 0.6, z = r.range(-BZ, BZ) * 0.6; return [x, z, sin(a), cos(a)]; });
  const clearing = (x, z) => sin(x * 0.021 + s) + sin(z * 0.019 - s * 1.3) + 0.8 * sin((x + z) * 0.013 + s * 2.1) + 0.5 * sin((x - z) * 0.031 - s);
  const onRoad = (x, z) => roads.some(([rx, rz, dx, dz]) => Math.abs((x - rx) * dz - (z - rz) * dx) < TREES.pathW / 2);
  const kept = (x, z) => {
    if (Math.abs(x) > BX - 4 || Math.abs(z) > BZ - 4) return false;
    if (clearing(x, z) < TREES.clear) return false;
    if (onRoad(x, z)) return false;
    for (const [ax, az, ar] of avoid) if (hypot(x - ax, z - az) < ar) return false;
    const h = ter.height(x, z), d = 2;
    return max(Math.abs(ter.height(x + d, z) - h), Math.abs(ter.height(x, z + d) - h)) / d < TREES.slope;
  };
  const per = max(1, floor(C / TREES.gap)), step = C / per;
  const cap = nx * nz * per * per;
  const X = new Float32Array(cap), Y = new Float32Array(cap), Z = new Float32Array(cap), R = new Float32Array(cap), H = new Float32Array(cap);
  const K = new Uint8Array(cap), YAW = new Uint8Array(cap), TINT = new Uint8Array(cap), start = new Int32Array(nx * nz + 1);
  const shares = TREE_KINDS.map(k => TREES.kinds[k].share), total = shares.reduce((a, b) => a + b, 0);
  let n = 0;
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) {
    start[cx + nx * cz] = n;
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const x = -BX + cx * C + (i + r.range(0.15, 0.85)) * step, z = -BZ + cz * C + (j + r.range(0.15, 0.85)) * step;
      let u = r.next() * total, k = 0;
      while (k < shares.length - 1 && u >= shares[k]) { u -= shares[k]; k++; }
      const kind = TREES.kinds[TREE_KINDS[k]], sz = r.next(), tint = r.next(), yaw = r.next();   // drawn whether kept or not: a tree's dice don't depend on its neighbours
      if (!kept(x, z)) continue;
      X[n] = x; Z[n] = z; Y[n] = ter.height(x, z) - 0.3;
      R[n] = kind.r[0] + (kind.r[1] - kind.r[0]) * sz; H[n] = kind.h[0] + (kind.h[1] - kind.h[0]) * sz;
      K[n] = k; YAW[n] = floor(yaw * 256); TINT[n] = floor(tint * 256);
      n++;
    }
  }
  start[nx * nz] = n;
  return { n, nx, nz, x: X.subarray(0, n), y: Y.subarray(0, n), z: Z.subarray(0, n), r: R.subarray(0, n), h: H.subarray(0, n),
    kind: K.subarray(0, n), yaw: YAW.subarray(0, n), tint: TINT.subarray(0, n), state: new Uint8Array(n), start };
}

// The cells within `rad` of (x, z), as [c0x, c1x, c0z, c1z] into `out`.
export function cellsNear(T, x, z, rad, out = [0, 0, 0, 0]) {
  const C = TREES.cell;
  out[0] = max(0, floor((x - rad + BX) / C)); out[1] = min(T.nx - 1, floor((x + rad + BX) / C));
  out[2] = max(0, floor((z - rad + BZ) / C)); out[3] = min(T.nz - 1, floor((z + rad + BZ) / C));
  return out;
}
// A tree's trunk (m): what stops a mech, bigger on a bigger tree of its
// kind; 0 for a sapling, which folds.
export function trunkOf(T, i) {
  const k = TREES.kinds[TREE_KINDS[T.kind[i]]], f = (T.h[i] - k.h[0]) / (k.h[1] - k.h[0] || 1);
  return k.trunk * (0.8 + 0.4 * f);
}
