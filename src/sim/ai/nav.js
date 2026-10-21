import { HALF, BOUND } from '../../world/terrain.js';
import { VS, Y0, NY, cornerIndex } from '../../world/voxels.js';

const { abs, floor, hypot, max, min } = Math;

// The AI's map of the voxel ground (docs/specs/18-voxel-ground.md § The AI
// in canyons and caves): SQ-metre squares, each with the floors a mech can
// stand on in it (a mesa's top and the tunnel under it are two), found from
// the corner columns. Neighbouring floors link where the climb between them
// is one a mech walks (CLIFF) and there is headroom; A* runs on the links for
// moves past the feelers' reach. Digs and falls mark squares to look at again
// (sim/dig.js). Built per ground, at first use, in a few ms.
export const SQ = 32, N = (2 * HALF) / SQ, CLIFF = 1.6, HEADROOM = 9, MAX_FLOORS = 4;
const PER = SQ / VS, STEP_M = 4;   // corner columns a square spans; the walk between squares, in metres
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function makeNav(ter) {
  const floors = new Array(N * N), links = new Map();
  // The floors in one square: in each of its corner columns, every rise from
  // rock to air with headroom over it; floors within a cell of each other are one.
  // Each floor is { y, x, z }: where it was found nearest the square's middle,
  // so a tunnel narrower than a square is walked through its own middle.
  function floorsOf(s) {
    const sx = s % N, sz = (s / N) | 0, D = ter.D, ys = [];
    if (Math.abs(-HALF + (sx + 0.5) * SQ) > BOUND || Math.abs(-HALF + (sz + 0.5) * SQ) > BOUND) return ys;   // past where anyone can walk
    for (let a = 0; a < PER; a++) for (let b = 0; b < PER; b++) {
      const i = sx * PER + a + 1, k = sz * PER + b + 1, x = -HALF + i * VS, z = -HALF + k * VS, off = abs(a - PER / 2 + 0.5) + abs(b - PER / 2 + 0.5);
      for (let j = 1; j < NY - 1; j++) {
        const lo = D[cornerIndex(i, j, k)], hi = D[cornerIndex(i, j + 1, k)];
        if (lo <= 128 || hi > 128) continue;
        let top = j + 2;
        while (top < NY && D[cornerIndex(i, top, k)] <= 128) top++;
        const y = Y0 + (j + (lo - 128) / (lo - hi)) * VS;
        if (Y0 + top * VS - y >= HEADROOM) ys.push({ y, x, z, off });
      }
    }
    ys.sort((p, q) => p.y - q.y);
    const out = [];
    for (const f of ys) {
      const last = out[out.length - 1];
      if (last && f.y - last.y < VS) { if (f.off < last.off) out[out.length - 1] = f; } else out.push(f);
    }
    return out.slice(-MAX_FLOORS);   // the topmost few
  }
  const fl = s => floors[s] || (floors[s] = floorsOf(s));
  // Whether a mech on floor fa of square a can walk to floor fb of square b:
  // stepped every STEP_M along the line, on the ground under it, no rise
  // steeper than CLIFF, headroom all the way, and it arrives on that floor.
  // A drop is fine (a mech walks off a ledge), so it goes one way.
  function linked(a, fa, b, fb) {
    const key = `${a}.${fa}.${b}.${fb}`;
    if (links.has(key)) return links.get(key);
    const A = fl(a)[fa], B = fl(b)[fb], ax = A.x, az = A.z, bx = B.x, bz = B.z, n = Math.ceil(hypot(bx - ax, bz - az) / STEP_M);
    let y = A.y, ok = true;
    for (let i = 1; ok && i <= n; i++) {
      const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n, lid = y + CLIFF * STEP_M + 1, g = ter.groundBelow(x, lid, z);
      ok = g < lid - 0.01 && !ter.solid(x, g + HEADROOM, z);   // rock right up at the lid: a wall
      y = g;
    }
    ok = ok && abs(y - B.y) < VS;
    links.set(key, ok);
    return ok;
  }
  const square = (x, z) => min(N - 1, max(0, floor((x + HALF) / SQ))) + N * min(N - 1, max(0, floor((z + HALF) / SQ)));
  const nearestFloor = (s, y) => { const f = fl(s); let best = 0; for (let i = 1; i < f.length; i++) if (abs(f[i].y - y) < abs(f[best].y - y)) best = i; return f.length ? best : -1; };

  // A path from (x0, y0, z0) to (x1, y1, z1): [[x, y, z], ...] square by
  // square, the start's square left out; null if there is none (or it would
  // take more than `budget` squares to find out).
  function path(x0, y0, z0, x1, y1, z1, budget = 3000) {
    const sa = square(x0, z0), sb = square(x1, z1), fa = nearestFloor(sa, y0), fb = nearestFloor(sb, y1);
    if (fa < 0 || fb < 0) return null;
    const id = (s, f) => s * MAX_FLOORS + f, start = id(sa, fa), goal = id(sb, fb);
    const g = new Map([[start, 0]]), from = new Map(), open = [[0, start]], gx = x1, gz = z1;
    let n = 0;
    while (open.length) {
      // The cheapest open node (a binary heap would be quicker; paths are short and few).
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (cur === goal) break;
      if (++n > budget) return null;
      const s = (cur / MAX_FLOORS) | 0, f = cur % MAX_FLOORS, sx = s % N, sz = (s / N) | 0, gc = g.get(cur);
      for (const [dx, dz] of DIRS) {
        const nx = sx + dx, nz = sz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const t = nx + N * nz, tf = fl(t);
        for (let k = 0; k < tf.length; k++) {
          if (!linked(s, f, t, k)) continue;
          const nid = id(t, k), cost = gc + SQ * (dx && dz ? 1.414 : 1) + abs(tf[k].y - fl(s)[f].y) * 0.5;
          if (g.has(nid) && g.get(nid) <= cost) continue;
          g.set(nid, cost); from.set(nid, cur);
          open.push([cost + hypot(gx - tf[k].x, gz - tf[k].z), nid]);
        }
      }
    }
    if (!from.has(goal) && start !== goal) return null;
    const out = [];
    for (let c = goal; c !== start; c = from.get(c)) { const f = fl((c / MAX_FLOORS) | 0)[c % MAX_FLOORS]; out.push([f.x, f.y, f.z]); }
    return out.reverse();
  }
  // Ground changed within r of (x, z): those squares, and their links, are looked at again.
  function mark(x, z, r) {
    const s0 = square(x - r - SQ, z - r - SQ), s1 = square(x + r + SQ, z + r + SQ);
    for (let sz = (s0 / N) | 0; sz <= ((s1 / N) | 0); sz++) for (let sx = s0 % N; sx <= s1 % N; sx++) floors[sx + N * sz] = undefined;
    for (const k of links.keys()) {
      const [a, , b] = k.split('.').map(Number), hit = s => { const sx = s % N, sz = (s / N) | 0; return sx >= s0 % N && sx <= s1 % N && sz >= ((s0 / N) | 0) && sz <= ((s1 / N) | 0); };
      if (hit(a) || hit(b)) links.delete(k);
    }
  }
  return { ter, path, mark, floorsAt: (x, z) => fl(square(x, z)), square, floorsOf: fl, links };   // floorsOf and links: the NAV overlay (render/hud.js)
}

