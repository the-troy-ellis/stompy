import { HALF } from './terrain.js';

const { floor, ceil, max, min } = Math;

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
export const PATCH = { margin: 1, maxSide: 8, max: 6 };   // coarse cells; maxSide in x and z

const Q = d => (d <= -1 ? 1 : d >= 1 ? 255 : Math.round(d * 127) + 128);   // voxels.js's coding
let SEQ = 0;

// A new patch over coarse corners [i0..i1] × [j0..j1] × [k0..k1], its
// densities read from `read(x, y, z)` (the ground as it reads now), or kept
// from `old` where they overlap (a patch growing).
export function makePatch(g, b, read, old = null) {
  const [i0, i1, j0, j1, k0, k1] = b, R = g.VS / FS;
  const nx = (i1 - i0) * R + 1, ny = (j1 - j0) * R + 1, nz = (k1 - k0) * R + 1;
  const p = {
    id: old ? old.id : ++SEQ, i0, i1, j0, j1, k0, k1, nx, ny, nz, D: new Uint8Array(nx * ny * nz), top: new Float32Array(nx * nz),
    x0: -HALF + i0 * g.VS, y0: g.Y0 + j0 * g.VS, z0: -HALF + k0 * g.VS, x1: -HALF + i1 * g.VS, y1: g.Y0 + j1 * g.VS, z1: -HALF + k1 * g.VS,
    blend: 0, edits: old ? old.edits : 0, rev: old ? old.rev + 1 : 0, at: old ? old.at : null, born: old ? old.born : null,
  };
  const oi = old ? (old.i0 - i0) * R : 0, oj = old ? (old.j0 - j0) * R : 0, ok = old ? (old.k0 - k0) * R : 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = i - oi, b2 = j - oj, c = k - ok, o = i + nx * (j + ny * k);
    if (old && a >= 0 && b2 >= 0 && c >= 0 && a < old.nx && b2 < old.ny && c < old.nz) p.D[o] = old.D[a + old.nx * (b2 + old.ny * c)];
    else p.D[o] = Q(read(p.x0 + i * FS, p.y0 + j * FS, p.z0 + k * FS));
  }
  return p;
}

export const inPatch = (p, x, y, z) => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1 && z >= p.z0 && z < p.z1;
export const overXZ = (p, x, z) => x >= p.x0 && x < p.x1 && z >= p.z0 && z < p.z1;
export const contains = (p, b) => b[0] >= p.i0 && b[1] <= p.i1 && b[2] >= p.j0 && b[3] <= p.j1 && b[4] >= p.k0 && b[5] <= p.k1;
export const overlaps = (p, b) => b[0] < p.i1 && b[1] > p.i0 && b[2] < p.j1 && b[3] > p.j0 && b[4] < p.k1 && b[5] > p.k0;
export const union = (p, b) => [min(p.i0, b[0]), max(p.i1, b[1]), min(p.j0, b[2]), max(p.j1, b[3]), min(p.k0, b[4]), max(p.k1, b[5])];
export const fits = b => b[1] - b[0] <= PATCH.maxSide && b[5] - b[4] <= PATCH.maxSide;

// A patch's own density at a point inside it, by trilinear blend of its
// corners; while it settles, blended toward `coarse(x, y, z)` (the map's 8 m
// ground there) by `blend`.
export function patchSample(p, x, y, z, coarse) {
  const fx = (x - p.x0) / FS, fy = (y - p.y0) / FS, fz = (z - p.z0) / FS, nx = p.nx, nxy = nx * p.ny, D = p.D;
  const i = min(fx | 0, nx - 2), j = min(fy | 0, p.ny - 2), k = min(fz | 0, p.nz - 2), u = fx - i, v = fy - j, w = fz - k;
  const o = i + nx * j + nxy * k, oy = o + nx, oz = o + nxy, oyz = oz + nx;
  const a = (D[o] * (1 - u) + D[o + 1] * u) * (1 - v) + (D[oy] * (1 - u) + D[oy + 1] * u) * v;
  const b = (D[oz] * (1 - u) + D[oz + 1] * u) * (1 - v) + (D[oyz] * (1 - u) + D[oyz + 1] * u) * v;
  const d = ((a * (1 - w) + b * w) - 128) / 127;
  return p.blend > 0 ? d + (coarse(x, y, z) - d) * p.blend : d;
}

