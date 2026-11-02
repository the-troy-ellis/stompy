// A grid of the mechs (docs/specs/34-big-fights.md part 2): "which mechs are
// near here?" without looking at every one, so a fight's cost grows with its
// mechs, not with their square.
//
// update() builds it at the top of each frame (buildNear) and drops it at the
// end (dropNear). In between, mechsNear and mechsAlong answer from 32 m
// squares. Outside a frame (a test calling meleeTarget directly), or when
// G.mechs isn't the list it was built from, they look at every mech, as before.
//
// The answers are a superset of what the old loops would have looked at, in
// G.mechs order, so every caller keeps its own test and its own ties:
// - Mechs move during the frame, so each query reaches NEAR_PAD m further.
// - A mech added during the frame (a wave, a line's new mech) is always
//   included.
// - Every mech is in the grid, dead or alive. Callers skip the dead, as they
//   always have.
import { HALF } from '../world/terrain.js';
import { geoOf } from '../data/geo.js';

export const NEAR_CELL = 32;   // m: the squares
export const NEAR_PAD = 4;     // m: how far past a query a mech may have moved since the grid was built (it steps once a frame: a run or a blast-off is under 1 m)
const SIDE = Math.ceil((2 * HALF) / NEAR_CELL) + 2;   // a square of margin round the map: mechs thrown past the edge
const cellOf = v => { const c = Math.floor((v + HALF) / NEAR_CELL) + 1; return c < 0 ? 0 : c >= SIDE ? SIDE - 1 : c; };

// The widest mech's radius at the last build: every caller pads by it.
export const nearRadius = G => G.near?.on ? G.near.rmax : 0;

export function buildNear(G) {
  if (G.nearOff) return;   // every mech, every time: the old way, which the tests hold the grid to
  const M = G.mechs, n = M.length;
  let N = G.near;
  if (!N) N = G.near = { head: new Int32Array(SIDE * SIDE), next: new Int32Array(64), seen: new Int32Array(SIDE * SIDE), stamp: 0, idx: new Int32Array(64), list: null, count: 0, rmax: 0, on: false };
  if (N.next.length < n) { N.next = new Int32Array(n * 2); N.idx = new Int32Array(n * 2); }
  N.head.fill(-1);
  let rmax = 0;
  for (let i = n - 1; i >= 0; i--) {   // backwards, so each square's chain runs in G.mechs order
    const m = M[i], c = cellOf(m.z) * SIDE + cellOf(m.x);
    N.next[i] = N.head[c]; N.head[c] = i;
    const r = geoOf(m).radius * m.ch.scale;
    if (r > rmax) rmax = r;
  }
  N.list = M; N.count = n; N.rmax = rmax; N.on = true;
}
export function dropNear(G) { if (G.near) G.near.on = false; }

const usable = G => G.near?.on && G.near.list === G.mechs;

// Every mech, as before: out of a frame, or with no grid.
function all(G, out) {
  const M = G.mechs;
  for (let i = 0; i < M.length; i++) out[i] = M[i];
  out.length = M.length;
  return M.length;
}

// The indices of the mechs in squares [x0..x1] × [z0..z1] that `keep` keeps,
// then the ones added since the build, into `out` in G.mechs order.
function gather(G, x0, z0, x1, z1, keep, out) {
  const N = G.near, M = G.mechs, idx = N.idx;
  let k = 0;
  for (let cz = cellOf(z0), cz1 = cellOf(z1); cz <= cz1; cz++) for (let cx = cellOf(x0), cx1 = cellOf(x1); cx <= cx1; cx++) {
    for (let i = N.head[cz * SIDE + cx]; i >= 0; i = N.next[i]) if (keep(M[i])) idx[k++] = i;
  }
  for (let a = 1; a < k; a++) { const v = idx[a]; let b = a - 1; while (b >= 0 && idx[b] > v) { idx[b + 1] = idx[b]; b--; } idx[b + 1] = v; }   // squares visited row by row: back into G.mechs order (a handful; no garbage)
  for (let j = 0; j < k; j++) out[j] = M[idx[j]];
  for (let i = N.count; i < M.length; i++) out[k++] = M[i];   // added this frame: not in the grid
  out.length = k;
  return k;
}

// The mechs whose middle may be within `r` m of (x, z) on the ground: fills
// `out` (the caller's own array, reused) and returns how many. Callers add
// nearRadius(G) when they measure to a mech's side, not its middle.
let qx = 0, qz = 0, qr2 = 0;
const inCircle = m => { const dx = m.x - qx, dz = m.z - qz; return dx * dx + dz * dz <= qr2; };
export function mechsNear(G, x, z, r, out) {
  if (!usable(G)) return all(G, out);
  const R = r + NEAR_PAD;
  qx = x; qz = z; qr2 = R * R;
  return gather(G, x - R, z - R, x + R, z + R, inCircle, out);
}

// The mechs whose middle may be within `pad` m of the segment (x0, z0) to
// (x1, z1) on the ground: a shot's step, a beam. Fills `out`, returns how many.
let sx = 0, sz = 0, sdx = 0, sdz = 0, sl2 = 0, sp2 = 0;
const nearSeg = m => {
  const ax = m.x - sx, az = m.z - sz, t = sl2 > 0 ? Math.max(0, Math.min(1, (ax * sdx + az * sdz) / sl2)) : 0;
  const ex = ax - sdx * t, ez = az - sdz * t;
  return ex * ex + ez * ez <= sp2;
};
export function mechsAlong(G, x0, z0, x1, z1, pad, out) {
  if (!usable(G)) return all(G, out);
  const P = pad + NEAR_PAD;
  sx = x0; sz = z0; sdx = x1 - x0; sdz = z1 - z0; sl2 = sdx * sdx + sdz * sdz; sp2 = P * P;
  return gather(G, Math.min(x0, x1) - P, Math.min(z0, z1) - P, Math.max(x0, x1) + P, Math.max(z0, z1) + P, nearSeg, out);
}
