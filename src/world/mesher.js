// Surface nets for one chunk of the voxel ground (docs/specs/18-voxel-ground.md
// § Rendering): one vertex per cell the surface crosses, at the mean of its
// edges' crossings, and one quad per crossed edge, between the four cells
// around it. Flat-shaded, coloured per triangle: flat tops by height (low,
// mid, high), steep faces as banded rock with the ore seams in `pal.ore`
// (world/seams.js, from `pal.seed`; only rock, more than SOFT under its
// column's top), darker under cover. Pure, so it runs in the worker and in the tests.
//
// `D` holds a block of corners (one byte each, above 128 solid), `dims` =
// [nx, ny, nz] of them: a chunk's own plus one corner before and after on
// each axis, from world position `o` (local corner 0) at `s` metres apart.
// `top` holds the nx × nz column tops (metres) of the same corners. A block
// owns the edges that start at its corners 1..n-2, so neighbours never draw
// the same quad. Returns 9 floats per vertex (position, normal, colour), as
// mesh/builder.js does.
// The cube's 12 edges as corner pairs (corner c is x = c & 1, y = c >> 1 & 1, z = c >> 2).
const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
import { seamAt } from './seams.js';

const { sin, floor, hypot, round } = Math;
const SOFT = 6;   // world/voxels.js SOFT (not imported: the worker's bundle stays the mesher alone)
const hash = (x, z) => { const v = sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - floor(v); };

