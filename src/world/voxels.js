import { makeTerrain, HALF } from './terrain.js';
import { clampN } from '../util/math.js';
import { polar } from '../sim/placement.js';
import { FS, PATCH, makePatch, inPatch, overXZ, contains, overlaps, union, fits, patchSample, patchHeight } from './finePatch.js';

const { floor, ceil, hypot, max, min } = Math;

// The ground as voxels (docs/specs/18-voxel-ground.md): a grid of 8 m cells,
// one byte of density per corner (above 128 is solid), from y = Y0 up. Today's
// hills are its base (makeTerrain's heights, so every mission keeps its shape);
// a mission's landmarks and the editor's strokes are laid on top, in order.
// Bedrock (the bottom two layers) never changes; outside the map is air.
export const VS = 8, Y0 = -44, NX = (2 * HALF) / VS, NY = 38, NZ = NX;
export const CS = 16, CX = ceil(NX / CS), CY = ceil(NY / CS), CZ = ceil(NZ / CS);
export const PX = NX + 1, PY = NY + 1, PZ = NZ + 1;
const STEPS = new Int32Array([1, -1, PX * PY, -PX * PY, PX, -PX]);   // the six face neighbours; down last, so it is tried first
export const cornerIndex = (i, j, k) => i + PX * (j + PY * k);
// Density is metres from the surface over DS, so slopes up to ~60° keep their shape between corners.
export const DS = 2 * VS;
// The soft ground over the rock band: this deep under the ground as built (digging: spec 18).
export const SOFT = 6;
const Q = d => (d <= -1 ? 1 : d >= 1 ? 255 : Math.round(d * 127) + 128);   // never 0, so 128 is the one boundary byte
const BEDROCK = 1;   // corners j <= 1 stay solid
// A fill past this many corners is part of the land (held up); an island under SHATTER corners breaks up as it lands.
export const ISLAND_MAX = 4096, SHATTER = 8, TORQUE_GROW = 6;   // TORQUE_GROW: the torque rule's check box, cells around a dig
const LIST_MAX = 1 << 19;
let MARK = null, LIST = null, STACK = null;   // the support check's scratch (groundApi islands)

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
  const G = { D, top, seed, flat: !!opts.flat, dirty: new Set(), rev: 0, patches: null, fineNear: null };   // patches, fineNear: fine digging (fineOn), there from the start so the object keeps its shape
  const ground = Object.assign(G, groundApi(G));
  ground.retop(0, NX, 0, NZ);
  for (const l of g.landmarks || []) landmark(ground, l);
  if (g.pockets) pockets(ground, seed);
  for (const s of g.strokes || []) ground.stroke(s);
  ground.base = ground.top.slice();   // the tops as built: digging measures the rock band from these
  ground.dirty.clear();   // a fresh ground is built whole; only edits after this rebuild chunks
  return ground;
}

