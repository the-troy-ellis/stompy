import { Builder } from '../mesh/builder.js';
import { M, TAU, chain, clampN, mix3, mul } from '../util/math.js';
import { N, CELL, HALF, BOUND } from './terrain.js';

const { sin, cos, hypot } = Math;

// The terrain mesh plus the rocks and abandoned outposts baked into it.
export function buildTerrainMesh(ter, pal, seed) {
  const b = new Builder(), hs = ter.hs;
  let s = seed * 9301 + 49297;
  const r01 = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const colAt = h => {
    const t = clampN(h / 70, 0, 1);
    const c = t < 0.5 ? mix3(pal.low, pal.mid, t * 2) : mix3(pal.mid, pal.high, t * 2 - 1);
    return mul(c, 0.9 + r01() * 0.14);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const h00 = hs[j * (N + 1) + i], h10 = hs[j * (N + 1) + i + 1], h01 = hs[(j + 1) * (N + 1) + i], h11 = hs[(j + 1) * (N + 1) + i + 1];
    b.tri([x0, h00, z0], [x1, h10, z0], [x0, h01, z1], colAt((h00 + h10 + h01) / 3), 'up');
    b.tri([x1, h11, z1], [x0, h01, z1], [x1, h10, z0], colAt((h11 + h01 + h10) / 3), 'up');
  }
  // Rocks.
  for (let k = 0; k < 150; k++) {
    const x = (r01() - 0.5) * 2 * BOUND, z = (r01() - 0.5) * 2 * BOUND;
    if (hypot(x, z) < 60) continue;
    const sz = 2 + r01() * 7;
    b.cube(chain(M.T(x, ter.height(x, z) + sz * 0.15, z), M.RY(r01() * 6), M.RX((r01() - 0.5) * 0.6),
      M.S(sz, sz * (0.5 + r01() * 0.8), sz * (0.7 + r01() * 0.6))), mul(pal.rock, 0.85 + r01() * 0.3), 0.55 + r01() * 0.3, 0.55 + r01() * 0.3);
  }
  // A few abandoned outposts.
  for (let o = 0; o < 4; o++) {
    const a = r01() * TAU, d = 280 + r01() * 600, cx = sin(a) * d, cz = cos(a) * d;
    for (let k = 0; k < 7; k++) {
      const x = cx + (r01() - 0.5) * 90, z = cz + (r01() - 0.5) * 90;
      const w = 9 + r01() * 14, hgt = 7 + r01() * 22, dd = 9 + r01() * 14;
      const base = ter.height(x, z) - 2;
      const g = 0.45 + r01() * 0.2;
      b.cube(chain(M.T(x, base + hgt / 2, z), M.RY(r01() * 0.4), M.S(w, hgt, dd)), [g, g * 0.97, g * 0.93], 0.97, 0.97);
      b.cube(chain(M.T(x, base + hgt + 0.6, z), M.S(w * 0.6, 1.2, dd * 0.6)), [g * 0.6, g * 0.6, g * 0.6]);
    }
    const tx = cx + 40, tz = cz - 30, tb = ter.height(tx, tz);
    b.cube(chain(M.T(tx, tb + 22, tz), M.S(1.4, 44, 1.4)), [0.35, 0.33, 0.3], 0.4, 0.4);
    b.cube(chain(M.T(tx, tb + 44, tz), M.S(2.5, 1, 2.5)), [0.9, 0.15, 0.1]);
  }
  return b;
}
