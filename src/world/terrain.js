import { clampN, lerp } from '../util/math.js';

const { sin, floor, hypot, max } = Math;

export const N = 96, CELL = 24, HALF = (N * CELL) / 2, BOUND = HALF - 90;

// A 96x96 grid of 24 m cells: value-noise heights, a flat landing zone around
// the start. `flat: true` gives a level map (tests). `height(x, z)` samples
// the same triangle split as the mesh, so mechs stand exactly on what's drawn.
export function makeTerrain(seed, { flat = false } = {}) {
  const hs = new Float32Array((N + 1) * (N + 1));
  const hash = (i, j) => { const s = sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - floor(s); };
  const vn = (x, z) => {
    const i = floor(x), j = floor(z), fx = x - i, fz = z - j;
    const u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
    return lerp(lerp(hash(i, j), hash(i + 1, j), u), lerp(hash(i, j + 1), hash(i + 1, j + 1), u), w);
  };
  if (!flat) for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    const f = vn(x / 380 + 40, z / 380 + 40) * 0.6 + vn(x / 140, z / 140) * 0.3 + vn(x / 55, z / 55) * 0.1;
    let h = max(0, f - 0.36) * 230;
    const r = hypot(x, z);
    h *= clampN((r - 70) / 200, 0, 1);       // flat landing zone around the start
    hs[j * (N + 1) + i] = h;
  }
  const height = (x, z) => {
    const gx = clampN((x + HALF) / CELL, 0, N - 1e-4), gz = clampN((z + HALF) / CELL, 0, N - 1e-4);
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
    const h00 = hs[j * (N + 1) + i], h10 = hs[j * (N + 1) + i + 1], h01 = hs[(j + 1) * (N + 1) + i], h11 = hs[(j + 1) * (N + 1) + i + 1];
    return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };
  return { hs, height, seed };
}