function groundApi(G) {
  const { D, top } = G;
  const val = (i, j, k) => (D[cornerIndex(i, j, k)] - 128) / 127;
  // The ground anywhere: the newest fine patch the point is in (world/finePatch.js,
  // docs/specs/27-fine-dig.md), else the 8 m grid. Every query reads it.
  function sample(x, y, z) {
    const P = G.patches;   // small on purpose: inlined into every query, so nothing boxes; with patches, finer()
    return P && P.length ? finer(P, x, y, z) : csample(x, y, z);
  }
  function finer(P, x, y, z) {
    for (let n = P.length - 1; n >= 0; n--) { const p = P[n]; if (x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1 && z >= p.z0 && z < p.z1) return patchSample(p, x, y, z, csample(x, y, z)); }
    return csample(x, y, z);
  }
  // Density on the 8 m grid by trilinear blend: below the grid is rock, beside or above it air.
  function csample(x, y, z) {
    const fx = (x + HALF) / VS, fy = (y - Y0) / VS, fz = (z + HALF) / VS;
    if (fy <= 0) return 1;
    if (fx < 0 || fz < 0 || fx >= NX || fz >= NZ || fy >= NY) return -1;
    const i = fx | 0, j = fy | 0, k = fz | 0, u = fx - i, v = fy - j, w = fz - k;
    const o = cornerIndex(i, j, k), oy = o + PX, oz = o + PX * PY, oyz = oz + PX;   // plain numbers, no closures: this runs thousands of times a frame
    const a = (D[o] * (1 - u) + D[o + 1] * u) * (1 - v) + (D[oy] * (1 - u) + D[oy + 1] * u) * v;
    const b = (D[oz] * (1 - u) + D[oz + 1] * u) * (1 - v) + (D[oyz] * (1 - u) + D[oyz + 1] * u) * v;
    return ((a * (1 - w) + b * w) - 128) / 127;
  }
  // The top surface under the sky: a fine patch's over it, else the 8 m grid's.
  function height(x, z) {
    const P = G.patches;   // as sample: small, so it inlines
    return P && P.length ? finerTop(P, x, z) : cheight(x, z);
  }
  function finerTop(P, x, z) {
    for (let n = P.length - 1; n >= 0; n--) if (overXZ(P[n], x, z)) return patchHeight(P[n], x, z);
    return cheight(x, z);
  }
  // The 8 m grid's top surface, blended between the four corner columns.
  // The mesh (mesher.js) is the same surface, smoothed: the two agree within
  // 0.6 m over nearly all of a map (test/mesher.test.js).
  function cheight(x, z) {
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
  // The same on the 8 m grid alone, under any fine patch (docs/specs/27-fine-dig.md;
  // `coarse.groundBelow`): its own copy, so neither one grows a branch or
  // calls through a variable (either can box every number it returns).
  function cgroundBelow(x, y, z, lo = Y0) {
    if (csample(x, y, z) > 0) return y;
    const step = VS / 4, h = cheight(x, z);
    let yy = y - step;
    if (y > h + 2 * step && csample(x, h + step, z) <= 0) yy = h + step;
    for (; yy > lo; yy -= step) {
      if (csample(x, yy, z) > 0) {
        let a = yy, b = yy + step;
        for (let n = 0; n < 7; n++) { const m = (a + b) / 2; if (csample(x, m, z) > 0) a = m; else b = m; }
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
  // The same on the 8 m grid alone (`coarse.ray`: the digger's aim, what a
  // scoop's ore counts, docs/specs/27-fine-dig.md).
  function cray(o, d, maxT) {
    const ox = +o[0], oy = +o[1], oz = +o[2], dx = +d[0], dy = +d[1], dz = +d[2], step = VS / 2, n = ceil(maxT / step);
    for (let k = 1; k <= n; k++) {
      const t = k === n ? maxT : k * step;
      if (csample(ox + dx * t, oy + dy * t, oz + dz * t) > 0) {
        let a = (k - 1) * step, b = t;
        for (let q = 0; q < 8; q++) { const m = (a + b) / 2; if (csample(ox + dx * m, oy + dy * m, oz + dz * m) > 0) b = m; else a = m; }
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
    chunks(i0, i1, j0, j1, k0, k1);
    // A patch reads the 8 m ground too (never rock where it's air): its tops again.
    const P = G.patches;
    if (P && P.length) for (const p of P) if (overlaps(p, [i0 - 1, i1 + 1, j0 - 1, j1 + 1, k0 - 1, k1 + 1])) topsOf(p);
  }
  function chunks(i0, i1, j0, j1, k0, k1) {
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
  const carve = (p, r) => { fine(p, r, CARVE); shape(p, r, (d, dist) => min(d, (dist - r) / DS)); };
  // A blast's dig (spec 18 § Digging in play): soft ground, the top SOFT
  // metres of the ground as built, goes to radius r; the rock band under it
  // only to r × `rock` (battle weapons: half); bedrock not at all. Each corner's
  // hole depends only on where it is, so digs still give the same bytes in any order.
  // `tally` (optional): its `rock` goes up by the corners under the soft band
  // this dig turns from solid to air (the digger's ore, docs/specs/20-build-and-fight.md),
  // its `soft` by those in the soft band (the digger's dirt, docs/specs/21-mining.md),
  // and its `corner(x, y, z, depth)`, if any, hears of each rock one, depth
  // below the ground as built (the seams: what each is worth).
  function dig(p, r, rock = 0.5, tally = null) {
    const [i0, i1, j0, j1, k0, k1] = box(p, r);
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    const base = G.base;
    fine(p, r, DIG, rock);
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const soft = base[i + PX * k] - SOFT;
      for (let j = j0; j <= j1; j++) {
        const y = Y0 + j * VS, o = cornerIndex(i, j, k), dist = hypot(-HALF + i * VS - p[0], y - p[1], -HALF + k * VS - p[2]), was = D[o];
        D[o] = Q(min((was - 128) / 127, (dist - (y >= soft ? r : r * rock)) / DS));
        if (tally && was > 128 && D[o] <= 128) {
          if (y >= soft) tally.soft = (tally.soft || 0) + 1;
          else { tally.rock++; if (tally.corner) tally.corner(-HALF + i * VS, y, -HALF + k * VS, soft + SOFT - y); }
        }
      }
    }
    touched(i0, i1, j0, j1, k0, k1);
    return [i0, i1, j0, j1, k0, k1];
  }
  // Falling ground (spec 18 § Falling ground). A solid corner is held up if a
  // chain of solid corners, face to face, links it to bedrock; a fill that
  // grows past ISLAND_MAX corners is part of the land and held up too. The
  // islands: solid corners in `b` (a box of corners, grown by one) that
  // nothing holds up, as arrays of corner indices, in a fixed order.
  function islands(b) {
    const i0 = clampN(b[0] - 1, 1, NX - 1), i1 = clampN(b[1] + 1, 1, NX - 1), j0 = clampN(b[2] - 1, BEDROCK + 1, NY - 1), j1 = clampN(b[3] + 1, BEDROCK + 1, NY - 1);
    const k0 = clampN(b[4] - 1, 1, NZ - 1), k1 = clampN(b[5] + 1, 1, NZ - 1), out = [];
    // Typed scratch shared by every ground, no garbage per dig: MARK 1 is in
    // this fill, 2 held up; LIST is every corner marked, cleared at the end.
    if (!MARK) { MARK = new Uint8Array(PX * PY * PZ); LIST = new Int32Array(LIST_MAX); STACK = new Int32Array(ISLAND_MAX + 8); }
    let nl = 0;
    seeds: for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const s0 = cornerIndex(i, j, k);
      if (D[s0] <= 128 || MARK[s0]) continue;
      if (nl > LIST_MAX - ISLAND_MAX - 8) break seeds;   // a huge check: the rest counts as held up
      const start = nl;
      let sp = 0, up = false;
      MARK[s0] = 1; LIST[nl++] = s0; STACK[sp++] = s0;
      while (sp && !up) {
        const o = STACK[--sp];
        for (let d = 0; d < 6; d++) {
          const n = o + STEPS[d], m = MARK[n];
          if (m === 2) { up = true; break; }
          if (m || D[n] <= 128) continue;
          if (((n / PX) | 0) % PY <= BEDROCK || nl - start >= ISLAND_MAX) { up = true; break; }
          MARK[n] = 1; LIST[nl++] = n; STACK[sp++] = n;
        }
      }
      if (!up) out.push(LIST.slice(start, nl).sort());
      for (let q = start; q < nl; q++) MARK[LIST[q]] = 2;
    }
    for (let q = 0; q < nl; q++) MARK[LIST[q]] = 0;
    return out;
  }
  // Overhangs that can't hold their weight (spec 18 § the torque rule). In
  // the box `b` grown by TORQUE_GROW, a solid corner is grounded if solid
  // corners run straight down from it to bedrock; hanging ones that touch
  // face to face are one overhang. Its attachments are the grounded corners
  // it touches; its section, how many columns those are (each solid to
  // bedrock, so the narrowest slice of what holds it). Its load is the sum
  // of each corner's reach: how far it sits sideways, in cells, from the
  // nearest attachment column. It breaks if load > k × section. Returns the
  // overhangs that break, as cell arrays for `fall`, and `ratios` (load over
  // section of every overhang looked at, for the tests and tuning). `weighed`
  // (the debug overlay's, sim/dig.js) gets each one's load, section, whether
  // it broke, and its middle in metres.
  function overhangs(b, k, ratios, weighed) {
    const i0 = clampN(b[0] - TORQUE_GROW, 1, NX - 1), i1 = clampN(b[1] + TORQUE_GROW, 1, NX - 1), j0 = clampN(b[2] - TORQUE_GROW, BEDROCK + 1, NY - 1), j1 = clampN(b[3] + TORQUE_GROW, BEDROCK + 1, NY - 1);
    const k0 = clampN(b[4] - TORQUE_GROW, 1, NZ - 1), k1 = clampN(b[5] + TORQUE_GROW, 1, NZ - 1), out = [], air = new Map();
    if (!MARK) { MARK = new Uint8Array(PX * PY * PZ); LIST = new Int32Array(LIST_MAX); STACK = new Int32Array(ISLAND_MAX + 8); }
    // The first air going up a column from bedrock: under it, the column is grounded.
    const firstAir = (i, kk) => {
      const c = i + PX * kk;
      let v = air.get(c);
      if (v === undefined) { v = BEDROCK + 1; while (v < NY && D[cornerIndex(i, v, kk)] > 128) v++; air.set(c, v); }
      return v;
    };
    const grounded = o => ((o / PX) | 0) % PY < firstAir(o % PX, (o / (PX * PY)) | 0);
    let nl = 0;
    for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const s0 = cornerIndex(i, j, kk);
      if (D[s0] <= 128 || MARK[s0] || grounded(s0)) continue;
      if (nl > LIST_MAX - ISLAND_MAX - 8) break;
      const start = nl, cols = new Set();
      let sp = 0, big = false;
      MARK[s0] = 1; LIST[nl++] = s0; STACK[sp++] = s0;
      while (sp) {
        const o = STACK[--sp];
        for (let d = 0; d < 6; d++) {
          const n = o + STEPS[d];
          if (MARK[n] || D[n] <= 128) continue;
          if (grounded(n)) { cols.add(n % PX + PX * ((n / (PX * PY)) | 0)); continue; }
          if (nl - start >= ISLAND_MAX) { big = true; continue; }   // too big to weigh here: part of the land
          MARK[n] = 1; LIST[nl++] = n; STACK[sp++] = n;
        }
      }
      if (big || !cols.size) continue;   // no attachments: an island, which the support fill drops
      const ax = [], az = [];
      for (const c of cols) { ax.push(c % PX); az.push((c / PX) | 0); }
      let load = 0;
      for (let q = start; q < nl; q++) {
        const o = LIST[q], ci = o % PX, ck = (o / (PX * PY)) | 0;
        let best = Infinity;
        for (let a = 0; a < ax.length; a++) { const dx = ci - ax[a], dz = ck - az[a], d2 = dx * dx + dz * dz; if (d2 < best) best = d2; }
        load += Math.sqrt(best);
      }
      ratios?.push(load / cols.size);
      if (weighed) {
        let sx = 0, sy = 0, sz = 0;
        for (let q = start; q < nl; q++) { const o = LIST[q]; sx += o % PX; sy += ((o / PX) | 0) % PY; sz += (o / (PX * PY)) | 0; }
        const n = nl - start;
        weighed.push({ load, section: cols.size, broke: load > k * cols.size, x: -HALF + sx / n * VS, y: Y0 + sy / n * VS, z: -HALF + sz / n * VS });
      }
      if (load > k * cols.size) out.push(LIST.slice(start, nl).sort());
    }
    for (let q = 0; q < nl; q++) MARK[LIST[q]] = 0;
    return out;
  }
  // An island comes down: cut out, dropped whole cells straight down to the
  // first ground under any of its columns, and, unless it is a small one that
  // shatters (under SHATTER corners), stamped back as a heap. Whole cells, so
  // every client stamps the same bytes. Returns what the drawing needs: the
  // cells' bytes as they were, how far (cells), and the boxes it changed.
  function fall(cells) {
    const bytes = new Uint8Array(cells.length), low = new Map();
    let i0 = NX, i1 = 0, j0 = NY, j1 = 0, k0 = NZ, k1 = 0;
    cells.forEach((o, n) => {
      bytes[n] = D[o];
      const i = o % PX, j = ((o / PX) | 0) % PY, k = (o / (PX * PY)) | 0, col = i + PX * k;
      if (!low.has(col) || j < low.get(col)) low.set(col, j);
      i0 = min(i0, i); i1 = max(i1, i); j0 = min(j0, j); j1 = max(j1, j); k0 = min(k0, k); k1 = max(k1, k);
    });
    dropIn([i0 - 1, i1 + 1, 0, j1 + 1, k0 - 1, k1 + 1]);   // a fine patch there settles at once: the 8 m grid says what falls
    for (const o of cells) D[o] = 1;
    let drop = NY;
    for (const [col, j] of low) {
      const i = col % PX, k = (col / PX) | 0;
      let jj = j - 1;
      while (jj > 0 && D[cornerIndex(i, jj, k)] <= 128) jj--;
      drop = min(drop, j - 1 - jj);
    }
    const heap = cells.length >= SHATTER && drop > 0, prev = new Uint8Array(cells.length);   // prev: the bytes the heap went over (the renderer hides it until it lands)
    if (heap) cells.forEach((o, n) => { const t = o - drop * PX; prev[n] = D[t]; if (bytes[n] > D[t]) D[t] = bytes[n]; });
    touched(i0, i1, max(j0 - drop, BEDROCK + 1), j1, k0, k1);
    return { cells, bytes, prev, drop, heap, box: [i0, i1, j0, j1, k0, k1] };
  }
  // Copy a box of corners from another ground of the same map (net/dig sync:
  // the confirmed ground's bytes after a fall).
  function copyBox(from, b) {
    const [i0, i1, j0, j1, k0, k1] = b;
    dropIn(b);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) { const o = cornerIndex(i0, j, k); D.set(from.D.subarray(o, o + i1 - i0 + 1), o); }
    touched(i0, i1, j0, j1, k0, k1);
  }
  // A short fingerprint of the ground (FNV-1a over the bytes): two clients that
  // agree on it have the same ground (the smoke test and the sync tests).
  function hash() {
    let h = 0x811c9dc5;
    for (let n = 0; n < D.length; n++) { h ^= D[n]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  const build = (p, r) => { fine(p, r, BUILD); shape(p, r, (d, dist) => max(d, (r - dist) / DS)); };
  // A pile (the digger's DUMP, docs/specs/21-mining.md § Dirt): a cone of
  // ground `h` high and `r` across its foot, raised column by column off
  // whatever each column's top is, so its height comes out exact on the 8 m
  // grid (a sphere built there spreads wide and low) and piles stack.
  function pile(x, z, h, r) {
    const t0 = height(x, z);
    fine([x, t0 + h / 2, z], max(r, h), PILE, h, r);
    const i0 = clampN(floor((x + HALF - r) / VS), 1, NX - 1), i1 = clampN(ceil((x + HALF + r) / VS), 1, NX - 1);
    const k0 = clampN(floor((z + HALF - r) / VS), 1, NZ - 1), k1 = clampN(ceil((z + HALF + r) / VS), 1, NZ - 1);
    let j0 = NY, j1 = 0;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const d = hypot(-HALF + i * VS - x, -HALF + k * VS - z);
      if (d >= r) continue;
      const t = top[i + PX * k], want = t + h * (1 - d / r);
      // Each corner up the column takes the larger of the ground and the cone's surface.
      const ja = max(BEDROCK + 1, floor((t - DS - Y0) / VS)), jb = min(NY - 1, ceil((want + DS - Y0) / VS));
      for (let j = ja; j <= jb; j++) { const o = cornerIndex(i, j, k); D[o] = Q(max((D[o] - 128) / 127, (want - (Y0 + j * VS)) / DS)); }
      j0 = min(j0, ja); j1 = max(j1, jb);
    }
    if (j0 <= j1) touched(i0, i1, j0, j1, k0, k1);
  }
  // Smooth: each corner in reach eases toward the mean of its six neighbours (read from a copy).
  function smooth(p, r) {
    const [i0, i1, j0, j1, k0, k1] = box(p, r);
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    dropIn([i0, i1, j0, j1, k0, k1]);
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
    dropIn([i0, i1, 0, j1, k0, k1]);
    for (let k = k0; k <= k1; k++) for (let j = BEDROCK + 1; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * VS, y = Y0 + j * VS, z = -HALF + k * VS, o = cornerIndex(i, j, k);
      const side = min(x - x0, x1 - x, z - z0, z1 - z), d = grade === Infinity ? min(top - y, side) : min(top - y, side * grade - y) / Math.hypot(1, grade);
      D[o] = Q(max((D[o] - 128) / 127, d / DS));
    }
    touched(i0, i1, BEDROCK + 1, j1, k0, k1);
  }
  // An editor stroke: [op, x, y, z, r], op 0 carve, 1 build, 2 smooth.
  const stroke = ([op, x, y, z, r]) => (op === 0 ? carve : op === 1 ? build : smooth)([x, y, z], r);
  const mark = b => touched(...b);   // mesh a box of corners again (a heap that has landed)

  const CARVE = 0, DIG = 1, BUILD = 2, PILE = 3;   // fine()'s edits
  // Fine patches (world/finePatch.js, docs/specs/27-fine-dig.md): off until
  // play starts (a mission's own strokes never make them). `G.patches` holds
  // them oldest first; sample and height read the newest a point is in.
  const GRID = { VS, Y0 };
  const baseAt = (x, z) => {   // the ground as built, between its corner columns (where the soft band ends)
    const B = G.base || top, gx = clampN((x + HALF) / VS, 0, NX - 1e-4), gz = clampN((z + HALF) / VS, 0, NZ - 1e-4), i = gx | 0, k = gz | 0, u = gx - i, w = gz - k, o = i + PX * k;
    return (B[o] * (1 - u) + B[o + 1] * u) * (1 - w) + (B[o + PX] * (1 - u) + B[o + PX + 1] * u) * w;
  };
  const inRock = (x, y, z) => y < baseAt(x, z) - SOFT;   // below the soft band: what a bucket clunks on (sim/tools.js)
  // The coarse corners a patch needs to hold an edit reaching `reach` m from c: its box, the margin round it.
  const fineBox = (c, reach) => {
    const m = PATCH.margin;
    return [clampN(floor((c[0] + HALF - reach) / VS) - m, 0, NX), clampN(ceil((c[0] + HALF + reach) / VS) + m, 0, NX),
      clampN(floor((c[1] - Y0 - reach) / VS) - m, 0, NY), clampN(ceil((c[1] - Y0 + reach) / VS) + m, 0, NY),
      clampN(floor((c[2] + HALF - reach) / VS) - m, 0, NZ), clampN(ceil((c[2] + HALF + reach) / VS) + m, 0, NZ)];
  };
  // An edit, before the 8 m grid takes it: a patch to hold it (one that does,
  // one grown to, or a new one read from the ground as it is now), then the
  // edit into every patch it reaches (editFine) at each fine corner within
  // reach + 2 fine cells, so the surface between them is the sphere's. `op`
  // and `a`, `b` say which edit: CARVE (r), DIG (r, rock: a), BUILD (r), PILE
  // (h: a, foot radius: b). No closures: these loops run over tens of
  // thousands of corners, and a call through one boxes every number it returns.
  function fine(c, r, op, a = 0, b2 = 0) {
    const P = G.patches;
    if (!P) return;
    const reach = r + 2 * FS, b = fineBox(c, reach), near = !G.fineNear || hypot(c[0] - G.fineNear[0], c[2] - G.fineNear[1]) < G.fineNear[2];
    if (near && !P.some(p => contains(p, b))) {
      const n = P.findIndex(p => overlaps(p, b) && fits(union(p, b)));
      if (n >= 0) { P[n] = fillPatch(makePatch(GRID, union(P[n], b), P[n])); topsOf(P[n]); chunksOf(P[n]); }
      else {
        const p = fillPatch(makePatch(GRID, b));
        topsOf(p); P.push(p); chunksOf(p);
        if (P.length > PATCH.max) P.find(q => !q.force).force = true;   // the oldest settles at once (sim/dig.js)
      }
    }
    for (const p of P) if (overlaps(p, b)) editFine(p, c, reach, r, op, a, b2);   // their tops come when the 8 m grid has taken it too (touched)
    G.rev++;
  }
  // A new patch's bytes that `makePatch` didn't keep from the one it grew from: the ground as it reads now.
  function fillPatch(p) {
    const K = p.keep, nx = p.nx, ny = p.ny, D2 = p.D;
    for (let k = 0; k < p.nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (K) { const a = i - K[0], b = j - K[1], c = k - K[2], q = K[3]; if (a >= 0 && b >= 0 && c >= 0 && a < q.nx && b < q.ny && c < q.nz) continue; }
      D2[i + nx * (j + ny * k)] = Q(sample(p.x0 + i * FS, p.y0 + j * FS, p.z0 + k * FS));
    }
    p.keep = null;
    return p;
  }
  // One edit into a patch, at each fine corner within `reach` of c, only where
  // the 8 m grid may change too (not bedrock, not the map's edge). A patch
  // caught settling keeps the slump so far as its own ground and stops.
  function editFine(p, c, reach, r, op, a, b2) {
    if (p.blend > 0) bake(p);
    const i0 = max(0, floor((c[0] - reach - p.x0) / FS)), i1 = min(p.nx - 1, ceil((c[0] + reach - p.x0) / FS));
    const j0 = max(0, floor((c[1] - reach - p.y0) / FS)), j1 = min(p.ny - 1, ceil((c[1] + reach - p.y0) / FS));
    const k0 = max(0, floor((c[2] - reach - p.z0) / FS)), k1 = min(p.nz - 1, ceil((c[2] + reach - p.z0) / FS));
    const lo = Y0 + BEDROCK * VS, ys = Y0 + (NY - 1) * VS, xs = -HALF + VS, xe = HALF - VS, F = p.D, nx = p.nx, nxy = nx * p.ny;
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const x = p.x0 + i * FS, z = p.z0 + k * FS;
      if (x < xs || x > xe || z < xs || z > xe) continue;
      const soft = op === DIG ? baseAt(x, z) - SOFT : 0, dd = hypot(x - c[0], z - c[2]), want = op === PILE && dd < b2 ? height(x, z) + a * (1 - dd / b2) : 0;
      for (let j = j0; j <= j1; j++) {
        const y = p.y0 + j * FS;
        if (y <= lo || y > ys) continue;
        const o = i + nx * j + nxy * k, d = (F[o] - 128) / 127, dist = hypot(dd, y - c[1]);
        F[o] = Q(op === CARVE ? min(d, (dist - r) / DS) : op === DIG ? min(d, (dist - (y >= soft ? r : r * a)) / DS)
          : op === BUILD ? max(d, (r - dist) / DS) : dd < b2 ? max(d, (want - y) / DS) : d);
      }
    }
    p.edits++; p.rev++;
  }
  // The slump so far becomes the patch's own bytes; the settle stops.
  function bake(p) {
    const F = p.D, nx = p.nx, nxy = nx * p.ny, t = p.blend;
    for (let k = 0; k < p.nz; k++) for (let j = 0; j < p.ny; j++) for (let i = 0; i < nx; i++) {
      const x = p.x0 + i * FS, y = p.y0 + j * FS, z = p.z0 + k * FS, o = i + nx * j + nxy * k, c = csample(x, y, z), d = min((F[o] - 128) / 127, c);
      F[o] = Q(d + (c - d) * t);
    }
    p.blend = 0; p.settling = false; p.rev++;
  }
  // The bytes the mesher sees (render/ground.js): the ground at each corner as
  // sample reads it, into `out` if it's the right size (the renderer passes
  // the last one back to fill again), else a new array.
  function bytesOf(p, out = null) {
    if (!out || out.length !== p.D.length) out = new Uint8Array(p.D.length);
    const F = p.D, nx = p.nx, nxy = nx * p.ny, t = p.blend;
    for (let k = 0; k < p.nz; k++) for (let j = 0; j < p.ny; j++) for (let i = 0; i < nx; i++) {
      const o = i + nx * j + nxy * k, c = csample(p.x0 + i * FS, p.y0 + j * FS, p.z0 + k * FS), d = min((F[o] - 128) / 127, c);
      out[o] = Q(t > 0 ? d + (c - d) * t : d);
    }
    return out;
  }
  const chunksOf = p => chunks(p.i0, p.i1, p.j0, p.j1, p.k0, p.k1);
  // A patch's fine column tops again (after an edit, or as it slumps).
  // Each fine column's top (metres): the highest crossing from rock to air in
  // the patch as it reads (so a slump shows). Rock at the patch's top: the
  // ground is higher, and the 8 m tops say where; no rock in it: the same,
  // lower down.
  function topsOf(p) {
    const T = p.top;
    for (let k = 0; k < p.nz; k++) for (let i = 0; i < p.nx; i++) {
      const x = p.x0 + i * FS, z = p.z0 + k * FS, ytop = p.y0 + (p.ny - 1) * FS;
      let t = NaN, above = patchSample(p, x, ytop, z, csample(x, ytop, z));
      if (above > 0) t = cheight(x, z);
      else for (let j = p.ny - 2; j >= 0; j--) {
        const y = p.y0 + j * FS, d = patchSample(p, x, y, z, csample(x, y, z));
        if (d > 0) { t = y + FS * d / (d - above); break; }
        above = d;
      }
      T[i + p.nx * k] = t === t ? t : min(p.y0, cheight(x, z));
    }
  }
  // Patches in a box of corners go at once (a fall, a copy, the editor's tools): the 8 m grid holds there.
  function dropIn(b) {
    const P = G.patches;
    if (!P || !P.length) return;
    for (let n = P.length - 1; n >= 0; n--) if (overlaps(P[n], b)) dropPatch(P[n]);
  }
  function dropPatch(p) {
    const P = G.patches, n = P ? P.indexOf(p) : -1;
    if (n < 0) return;
    P.splice(n, 1); chunksOf(p); G.rev++;
  }
  // Play starts: fine patches from now on. `fineNear` [x, z, r] (sim/dig.js
  // keeps it at you): edits further off make no new patch, as nobody would see it.
  const fineOn = () => { G.patches ||= []; };
  // What the coarse mesher skips in a block of corners from (i0, j0, k0): each
  // patch's inside (all but its outer ring), in the block's own corners, as
  // [i0, i1, j0, j1, k0, k1]. The patch's own mesh draws it (render/ground.js).
  function skipIn(i0, j0, k0, dims) {
    const P = G.patches, out = [];
    if (!P) return out;
    for (const p of P) {
      const s = [p.i0 + 1 - i0, p.i1 - 1 - i0, p.j0 + 1 - j0, p.j1 - 1 - j0, p.k0 + 1 - k0, p.k1 - 1 - k0];
      if (s[1] >= 0 && s[3] >= 0 && s[5] >= 0 && s[0] < dims[0] && s[2] < dims[1] && s[4] < dims[2]) out.push(s);
    }
    return out;
  }
  // The 8 m grid's ground alone, under any fine patch: what the AI walks by
  // (sim/ai/nav.js), so a scoop's round pits never read as drops or walls.
  const coarse = { D, top, sample: csample, height: cheight, solid: (x, y, z) => csample(x, y, z) > 0, groundBelow: cgroundBelow, ray: cray };
  return { coarse, inRock, sample, csample, height, cheight, solid, groundBelow, ray, carve, dig, islands, overhangs, fall, copyBox, mark, build, pile, smooth, block, stroke, retop, hash, fineOn, dropPatch, topsOf, skipIn, bytesOf, inPatch };
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

// A second ground with the same bytes (the net's confirmed ground, sim/dig.js).
export function cloneGround(g) {
  const c = { D: g.D.slice(), top: g.top.slice(), base: g.base, seed: g.seed, flat: g.flat, dirty: new Set(), rev: 0, patches: null, fineNear: null };
  return Object.assign(c, groundApi(c));
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
