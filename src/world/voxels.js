import { makeTerrain, HALF } from './terrain.js';
import { clampN } from '../util/math.js';
import { polar } from '../sim/placement.js';

const { floor, ceil, hypot, max, min } = Math;

// The ground as voxels (docs/specs/18-voxel-ground.md): a grid of 8 m cells,
// one byte of density per corner (above 128 is solid), from y = Y0 up. Today's
// hills are its base (makeTerrain's heights, so every mission keeps its shape);
// a mission's landmarks and the editor's strokes are laid on top, in order.
// Bedrock (the bottom two layers) never changes; outside the map is air.
export const VS = 8, Y0 = -44, NX = (2 * HALF) / VS, NY = 38, NZ = NX;
export const CS = 16, CX = ceil(NX / CS), CY = ceil(NY / CS), CZ = ceil(NZ / CS);
const PX = NX + 1, PY = NY + 1, PZ = NZ + 1;
export const cornerIndex = (i, j, k) => i + PX * (j + PY * k);
// Density is metres from the surface over DS, so slopes up to ~60° keep their shape between corners.
export const DS = 2 * VS;
const Q = d => (d <= -1 ? 1 : d >= 1 ? 255 : Math.round(d * 127) + 128);   // never 0, so 128 is the one boundary byte
const BEDROCK = 1;   // corners j <= 1 stay solid

// Builds the ground for a seed and a mission definition. `def.ground` (all
// optional): { landmarks: [...], strokes: [[op, x, y, z, r], ...], pockets }.
// `opts.height(x, z)` replaces the hills (tests: a ramp, a ridge).
export function makeGround(seed, opts = {}, def = {}) {
  const base = opts.height ? { height: opts.height } : makeTerrain(seed, opts), D = new Uint8Array(PX * PY * PZ), top = new Float32Array(PX * PZ);
  const g = def.ground || {};
  // The base: "height minus y" in cells, so a flat pad's top lands exactly on its height.
  for (let k = 0; k < PZ; k++) for (let i = 0; i < PX; i++) {
    const edge = i === 0 || k === 0 || i === NX || k === NZ, h = base.height(-HALF + i * VS, -HALF + k * VS);
    // Rock up to a DS under the surface, air from a DS over it, a ramp between.
    const jr = edge ? BEDROCK : Math.min(NY - 1, Math.max(BEDROCK, floor((h - DS - Y0) / VS))), ja = edge ? BEDROCK + 1 : Math.min(NY, ceil((h + DS - Y0) / VS));
    let o = cornerIndex(i, 0, k);
    for (let j = 0; j < PY; j++, o += PX) D[o] = j <= jr ? 255 : j >= ja || j === NY ? 1 : Q((h - (Y0 + j * VS)) / DS);
  }
  const G = { D, top, seed, flat: !!opts.flat, dirty: new Set(), rev: 0 };
  const ground = Object.assign(G, groundApi(G));
  ground.retop(0, NX, 0, NZ);
  for (const l of g.landmarks || []) landmark(ground, l);
  if (g.pockets) pockets(ground, seed);
  for (const s of g.strokes || []) ground.stroke(s);
  ground.dirty.clear();   // a fresh ground is built whole; only edits after this rebuild chunks
  return ground;
}

