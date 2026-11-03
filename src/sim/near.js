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
import { HX, HZ, onResize } from '../world/terrain.js';
import { geoOf } from '../data/geo.js';

export const NEAR_CELL = 32;   // m: the squares
export const NEAR_PAD = 4;     // m: how far past a query a mech may have moved since the grid was built (it steps once a frame: a run or a blast-off is under 1 m)
// Squares across (x) and along (z), with one of margin round the map (mechs
// thrown past the edge), set again with the map's size (world/terrain.js).
let SX = 0, SZ = 0;
const sized = () => { SX = Math.ceil((2 * HX) / NEAR_CELL) + 2; SZ = Math.ceil((2 * HZ) / NEAR_CELL) + 2; };
sized(); onResize(sized);
const cellX = v => { const c = Math.floor((v + HX) / NEAR_CELL) + 1; return c < 0 ? 0 : c >= SX ? SX - 1 : c; };
const cellZ = v => { const c = Math.floor((v + HZ) / NEAR_CELL) + 1; return c < 0 ? 0 : c >= SZ ? SZ - 1 : c; };

// The widest mech's radius at the last build: every caller pads by it.
export const nearRadius = G => G.near?.on ? G.near.rmax : 0;

export function buildNear(G) {
  if (G.nearOff) return;   // every mech, every time: the old way, which the tests hold the grid to
  const M = G.mechs, n = M.length;
  let N = G.near;
  if (!N || N.head.length !== SX * SZ) N = G.near = { head: new Int32Array(SX * SZ), next: new Int32Array(64), idx: new Int32Array(64), list: null, count: 0, rmax: 0, on: false };   // a new size: a new grid
  if (N.next.length < n) { N.next = new Int32Array(n * 2); N.idx = new Int32Array(n * 2); }
  N.head.fill(-1);
  let rmax = 0;
  for (let i = n - 1; i >= 0; i--) {   // backwards, so each square's chain runs in G.mechs order
    const m = M[i], c = cellZ(m.z) * SX + cellX(m.x);
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
  return M.length;
}

// The indices of the mechs in squares [x0..x1] × [z0..z1] that `keep` keeps,
// then the ones added since the build, into `out` in G.mechs order.
function gather(G, x0, z0, x1, z1, keep, out) {
  const N = G.near, M = G.mechs, idx = N.idx;
  let k = 0;
  for (let cz = cellZ(z0), cz1 = cellZ(z1); cz <= cz1; cz++) for (let cx = cellX(x0), cx1 = cellX(x1); cx <= cx1; cx++) {
    for (let i = N.head[cz * SX + cx]; i >= 0; i = N.next[i]) if (keep(M[i])) idx[k++] = i;
  }
  for (let a = 1; a < k; a++) { const v = idx[a]; let b = a - 1; while (b >= 0 && idx[b] > v) { idx[b + 1] = idx[b]; b--; } idx[b + 1] = v; }   // squares visited row by row: back into G.mechs order (a handful; no garbage)
  for (let j = 0; j < k; j++) out[j] = M[idx[j]];
  for (let i = N.count; i < M.length; i++) out[k++] = M[i];   // added this frame: not in the grid
  return k;   // out keeps its length (shrinking it would only make it grow again): read the first k
}

// The mechs whose middle may be within `r` m of (x, z) on the ground: fills
// the start of `out` (the caller's own array, reused) and returns how many;
// what's past that is stale. Callers add
// nearRadius(G) when they measure to a mech's side, not its middle.
// The query's numbers live in a typed array: a module-level `let` holding a
// fraction is a boxed number, a new one every time it's set (spec 34 part 4).
const Q = new Float64Array(3);   // the circle: x, z, r²
const inCircle = m => { const dx = m.x - Q[0], dz = m.z - Q[1]; return dx * dx + dz * dz <= Q[2]; };
export function mechsNear(G, x, z, r, out) {
  if (!usable(G)) return all(G, out);
  const R = r + NEAR_PAD;
  Q[0] = x; Q[1] = z; Q[2] = R * R;
  return gather(G, x - R, z - R, x + R, z + R, inCircle, out);
}

// The mechs whose middle may be within `pad` m of the segment (x0, z0) to
// (x1, z1) on the ground: a shot's step, a beam. Fills `out`, returns how many.
const S = new Float64Array(6);   // the segment: x0, z0, dx, dz, |d|², pad²
const nearSeg = m => {
  const ax = m.x - S[0], az = m.z - S[1], dx = S[2], dz = S[3], l2 = S[4], t = l2 > 0 ? Math.max(0, Math.min(1, (ax * dx + az * dz) / l2)) : 0;
  const ex = ax - dx * t, ez = az - dz * t;
  return ex * ex + ez * ez <= S[5];
};
export function mechsAlong(G, x0, z0, x1, z1, pad, out) {
  if (!usable(G)) return all(G, out);
  const P = pad + NEAR_PAD;
  const dx = x1 - x0, dz = z1 - z0;
  S[0] = x0; S[1] = z0; S[2] = dx; S[3] = dz; S[4] = dx * dx + dz * dz; S[5] = P * P;
  return gather(G, Math.min(x0, x1) - P, Math.min(z0, z1) - P, Math.max(x0, x1) + P, Math.max(z0, z1) + P, nearSeg, out);
}