// An edit in the patch: `fn(d, x, y, z)` gives each fine corner within `reach`
// metres of `c` its new density. A patch caught settling keeps the slump so
// far as its own ground and stops (spec § Edge cases).
export function editPatch(p, c, reach, fn, coarse) {
  if (p.blend > 0) bake(p, coarse);
  const i0 = max(0, floor((c[0] - reach - p.x0) / FS)), i1 = min(p.nx - 1, ceil((c[0] + reach - p.x0) / FS));
  const j0 = max(0, floor((c[1] - reach - p.y0) / FS)), j1 = min(p.ny - 1, ceil((c[1] + reach - p.y0) / FS));
  const k0 = max(0, floor((c[2] - reach - p.z0) / FS)), k1 = min(p.nz - 1, ceil((c[2] + reach - p.z0) / FS));
  if (i0 > i1 || j0 > j1 || k0 > k1) return;
  const D = p.D, nx = p.nx, nxy = nx * p.ny;
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const o = i + nx * j + nxy * k;
    D[o] = Q(fn((D[o] - 128) / 127, p.x0 + i * FS, p.y0 + j * FS, p.z0 + k * FS));
  }
  p.edits++; p.rev++;
}
// The slump so far becomes the patch's own bytes; the settle stops.
export function bake(p, coarse) {
  const D = p.D, nx = p.nx, nxy = nx * p.ny;
  for (let k = 0; k < p.nz; k++) for (let j = 0; j < p.ny; j++) for (let i = 0; i < nx; i++) {
    const o = i + nx * j + nxy * k, d = (D[o] - 128) / 127;
    D[o] = Q(d + (coarse(p.x0 + i * FS, p.y0 + j * FS, p.z0 + k * FS) - d) * p.blend);
  }
  p.blend = 0; p.rev++;
}
// The bytes the mesher sees (render/ground.js): the patch's own, or the slump so far.
export function patchBytes(p, coarse) {
  if (!(p.blend > 0)) return p.D;
  const out = p.D.slice(), nx = p.nx, nxy = nx * p.ny;
  for (let k = 0; k < p.nz; k++) for (let j = 0; j < p.ny; j++) for (let i = 0; i < nx; i++) {
    const o = i + nx * j + nxy * k, d = (out[o] - 128) / 127;
    out[o] = Q(d + (coarse(p.x0 + i * FS, p.y0 + j * FS, p.z0 + k * FS) - d) * p.blend);
  }
  return out;
}

// Each fine column's top (metres): the highest crossing from rock to air in
// the patch, read through `sample` (so a slump shows). Rock at the patch's
// top: the ground is higher, `height(x, z)` (the coarse tops) says where; no
// rock in it: the same, lower down.
export function patchTops(p, sample, height) {
  for (let k = 0; k < p.nz; k++) for (let i = 0; i < p.nx; i++) {
    const x = p.x0 + i * FS, z = p.z0 + k * FS;
    let t = null, above = sample(x, p.y0 + (p.ny - 1) * FS, z);
    if (above > 0) t = height(x, z);
    else for (let j = p.ny - 2; j >= 0; j--) {
      const y = p.y0 + j * FS, d = sample(x, y, z);
      if (d > 0) { t = y + FS * d / (d - above); break; }
      above = d;
    }
    p.top[i + p.nx * k] = t ?? min(p.y0, height(x, z));
  }
}
// A patch's top at (x, z), blended between its fine columns.
export function patchHeight(p, x, z) {
  const gx = min(max((x - p.x0) / FS, 0), p.nx - 1 - 1e-4), gz = min(max((z - p.z0) / FS, 0), p.nz - 1 - 1e-4);
  const i = gx | 0, k = gz | 0, u = gx - i, w = gz - k, o = i + p.nx * k, T = p.top;
  return (T[o] * (1 - u) + T[o + 1] * u) * (1 - w) + (T[o + p.nx] * (1 - u) + T[o + p.nx + 1] * u) * w;
}