function groundApi(G) {
  const { D, top } = G;
  const val = (i, j, k) => (D[cornerIndex(i, j, k)] - 128) / 127;
  // Density anywhere by trilinear blend: below the grid is rock, beside or above it air.
  function sample(x, y, z) {
    const fx = (x + HALF) / VS, fy = (y - Y0) / VS, fz = (z + HALF) / VS;
    if (fy <= 0) return 1;
    if (fx < 0 || fz < 0 || fx >= NX || fz >= NZ || fy >= NY) return -1;
    const i = fx | 0, j = fy | 0, k = fz | 0, u = fx - i, v = fy - j, w = fz - k;
    const o = cornerIndex(i, j, k), oy = o + PX, oz = o + PX * PY, oyz = oz + PX;   // plain numbers, no closures: this runs thousands of times a frame
    const a = (D[o] * (1 - u) + D[o + 1] * u) * (1 - v) + (D[oy] * (1 - u) + D[oy + 1] * u) * v;
    const b = (D[oz] * (1 - u) + D[oz + 1] * u) * (1 - v) + (D[oyz] * (1 - u) + D[oyz + 1] * u) * v;
    return ((a * (1 - w) + b * w) - 128) / 127;
  }
  // The top surface under the sky, blended between the four corner columns.
  // The mesh (mesher.js) is the same surface, smoothed: the two agree within
  // 0.6 m over nearly all of a map (test/mesher.test.js).
  function height(x, z) {
    const gx = clampN((x + HALF) / VS, 0, NX - 1e-4), gz = clampN((z + HALF) / VS, 0, NZ - 1e-4);
    const i = gx | 0, k = gz | 0, u = gx - i, w = gz - k, o = i + PX * k;
    return (top[o] * (1 - u) + top[o + 1] * u) * (1 - w) + (top[o + PX] * (1 - u) + top[o + PX + 1] * u) * w;
  }
  const solid = (x, y, z) => sample(x, y, z) > 0;
  // The first surface going down from y (what a foot under an overhang
  // stands on), or `lo` if there is none above it. Above the top surface the
  // march starts just over it, so the open ground costs a few samples.
  function groundBelow(x, y, z, lo = Y0) {
    if (sample(x, y, z) > 0) return y;
    const step = VS / 4, h = height(x, z);
    let yy = y - step;
    if (y > h + 2 * step && sample(x, h + step, z) <= 0) yy = h + step;
    for (; yy > lo; yy -= step) {
      if (sample(x, yy, z) > 0) {
        let a = yy, b = yy + step;
        for (let n = 0; n < 7; n++) { const m = (a + b) / 2; if (sample(x, m, z) > 0) a = m; else b = m; }
        return (a + b) / 2;
      }
    }
    return lo;
  }
  // Where a ray first meets rock (distance along d), or null. The arrays are
  // read once into plain numbers: shots and sight lines run this all frame.
  function ray(o, d, maxT) {
    const ox = +o[0], oy = +o[1], oz = +o[2], dx = +d[0], dy = +d[1], dz = +d[2], step = VS / 2, n = ceil(maxT / step);
    for (let k = 1; k <= n; k++) {
      const t = k === n ? maxT : k * step;
      if (sample(ox + dx * t, oy + dy * t, oz + dz * t) > 0) {
        let a = (k - 1) * step, b = t;
        for (let q = 0; q < 8; q++) { const m = (a + b) / 2; if (sample(ox + dx * m, oy + dy * m, oz + dz * m) > 0) b = m; else a = m; }
        return b;
      }
    }
    return null;
  }
  // One corner column's top: the highest crossing from rock to air, in metres.
  function topOf(i, k) {
    let o = cornerIndex(i, NY, k), j = NY;
    while (j > 0 && D[o] <= 128) { o -= PX; j--; }
    if (j >= NY) return Y0 + NY * VS;
    const a = D[o] - 128, b = D[o + PX] - 128;
    return Y0 + (j + a / (a - b)) * VS;
  }
  const retop = (i0, i1, k0, k1) => { for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) top[i + PX * k] = topOf(i, k); };
  // The corners a sphere of radius r at p can change, clamped to what may change.
  const box = (p, r) => [
    clampN(floor((p[0] + HALF - r) / VS) - 1, 1, NX - 1), clampN(ceil((p[0] + HALF + r) / VS) + 1, 1, NX - 1),
    clampN(floor((p[1] - Y0 - r) / VS) - 1, BEDROCK + 1, NY - 1), clampN(ceil((p[1] - Y0 + r) / VS) + 1, BEDROCK + 1, NY - 1),
    clampN(floor((p[2] + HALF - r) / VS) - 1, 1, NZ - 1), clampN(ceil((p[2] + HALF + r) / VS) + 1, 1, NZ - 1)];
  function touched(i0, i1, j0, j1, k0, k1) {
    retop(i0, i1, k0, k1);
    // A corner is read by the cells on both sides of it: the chunks one corner out rebuild too.
    const c = (v, n) => clampN(floor(v / CS), 0, n - 1);
    for (let cz = c(k0 - 1, CZ); cz <= c(k1 + 1, CZ); cz++) for (let cy = c(j0 - 1, CY); cy <= c(j1 + 1, CY); cy++)
      for (let cx = c(i0 - 1, CX); cx <= c(i1 + 1, CX); cx++) G.dirty.add(cx + CX * (cy + CY * cz));
    G.rev++;
  }
  // Shape edits. A carve takes the smaller of the ground and the hole, so carves
  // give the same bytes in any order; a build takes the larger.
  function shape(p, r, f) {
    const [i0, i1, j0, j1, k0, k1] = box(p, r);
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = cornerIndex(i, j, k), dist = hypot(-HALF + i * VS - p[0], Y0 + j * VS - p[1], -HALF + k * VS - p[2]);
      D[o] = Q(f((D[o] - 128) / 127, dist));
    }
    touched(i0, i1, j0, j1, k0, k1);
  }
  const carve = (p, r) => shape(p, r, (d, dist) => min(d, (dist - r) / DS));
  const build = (p, r) => shape(p, r, (d, dist) => max(d, (r - dist) / DS));
  // Smooth: each corner in reach eases toward the mean of its six neighbours (read from a copy).
  function smooth(p, r) {
    const [i0, i1, j0, j1, k0, k1] = box(p, r);
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    const w = i1 - i0 + 3, h = j1 - j0 + 3, copy = new Float32Array(w * h * (k1 - k0 + 3));
    const at = (i, j, k) => copy[(i - i0 + 1) + w * ((j - j0 + 1) + h * (k - k0 + 1))];
    for (let k = k0 - 1; k <= k1 + 1; k++) for (let j = j0 - 1; j <= j1 + 1; j++) for (let i = i0 - 1; i <= i1 + 1; i++)
      copy[(i - i0 + 1) + w * ((j - j0 + 1) + h * (k - k0 + 1))] = val(clampN(i, 0, NX), clampN(j, 0, NY), clampN(k, 0, NZ));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dist = hypot(-HALF + i * VS - p[0], Y0 + j * VS - p[1], -HALF + k * VS - p[2]);
      if (dist >= r) continue;
      const mean = (at(i - 1, j, k) + at(i + 1, j, k) + at(i, j - 1, k) + at(i, j + 1, k) + at(i, j, k - 1) + at(i, j, k + 1)) / 6;
      const d = at(i, j, k);
      D[cornerIndex(i, j, k)] = Q(d + (mean - d) * 0.6 * (1 - dist / r));
    }
    touched(i0, i1, j0, j1, k0, k1);
  }
  // A block of rock from the bottom up to `top`, between x0..x1 and z0..z1,
  // its sides sheer or, with `grade`, sloping in at that rise over run (tests'
  // walls, ridges and plateaus).
  function block(x0, x1, z0, z1, top, grade = Infinity) {
    const i0 = clampN(floor((x0 + HALF) / VS) - 1, 1, NX - 1), i1 = clampN(ceil((x1 + HALF) / VS) + 1, 1, NX - 1);
    const k0 = clampN(floor((z0 + HALF) / VS) - 1, 1, NZ - 1), k1 = clampN(ceil((z1 + HALF) / VS) + 1, 1, NZ - 1);
    const j1 = clampN(ceil((top - Y0) / VS) + 2, BEDROCK + 1, NY - 1);
    for (let k = k0; k <= k1; k++) for (let j = BEDROCK + 1; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * VS, y = Y0 + j * VS, z = -HALF + k * VS, o = cornerIndex(i, j, k);
      const side = min(x - x0, x1 - x, z - z0, z1 - z), d = grade === Infinity ? min(top - y, side) : min(top - y, side * grade - y) / Math.hypot(1, grade);
      D[o] = Q(max((D[o] - 128) / 127, d / DS));
    }
    touched(i0, i1, BEDROCK + 1, j1, k0, k1);
  }
  // An editor stroke: [op, x, y, z, r], op 0 carve, 1 build, 2 smooth.
  const stroke = ([op, x, y, z, r]) => (op === 0 ? carve : op === 1 ? build : smooth)([x, y, z], r);
  return { sample, height, solid, groundBelow, ray, carve, build, smooth, block, stroke, retop };
}

