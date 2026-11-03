import { clampN, lerp } from '../util/math.js';

const { sin, floor, hypot, max } = Math;

// The map's size (docs/specs/35-bigger-maps.md part 5): width (x) by length
// (z), in 24 m cells, centred on 0. Live bindings: setMapSize changes them for
// every importer, before a match builds its ground (sim/state.js). HX and HZ
// are the half-sizes; BX and BZ how far out anyone can walk (90 m short of
// the edge). Today's square map, 2,304 m, is the default.
export const CELL = 24, EDGE = 90, DEFAULT_SIZE = [2304, 2304];
export let NXC = 96, NZC = 96, HX = 1152, HZ = 1152, BX = HX - EDGE, BZ = HZ - EDGE;
const resized = [];
// `f()` runs after every change of size (voxels.js, sim/near.js: their grids).
export const onResize = f => { resized.push(f); };
// Set the size to [w, l] metres (each rounded to whole cells, at least 20).
// Returns whether it changed.
export function setMapSize([w, l] = DEFAULT_SIZE) {
  const nx = Math.max(20, Math.round(w / CELL / 2) * 2), nz = Math.max(20, Math.round(l / CELL / 2) * 2);   // even: the map stays centred on a corner
  if (nx === NXC && nz === NZC) return false;
  NXC = nx; NZC = nz; HX = (nx * CELL) / 2; HZ = (nz * CELL) / 2; BX = HX - EDGE; BZ = HZ - EDGE;
  for (const f of resized) f();
  return true;
}
// Inside where anyone can walk, `m` m in from it.
export const inBounds = (x, z, m = 0) => Math.abs(x) <= BX - m && Math.abs(z) <= BZ - m;

// A grid of 24 m cells over the map: value-noise heights, a flat landing zone
// around the start. `flat: true` gives a level map (tests). `canyon: { width,
// walls, wind }` (docs/specs/35-bigger-maps.md part 5) runs a floor about
// `width` m across along z, winding side to side by up to `wind` m, between
// walls `walls` m high, the hills folded in. `zones: [[x, z, r], ...]`
// flattens more pads (a mission's structures, an extraction point) to the
// height at each centre, easing back to the hills over another r. `height(x, z)`
// samples the same triangle split as the mesh, so mechs stand exactly on what's drawn.
export function makeTerrain(seed, { flat = false, zones = [], canyon = null } = {}) {
  const W = NXC + 1, hs = new Float32Array(W * (NZC + 1));
  const hash = (i, j) => { const s = sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - floor(s); };
  const vn = (x, z) => {
    const i = floor(x), j = floor(z), fx = x - i, fz = z - j;
    const u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
    return lerp(lerp(hash(i, j), hash(i + 1, j), u), lerp(hash(i, j + 1), hash(i + 1, j + 1), u), w);
  };
  if (!flat) for (let j = 0; j <= NZC; j++) for (let i = 0; i <= NXC; i++) {
    const x = -HX + i * CELL, z = -HZ + j * CELL;
    const f = vn(x / 380 + 40, z / 380 + 40) * 0.6 + vn(x / 140, z / 140) * 0.3 + vn(x / 55, z / 55) * 0.1;
    let h = max(0, f - 0.36) * 230;
    if (canyon) h = canyonAt(canyon, seed, x, z, h);
    else h *= clampN((hypot(x, z) - 70) / 200, 0, 1);       // flat landing zone around the start
    hs[j * W + i] = h;
  }
  if (!flat && zones.length) {
    const raw = hs.slice(), at = (x, z) => raw[clampN(Math.round((z + HZ) / CELL), 0, NZC) * W + clampN(Math.round((x + HX) / CELL), 0, NXC)];
    const pads = zones.map(([x, z, r]) => ({ x, z, r, h: at(x, z) }));
    for (let j = 0; j <= NZC; j++) for (let i = 0; i <= NXC; i++) {
      const x = -HX + i * CELL, z = -HZ + j * CELL;
      for (const p of pads) {
        // A cell's margin past r, so the pad is level right out to r between grid points.
        const u = clampN((hypot(x - p.x, z - p.z) - p.r - CELL) / p.r, 0, 1), k = u * u * (3 - 2 * u);
        hs[j * W + i] = lerp(p.h, hs[j * W + i], k);
      }
    }
  }
  const nx = NXC, nz = NZC, hx = HX, hz = HZ;   // this ground's size, whatever the map is set to later
  const height = (x, z) => {
    const gx = clampN((x + hx) / CELL, 0, nx - 1e-4), gz = clampN((z + hz) / CELL, 0, nz - 1e-4);
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
    const h00 = hs[j * W + i], h10 = hs[j * W + i + 1], h01 = hs[(j + 1) * W + i], h11 = hs[(j + 1) * W + i + 1];
    return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };
  return { hs, height, seed, flat, nx, nz };
}

// A canyon's height at (x, z), given the hills' h there: where the floor's
// middle line runs at this z (a slow wind from the seed), how far x is from it,
// and so floor, slope or wall top. The walls carry the hills on top; the floor
// keeps a fifth of them, so it isn't a table. The far ends close in, so the
// canyon is a corridor with walls at both ends too.
// The canyon floor's middle line at z: a slow wind from the seed, through x 0
// at the map's centre (where a match starts unless it says otherwise).
const wiggle = (z, seed, wind) => Math.sin(z / 420 + seed * 0.37) * wind * 0.7 + Math.sin(z / 170 + seed * 1.3) * wind * 0.3;
export const canyonMid = ({ wind = 120 } = {}, seed, z) => wiggle(z, seed, wind) - wiggle(0, seed, wind);
function canyonAt(canyon, seed, x, z, h) {
  const { width = 200, walls = 80 } = canyon, mid = canyonMid(canyon, seed, z);
  const half = width / 2, slope = Math.max(40, walls * 0.8), d = Math.abs(x - mid);
  const u = clampN((d - half) / slope, 0, 1), t = u * u * (3 - 2 * u);
  const ends = clampN((Math.abs(z) - (HZ - 260)) / 160, 0, 1);   // the far ends rise to wall height too
  const k = Math.max(t, ends * ends * (3 - 2 * ends));
  return lerp(h * 0.2, walls + h * 0.6, k);
}