export function meshChunk(D, top, dims, o, s, pal) {
  const [nx, ny, nz] = dims;
  // All rock or all air (most chunks): nothing to draw.
  let lo = 255, hi = 0;
  for (let p = 0; p < D.length; p++) { const v = D[p]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo > 128 || hi <= 128) return new Float32Array(0);
  const mx = nx - 1, my = ny - 1, mz = nz - 1, nxy = nx * ny, vid = new Int32Array(mx * my * mz), V = new Float32Array(mx * my * mz * 3);
  const val = new Float32Array(8), off = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1];
  let nv = 0;
  // Vertices: each cell with corners on both sides of 128, at the mean of its edges' crossings.
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const base = i + nx * j + nxy * k;
    let solid = 0;
    for (let c = 0; c < 8; c++) { const v = D[base + off[c]] - 128; val[c] = v; if (v > 0) solid++; }
    const at = i + mx * (j + my * k);
    if (solid === 0 || solid === 8) { vid[at] = -1; continue; }
    let x = 0, y = 0, z = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const a = EA[e], b = EB[e], va = val[a], vb = val[b];
      if ((va > 0) === (vb > 0)) continue;
      const t = va / (va - vb);
      x += (a & 1) + ((b & 1) - (a & 1)) * t;
      y += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      z += (a >> 2) + ((b >> 2) - (a >> 2)) * t;
      cnt++;
    }
    vid[at] = nv * 3;
    V[nv * 3] = o[0] + (i + x / cnt) * s; V[nv * 3 + 1] = o[1] + (j + y / cnt) * s; V[nv * 3 + 2] = o[2] + (k + z / cnt) * s;
    nv++;
  }
  const ci = (i, j, k) => i + nx * j + nxy * k;
  // Quads: each owned edge whose ends disagree.
  let out = new Float32Array(nv * 54 + 54), no = 0;
  const cell = (i, j, k) => vid[i + mx * (j + my * k)];
  const quad = (a, b, c, d, dx, dy, dz) => { tri(a, b, c, dx, dy, dz); tri(a, c, d, dx, dy, dz); };
  function tri(a, b, c, dx, dy, dz) {
    const ax = V[a], ay = V[a + 1], az = V[a + 2];
    const ux = V[b] - ax, uy = V[b + 1] - ay, uz = V[b + 2] - az, wx = V[c] - ax, wy = V[c + 1] - ay, wz = V[c + 2] - az;
    let ex = uy * wz - uz * wy, ey = uz * wx - ux * wz, ez = ux * wy - uy * wx;
    const l = hypot(ex, ey, ez);
    if (l < 1e-6) return;   // a sliver: nothing to see
    if (ex * dx + ey * dy + ez * dz < 0) { ex = -ex; ey = -ey; ez = -ez; }
    ex /= l; ey /= l; ez /= l;   // the normal (nx is the block's width)
    const cx = (ax + V[b] + V[c]) / 3, cy = (ay + V[b + 1] + V[c + 1]) / 3, cz = (az + V[b + 2] + V[c + 2]) / 3;
    const r = hash(round(cx * 2), round(cz * 2) + round(cy * 2) * 131);
    let col0, col1, col2;
    if (ey > 0.6) {   // ground you could stand on: by height, as the old terrain was
      const t = Math.min(Math.max(cy / 70, 0), 1), lo = t < 0.5 ? pal.low : pal.mid, hi = t < 0.5 ? pal.mid : pal.high, u = t < 0.5 ? t * 2 : t * 2 - 1, f = 0.9 + r * 0.14;
      col0 = (lo[0] + (hi[0] - lo[0]) * u) * f; col1 = (lo[1] + (hi[1] - lo[1]) * u) * f; col2 = (lo[2] + (hi[2] - lo[2]) * u) * f;
    }
    // Under cover (a roof over it): below the top surface there, blended as ground.height is.
    const gx = Math.min(Math.max((cx - o[0]) / s, 0), mx - 1e-4), gz = Math.min(Math.max((cz - o[2]) / s, 0), mz - 1e-4), ti = (gx | 0) + nx * (gz | 0), u = gx % 1, w = gz % 1;
    const roof = (top[ti] * (1 - u) + top[ti + 1] * u) * (1 - w) + (top[ti + nx] * (1 - u) + top[ti + nx + 1] * u) * w;
    if (ey <= 0.6) {   // a face: rock in bands, a seam in its ore colour
      const ore = pal.ore && pal.seed != null && cy < roof - SOFT && seamAt(pal.seed, cx, cy, cz), c = ore ? pal.ore : pal.rock;
      const f = (ore ? 1 : floor(cy / 6) & 1 ? 0.9 : 1.05) * (0.92 + r * 0.12);
      col0 = c[0] * f; col1 = c[1] * f; col2 = c[2] * f;
    }
    if (cy < roof - 4) { col0 *= 0.62; col1 *= 0.62; col2 *= 0.62; }
    if (no + 27 > out.length) { const grown = new Float32Array(out.length * 2); grown.set(out); out = grown; }
    for (let q = 0; q < 3; q++) {
      const p = q === 0 ? a : q === 1 ? b : c;
      out[no] = V[p]; out[no + 1] = V[p + 1]; out[no + 2] = V[p + 2]; out[no + 3] = ex; out[no + 4] = ey; out[no + 5] = ez;
      out[no + 6] = col0; out[no + 7] = col1; out[no + 8] = col2; no += 9;
    }
  }
  for (let k = 1; k < mz; k++) for (let j = 1; j < my; j++) for (let i = 1; i < mx; i++) {
    const here = D[ci(i, j, k)] > 128;
    if (here !== D[ci(i + 1, j, k)] > 128) { const d = here ? 1 : -1; quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), d, 0, 0); }
    if (here !== D[ci(i, j + 1, k)] > 128) { const d = here ? 1 : -1; quad(cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k), 0, d, 0); }
    if (here !== D[ci(i, j, k + 1)] > 128) { const d = here ? 1 : -1; quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), 0, 0, d); }
  }
  return out.slice(0, no);
}

// A mesh's box: [lo, hi], or null for an empty one.
export function boundsOf(f) {
  if (!f.length) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < f.length; p += 9) for (let a = 0; a < 3; a++) { const v = f[p + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
  return [lo, hi];
}