// A landmark, as a distance shape laid onto the ground: positive inside rock.
// Positions are polar [bearing°, dist] like everything else in a mission.
function landmark(ground, l) {
  const D = ground.D, at = p => polar(p);
  let bounds, f;
  if (l.kind === 'tunnel') {
    const a = at(l.from), b = at(l.to), ay = l.from[2], by = l.to[2], r = l.r || 15;
    const A = [a.x, ay, a.z], AB = [b.x - a.x, by - ay, b.z - a.z], L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2 || 1;
    bounds = [min(a.x, b.x) - r, min(ay, by) - r, min(a.z, b.z) - r, max(a.x, b.x) + r, max(ay, by) + r, max(a.z, b.z) + r];
    f = (d, x, y, z) => {
      const px = x - A[0], py = y - A[1], pz = z - A[2], t = clampN((px * AB[0] + py * AB[1] + pz * AB[2]) / L2, 0, 1);
      return min(d, (hypot(px - AB[0] * t, (py - AB[1] * t) * 0.8, pz - AB[2] * t) - r) / DS);   // a little taller than wide
    };
  } else if (l.kind === 'arch') {
    const c = at(l.at), r = l.r || 46, th = l.thick || 9, face = (l.face || 0) * Math.PI / 180;
    const cy = ground.height(c.x, c.z) - th * 0.6, ca = Math.cos(face), sa = Math.sin(face);
    bounds = [c.x - r - th, cy - th, c.z - r - th, c.x + r + th, cy + r + th, c.z + r + th];
    f = (d, x, y, z) => {
      const dx = x - c.x, dz = z - c.z, u = dx * ca - dz * sa, v = dx * sa + dz * ca;   // u along the arch, v across it
      return max(d, (th - hypot(hypot(u, y - cy) - r, v * 1.25)) / DS);
    };
  } else if (l.kind === 'mesa') {
    const c = at(l.at), r = l.r || 66, topY = l.top || 120, lip = l.lip || 24, h0 = ground.height(c.x, c.z);
    bounds = [c.x - r - lip, h0 - VS, c.z - r - lip, c.x + r + lip, topY, c.z + r + lip];
    f = (d, x, y, z) => {
      const R = y > topY - 30 ? r + lip : r;   // the top band hangs out over the sides: an overhang
      return max(d, min(R - hypot(x - c.x, z - c.z), topY - y) / DS);
    };
  } else if (l.kind === 'cave') {
    const c = at(l.at), r = l.r || 24, depth = l.depth || 60, gy = ground.height(c.x, c.z), cy = gy + r * 0.4;
    const face = (l.face || 0) * Math.PI / 180, fx = -Math.sin(face), fz = Math.cos(face);   // the mouth looks along `face`
    bounds = [c.x - depth - r, gy - r, c.z - depth - r, c.x + depth + r, gy + r * 1.6, c.z + depth + r];
    f = (d, x, y, z) => {
      const px = x - c.x, pz = z - c.z, t = clampN(-(px * fx + pz * fz), 0, depth);   // from the mouth, back into the hill
      return min(d, (hypot(px + fx * t, (y - cy) * 1.2, pz + fz * t) - r * (1 - 0.3 * t / depth)) / DS);
    };
  } else return;
  const i0 = clampN(floor((bounds[0] + HALF) / VS), 1, NX - 1), i1 = clampN(ceil((bounds[3] + HALF) / VS), 1, NX - 1);
  const j0 = clampN(floor((bounds[1] - Y0) / VS), BEDROCK + 1, NY - 1), j1 = clampN(ceil((bounds[4] - Y0) / VS), BEDROCK + 1, NY - 1);
  const k0 = clampN(floor((bounds[2] + HALF) / VS), 1, NZ - 1), k1 = clampN(ceil((bounds[5] + HALF) / VS), 1, NZ - 1);
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const o = cornerIndex(i, j, k);
    D[o] = Q(f((D[o] - 128) / 127, -HALF + i * VS, Y0 + j * VS, -HALF + k * VS));
  }
  ground.retop(i0, i1, k0, k1);
}