// The nav for this match's ground, made at first use.
export const navOf = G => (G.nav && G.nav.ter === G.ter ? G.nav : (G.nav = makeNav(G.ter)));

// Whether a mech at (x, y, z) can walk the straight line to (x1, z1), the
// first `reach` metres of it: stepped as the nav's links are.
export function walkable(ter, x, y, z, x1, z1, reach = Infinity) {
  const d = Math.min(hypot(x1 - x, z1 - z), reach), n = Math.ceil(d / STEP_M), ux = (x1 - x) / (hypot(x1 - x, z1 - z) || 1), uz = (z1 - z) / (hypot(x1 - x, z1 - z) || 1);
  for (let i = 1; i <= n; i++) {
    const px = x + ux * i * STEP_M, pz = z + uz * i * STEP_M, lid = y + CLIFF * STEP_M + 1, g = ter.groundBelow(px, lid, pz);
    if (g >= lid - 0.01 || ter.solid(px, g + HEADROOM, pz)) return false;
    y = g;
  }
  return true;
}

// Which way a foe should walk to reach (x, y, z): straight at it when the way
// is open (null), else toward the next point of a nav path, made again every
// ROUTE_EVERY seconds or when the goal moves. Null too when there is no path:
// the feelers do what they can.
export const ROUTE_EVERY = 3, ROUTE_NEAR = 14;
export function routeYaw(G, e, x, y, z) {
  const a = e.ai, r = a.route;
  if (!r || G.time - r.t > ROUTE_EVERY || hypot(r.x - x, r.z - z) > 40) {
    const open = walkable(G.ter, e.x, e.y, e.z, x, z, 160);
    a.route = { t: G.time, x, z, pts: open ? null : navOf(G).path(e.x, e.y, e.z, x, y, z) };
  }
  const pts = a.route.pts;
  while (pts && pts.length && hypot(pts[0][0] - e.x, pts[0][2] - e.z) < ROUTE_NEAR) pts.shift();
  return pts && pts.length ? Math.atan2(pts[0][0] - e.x, pts[0][2] - e.z) : null;
}

// Feelers: if the way ahead (FEEL_M) is a wall, turn along it: the nearest
// open heading, trying first the side turned to last time, so a foe follows
// a canyon wall instead of grinding into it.
export const FEEL_M = 12;
const TRY = [0.45, 0.9, 1.35, 1.8, 2.4];
export function feelers(G, e, yaw) {
  if (feelOpen(G, e, yaw)) return yaw;   // plain calls, no closures: this runs every frame for every foe on the move
  const side = e.ai.feelSide || 1;
  for (let i = 0; i < TRY.length; i++) {
    if (feelOpen(G, e, yaw + side * TRY[i])) return yaw + side * TRY[i];
    if (feelOpen(G, e, yaw - side * TRY[i])) { e.ai.feelSide = -side; return yaw - side * TRY[i]; }
  }
  return yaw;
}
function feelOpen(G, e, t) { return walkable(G.ter, e.x, e.y, e.z, e.x + Math.sin(t) * FEEL_M, e.z + Math.cos(t) * FEEL_M); }
