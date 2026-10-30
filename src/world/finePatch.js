import { HALF } from './terrain.js';

const { max, min } = Math;

// Fine digging that settles (docs/specs/27-fine-dig.md). Where the ground is
// dug in play, a patch of FS-metre cells (four to the map's 8 m) holds the
// dug ground finely, so a scoop or a blast leaves a round bite. A patch is a
// box of whole coarse cells, [i0..i1] × [j0..j1] × [k0..k1] in coarse corners,
// with a density byte every FS metres in it, coded as the coarse grid's
// (world/voxels.js: above 128 solid). Every edit goes into the coarse grid as
// before and into each patch it reaches; the ground's `sample` reads the
// newest patch a point is in. When a patch settles (sim/dig.js), `blend` runs
// 0 to 1 and the patch reads more and more as the coarse ground, then goes.
// The grid's own numbers (cell size, origin) come in `g`, the ground's
// `grid`, so this file never imports voxels.js back.
export const FS = 2;
export const PATCH = { margin: 2, maxSide: 16, max: 6 };   // coarse cells (4 m); maxSide in x and z

let SEQ = 0;

// A new patch over coarse corners [i0..i1] × [j0..j1] × [k0..k1], keeping
// `old`'s bytes where they overlap (a patch growing). The rest are the
// caller's to read from the ground (world/voxels.js fillPatch); `p.keep`
// says which: [oi, oj, ok, old] or null.
export function makePatch(g, b, old = null) {
  const [i0, i1, j0, j1, k0, k1] = b, R = g.VS / FS;
  const nx = (i1 - i0) * R + 1, ny = (j1 - j0) * R + 1, nz = (k1 - k0) * R + 1;
  const p = {
    id: old ? old.id : ++SEQ, i0, i1, j0, j1, k0, k1, nx, ny, nz, D: new Uint8Array(nx * ny * nz), top: new Float32Array(nx * nz),
    x0: -HALF + i0 * g.VS, y0: g.Y0 + j0 * g.VS, z0: -HALF + k0 * g.VS, x1: -HALF + i1 * g.VS, y1: g.Y0 + j1 * g.VS, z1: -HALF + k1 * g.VS,
    blend: 0, edits: old ? old.edits : 0, rev: old ? old.rev + 1 : 0, at: old ? old.at : null, keep: null,
  };
  if (old) {
    const oi = (old.i0 - i0) * R, oj = (old.j0 - j0) * R, ok = (old.k0 - k0) * R;
    for (let k = 0; k < old.nz; k++) for (let j = 0; j < old.ny; j++) {
      const from = old.nx * (j + old.ny * k);
      p.D.set(old.D.subarray(from, from + old.nx), oi + nx * (j + oj + ny * (k + ok)));
    }
    p.keep = [oi, oj, ok, old];
  }
  return p;
}

export const inPatch = (p, x, y, z) => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1 && z >= p.z0 && z < p.z1;
export const overXZ = (p, x, z) => x >= p.x0 && x < p.x1 && z >= p.z0 && z < p.z1;
export const contains = (p, b) => b[0] >= p.i0 && b[1] <= p.i1 && b[2] >= p.j0 && b[3] <= p.j1 && b[4] >= p.k0 && b[5] <= p.k1;
export const overlaps = (p, b) => b[0] < p.i1 && b[1] > p.i0 && b[2] < p.j1 && b[3] > p.j0 && b[4] < p.k1 && b[5] > p.k0;
export const union = (p, b) => [min(p.i0, b[0]), max(p.i1, b[1]), min(p.j0, b[2]), max(p.j1, b[3]), min(p.k0, b[4]), max(p.k1, b[5])];
export const fits = b => b[1] - b[0] <= PATCH.maxSide && b[5] - b[4] <= PATCH.maxSide;

// The ground at a point inside a patch: its own corners' density by trilinear
// blend, but never rock where `c` (the map's 8 m ground there, which the
// caller samples: a number, not a function, so nothing on this hot path is
// boxed) is air. So the fine ground is the 8 m ground with round bites out of it,
// whatever order the digs came in: what's open on one is open on the other,
// ore (counted on the 8 m corners, sim/dig.js bite) is never counted twice,
// and a settle only fills the bites back in. Settling, it blends toward the
// 8 m ground by `blend`.
export function patchSample(p, x, y, z, c) {
  const fx = (x - p.x0) / FS, fy = (y - p.y0) / FS, fz = (z - p.z0) / FS, nx = p.nx, nxy = nx * p.ny, D = p.D;
  const i = min(fx | 0, nx - 2), j = min(fy | 0, p.ny - 2), k = min(fz | 0, p.nz - 2), u = fx - i, v = fy - j, w = fz - k;
  const o = i + nx * j + nxy * k, oy = o + nx, oz = o + nxy, oyz = oz + nx;
  const a = (D[o] * (1 - u) + D[o + 1] * u) * (1 - v) + (D[oy] * (1 - u) + D[oy + 1] * u) * v;
  const b = (D[oz] * (1 - u) + D[oz + 1] * u) * (1 - v) + (D[oyz] * (1 - u) + D[oyz + 1] * u) * v;
  const d = min(((a * (1 - w) + b * w) - 128) / 127, c);
  return p.blend > 0 ? d + (c - d) * p.blend : d;
}

// A patch's top at (x, z), blended between its fine columns.
export function patchHeight(p, x, z) {
  const gx = min(max((x - p.x0) / FS, 0), p.nx - 1 - 1e-4), gz = min(max((z - p.z0) / FS, 0), p.nz - 1 - 1e-4);
  const i = gx | 0, k = gz | 0, u = gx - i, w = gz - k, o = i + p.nx * k, T = p.top;
  return (T[o] * (1 - u) + T[o + 1] * u) * (1 - w) + (T[o + p.nx] * (1 - u) + T[o + p.nx + 1] * u) * w;
}