// Small hollows under the surface, from the seed: only where a mission asks.
function pockets(ground, seed) {
  const D = ground.D, hash = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + seed * 19.19) * 43758.5453; return s - floor(s); };
  for (let k = 2; k < NZ - 1; k += 1) for (let i = 2; i < NX - 1; i += 1) {
    const surf = ground.top[i + PX * k];
    for (let j = BEDROCK + 2; j < NY; j++) {
      const y = Y0 + j * VS;
      if (y > surf - 18) break;
      if (hash(i >> 2, j >> 1, k >> 2) > 0.93) { const o = cornerIndex(i, j, k); D[o] = Q(-0.6); }
    }
  }
}

// What the mesher needs for a block of corners (mesher.js): `dims` of them
// from corner (i0, j0, k0), `step` corners apart (outside the grid: rock below,
// air beside and above), the same columns' tops, and where its first corner is.
export function blockCorners(ground, i0, j0, k0, dims, step = 1) {
  const [nx, ny, nz] = dims, G = ground.D, D = new Uint8Array(nx * ny * nz), T = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const gi = i0 + i * step, gk = k0 + k * step, out = gi < 0 || gk < 0 || gi > NX || gk > NZ;
    T[i + nx * k] = out ? Y0 : ground.top[gi + PX * gk];
    for (let j = 0; j < ny; j++) {
      const gj = j0 + j * step;
      D[i + nx * (j + ny * k)] = gj < 0 ? 255 : out || gj > NY ? 1 : G[cornerIndex(gi, gj, gk)];
    }
  }
  return { D, T, o: [-HALF + i0 * VS, Y0 + j0 * VS, -HALF + k0 * VS], dims, s: VS * step };
}
// One chunk: its corners plus one before and after on each axis.
export const CN = CS + 2, CHUNK_DIMS = [CN, CN, CN];
export const chunkCorners = (ground, cx, cy, cz) => blockCorners(ground, cx * CS - 1, cy * CS - 1, cz * CS - 1, CHUNK_DIMS);
// The far version of a square of `size` chunks a side (docs/specs/18-voxel-ground.md
// § Level of detail): every other corner, so 16 m cells, the whole height, and
// one coarse cell more on each side, so it tucks under its near neighbours
// with no gap between.
export function farCorners(ground, cx0, cz0, size) {
  const n = size * CS / 2 + 4;
  return blockCorners(ground, cx0 * CS - 4, -2, cz0 * CS - 4, [n, Math.ceil(NY / 2) + 3, n], 2);
}
