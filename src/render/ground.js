import { chunkCorners, farCorners, CX, CY, CZ, CS, CN, VS, PX, PY } from '../world/voxels.js';
import { HALF } from '../world/terrain.js';
import { meshChunk, boundsOf } from '../world/mesher.js';
import { boxVisible, M as Mat } from '../util/math.js';
import { FS } from '../world/finePatch.js';

// The voxel ground on the GPU (docs/specs/18-voxel-ground.md § Rendering).
// The map is cut into groups of 2 × 2 chunk columns (256 m squares). A group
// past LOD_AT is drawn from its far mesh (16 m cells, about a quarter of the
// triangles); a nearer one from its chunks (8 m cells), meshed when it first
// comes near. Either way it is one buffer and one draw, culled by its box and
// the fog. Meshing is world/mesher.js, in a worker, nearest first; what is
// right around you when a world loads is meshed at once, and without a worker
// the queue is meshed here, a couple of ms a frame. A dig marks chunks dirty
// (world/voxels.js), and they and the far meshes over them are meshed again.
const LOD_AT = 300, NEAR_NOW = 200, BUDGET_MS = 2, SEND_MAX = 32, G2 = 2, GX = Math.ceil(CX / G2), GZ = Math.ceil(CZ / G2), SIZE = CS * VS * G2;
const FAR = 1 << 16;   // a job id at or past this is a group's far mesh
const plain = (p, seed) => ({ low: p.low, mid: p.mid, high: p.high, rock: p.rock, ore: p.ore, seed });   // seed: where the seams run (world/seams.js)
const groupDist = (g, eye) => {   // from eye to the group's square, flat
  const x0 = -HALF + (g % GX) * SIZE, z0 = -HALF + ((g / GX) | 0) * SIZE;
  return Math.hypot(Math.max(x0 - eye[0], 0, eye[0] - x0 - SIZE), Math.max(z0 - eye[2], 0, eye[2] - z0 - SIZE));
};
const chunkGroup = id => { const cx = id % CX, cz = (id / (CX * CY)) | 0; return ((cx / G2) | 0) + GX * ((cz / G2) | 0); };
const jobGroup = id => (id >= FAR ? id - FAR : chunkGroup(id));
const chunksOf = g => {
  const gx = g % GX, gz = (g / GX) | 0, ids = [];
  for (let cz = gz * G2; cz < Math.min(gz * G2 + G2, CZ); cz++) for (let cy = 0; cy < CY; cy++) for (let cx = gx * G2; cx < Math.min(gx * G2 + G2, CX); cx++) ids.push(cx + CX * (cy + CY * cz));
  return ids;
};
const CHUNKS_OF = Array.from({ length: GX * GZ }, (_, g) => chunksOf(g));

export function createGround(R) {
  const gl = R.gl;
  let worker = null, workerOk = typeof Worker !== 'undefined';
  let ground = null, pal = null, world = 0, inFlight = 0, queue = [];
  const mesh = new Array(FAR + GX * GZ).fill(null), ver = new Int32Array(FAR + GX * GZ), waiting = new Uint8Array(FAR + GX * GZ);
  const newPart = () => ({ buf: null, count: 0, first: 0, lo: null, hi: null, dirty: false });
  const groups = Array.from({ length: GX * GZ }, () => ({ near: newPart(), far: newPart(), wanted: false, left: 0 }));
  // The far meshes share a buffer per row of groups, so neighbours drawn far are one draw.
  const rows = Array.from({ length: GZ }, () => ({ buf: null, dirty: false }));

  function startWorker() {
    if (worker || !workerOk) return worker;
    try {
      /* global __PWA__ */
      const url = typeof __PWA__ !== 'undefined' ? new URL('groundWorker.js', document.baseURI) : new URL('./groundWorker.js', import.meta.url);
      worker = new Worker(url, { type: 'module' });
      worker.onmessage = ({ data }) => { if (data.world === world) { inFlight--; took(data.id, data.ver, data.f, data.box); } };   // an old world's: dropped (load zeroed the count)
      worker.onerror = () => { workerOk = false; worker = null; inFlight = 0; for (let id = 0; id < waiting.length; id++) if (waiting[id] === 2) waiting[id] = 1, queue.push(id); };
    } catch { workerOk = false; worker = null; }
    return worker;
  }
  // Ground still falling (sim/dig.js G.falls) is drawn by render/falls.js;
  // the grid already has its heap where it lands, so near chunks are meshed
  // with the bytes from before it, until it lands (then they are marked again).
  let falling = [];
  const corners = id => {
    if (id >= FAR) { const g = id - FAR; return farCorners(ground, (g % GX) * G2, ((g / GX) | 0) * G2, G2); }
    const cx = id % CX, cy = ((id / CX) | 0) % CY, cz = (id / (CX * CY)) | 0, c = chunkCorners(ground, cx, cy, cz);
    c.skip = ground.skipIn ? ground.skipIn(cx * CS - 1, cy * CS - 1, cz * CS - 1, c.dims) : null;   // a fine patch's inside: its own mesh draws it
    for (const f of falling) {
      if (!f.heap) continue;
      f.cells.forEach((o, n) => {
        const t = o - f.drop * PX, i = t % PX - cx * CS + 1, j = ((t / PX) | 0) % PY - cy * CS + 1, k = ((t / (PX * PY)) | 0) - cz * CS + 1;
        if (i >= 0 && j >= 0 && k >= 0 && i < CN && j < CN && k < CN) c.D[i + CN * (j + CN * k)] = f.prev[n];
      });
    }
    return c;
  };
  function took(id, v, f, box) {
    if (v !== ver[id]) return;   // edited again since: a newer one is on its way
    if (waiting[id]) { waiting[id] = 0; if (id < FAR) groups[chunkGroup(id)].left--; }
    mesh[id] = box ? { f, lo: box[0], hi: box[1] } : null;
    const gr = groups[jobGroup(id)];
    if (id >= FAR) rows[((id - FAR) / GX) | 0].dirty = true; else gr.near.dirty = true;
  }
  function meshHere(id) {
    const c = corners(id), f = meshChunk(c.D, c.T, c.dims, c.o, c.s, pal, c.skip);
    took(id, ver[id], f, boundsOf(f));
  }
  // Queue a job (again, if it was done or is in the worker: a dig; what's in the worker is stale then).
  function want(id) {
    if (waiting[id] === 1) return;
    if (!waiting[id] && id < FAR) groups[chunkGroup(id)].left++;
    waiting[id] = 1; queue.push(id);
  }
  const byDistance = eye => (a, b) => groupDist(jobGroup(a), eye) - groupDist(jobGroup(b), eye) || (a >= FAR) - (b >= FAR);

  // A new world: far meshes for everything, chunks for what's near `eye`.
  function load(g, p, eye = [0, 0, 0]) {
    ground = g; pal = plain(p, g.seed); world++; inFlight = 0;
    for (const m of patches.values()) if (m.part.buf) gl.deleteBuffer(m.part.buf);
    patches.clear();
    mesh.fill(null); ver.fill(0); waiting.fill(0); queue = [];
    for (const gr of groups) { gr.wanted = false; gr.left = 0; gr.near.dirty = true; }
    for (const row of rows) row.dirty = true;
    if (startWorker()) worker.postMessage({ pal });
    for (let gi = 0; gi < groups.length; gi++) {
      const d = groupDist(gi, eye);
      if (d < NEAR_NOW) { groups[gi].wanted = true; for (const id of CHUNKS_OF[gi]) meshHere(id); }
      want(FAR + gi);
    }
    g.dirty.clear();
    tick(eye);
  }

  // Each frame, before drawing: what the sim dug, what came near, then send or mesh some, then upload.
  let lastEye = [0, 0, 0];
  function tick(eye, falls = []) {
    falling = falls;
    if (!ground) return;
    lastEye = eye;
    let added = false;
    if (ground.dirty.size) {
      for (const id of ground.dirty) {
        const gi = chunkGroup(id), cx = id % CX, cz = (id / (CX * CY)) | 0, gx = gi % GX, gz = (gi / GX) | 0;
        if (groups[gi].wanted) { ver[id]++; want(id); }
        // The far meshes over it: its group's, and the neighbour's its overlap reaches into.
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const ox = gx + dx, oz = gz + dz;
          if (ox < 0 || oz < 0 || ox >= GX || oz >= GZ) continue;
          if (dx && (dx < 0 ? cx % G2 !== 0 : cx % G2 !== G2 - 1)) continue;
          if (dz && (dz < 0 ? cz % G2 !== 0 : cz % G2 !== G2 - 1)) continue;
          ver[FAR + ox + GX * oz]++; want(FAR + ox + GX * oz);
        }
      }
      ground.dirty.clear();
      added = true;
    }
    for (let gi = 0; gi < groups.length; gi++) {
      const gr = groups[gi];
      if (!gr.wanted && groupDist(gi, eye) < LOD_AT + 64) { gr.wanted = true; for (const id of CHUNKS_OF[gi]) want(id); added = true; }
    }
    if (added) queue.sort(byDistance(eye));
    if (queue.length) {
      if (startWorker()) {
        for (let n = 0; n < SEND_MAX && queue.length && inFlight < SEND_MAX * 2; n++) {
          const id = queue.shift(), c = corners(id);
          waiting[id] = 2;
          worker.postMessage({ id, ver: ver[id], world, D: c.D, T: c.T, dims: c.dims, o: c.o, s: c.s, skip: c.skip }, [c.D.buffer, c.T.buffer]);
          inFlight++;
        }
      } else {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < BUDGET_MS) meshHere(queue.shift());
      }
    }
    upload();
    tickPatches();
  }

  // Fine patches (world/finePatch.js, docs/specs/27-fine-dig.md): each meshed
  // whole at 2 m, here for now, at most 10 times a second while it changes
  // (being dug, or slumping as it settles). The coarse chunks skip its inside.
  // A patch that's gone stays drawn until the chunks round it have been
  // meshed again without the gap (or 2 s), so the ground never shows a hole.
  const patches = new Map(), REMESH_MS = 100, GONE_MS = 2000;
  function tickPatches() {
    const P = ground.patches || [], now = performance.now();
    for (const p of P) {
      let m = patches.get(p.id);
      if (!m) { m = { part: newPart(), rev: -1, t: -Infinity, gone: 0, groups: [] }; patches.set(p.id, m); }
      m.gone = 0;
      m.groups = groupsOver(p.x0, p.z0, p.x1, p.z1);
      if (m.rev === p.rev || now - m.t < REMESH_MS) continue;
      m.rev = p.rev; m.t = now;
      const f = meshChunk(ground.bytesOf(p), p.top, [p.nx, p.ny, p.nz], [p.x0, p.y0, p.z0], FS, pal), b = boundsOf(f);
      m.part.count = f.length / 9;
      if (!b) continue;
      m.part.lo = b[0]; m.part.hi = b[1];
      if (!m.part.buf) m.part.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, m.part.buf);
      gl.bufferData(gl.ARRAY_BUFFER, f, gl.DYNAMIC_DRAW);
      R.curMesh = null;
    }
    for (const [id, m] of patches) {
      if (P.some(p => p.id === id)) continue;
      if (!m.gone) m.gone = now;
      const meshed = m.groups.every(gi => !groups[gi].left && !groups[gi].near.dirty);
      if ((meshed && now - m.gone > 50) || now - m.gone > GONE_MS) { if (m.part.buf) gl.deleteBuffer(m.part.buf); patches.delete(id); }
    }
  }
  const groupsOver = (x0, z0, x1, z1) => {
    const out = [], g = v => Math.floor((v + HALF) / SIZE);
    for (let gz = Math.max(0, g(z0)); gz <= Math.min(GZ - 1, g(z1)); gz++) for (let gx = Math.max(0, g(x0)); gx <= Math.min(GX - 1, g(x1)); gx++) out.push(gx + GX * gz);
    return out;
  };
  // A part's buffer is its meshes end to end, re-sent whole when any of them changes.
  function fill(part, ids) {
    part.dirty = false;
    let len = 0;
    for (const id of ids) if (mesh[id]) len += mesh[id].f.length;
    part.count = len / 9;
    if (!len) return;
    const all = new Float32Array(len), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let o = 0;
    for (const id of ids) {
      const m = mesh[id];
      if (!m) continue;
      all.set(m.f, o); o += m.f.length;
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], m.lo[a]); hi[a] = Math.max(hi[a], m.hi[a]); }
    }
    part.lo = lo; part.hi = hi;
    if (!part.buf) part.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, part.buf);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
    R.curMesh = null;   // the renderer's bound-buffer cache is stale now
  }
  // A row's far meshes end to end; each group's part points into it.
  function fillRow(gz) {
    const row = rows[gz];
    row.dirty = false;
    let len = 0;
    for (let gx = 0; gx < GX; gx++) { const m = mesh[FAR + gx + GX * gz]; if (m) len += m.f.length; }
    const all = new Float32Array(len);
    let o = 0;
    for (let gx = 0; gx < GX; gx++) {
      const m = mesh[FAR + gx + GX * gz], part = groups[gx + GX * gz].far;
      part.first = o / 9; part.count = m ? m.f.length / 9 : 0;
      if (m) { all.set(m.f, o); o += m.f.length; part.lo = m.lo; part.hi = m.hi; }
    }
    if (!row.buf) row.buf = gl.createBuffer();
    for (let gx = 0; gx < GX; gx++) groups[gx + GX * gz].far.buf = row.buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, row.buf);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
    R.curMesh = null;
  }
  function upload() {
    for (let gi = 0; gi < groups.length; gi++) {
      const gr = groups[gi];
      if (gr.near.dirty && !gr.left) fill(gr.near, CHUNKS_OF[gi]);   // all its chunks at once, or the far one meanwhile
    }
    for (let gz = 0; gz < GZ; gz++) if (rows[gz].dirty) fillRow(gz);
  }

  // Each group in view and nearer than the fog's end, near or far. Far ones
  // are drawn `Mfar` (a couple of metres down), so where one overlaps its
  // near neighbour it stays under it: no gap and no seam at the change.
  const RUN = { buf: null, first: 0, count: 0 };
  function draw(eye, fogEnd, planes, M, Mfar) {
    RUN.count = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const gr = groups[gi], d = groupDist(gi, eye);
      // Near once its chunks have been uploaded; while a dig's chunks are being
      // meshed again the old buffer stays up (drawing the far one meanwhile
      // made the ground twitch), and the new one replaces it whole.
      const near = d < LOD_AT && gr.wanted && gr.near.count > 0, part = near || !gr.far.count ? gr.near : gr.far;
      if (d > fogEnd || !part.count || !boxVisible(planes, part.lo, part.hi)) continue;
      if (part === gr.near) { R.draw(part, M); continue; }
      // Far: one draw for each run of row neighbours.
      if (RUN.count && RUN.buf === part.buf && RUN.first + RUN.count === part.first) { RUN.count += part.count; continue; }
      if (RUN.count) R.draw(RUN, Mfar);
      RUN.buf = part.buf; RUN.first = part.first; RUN.count = part.count;
    }
    if (RUN.count) R.draw(RUN, Mfar);
    // The fine patches, near ones only, a hair low: where a patch's outer ring
    // and the coarse ground's overlap, the coarse one shows (no flicker).
    for (const m of patches.values()) {
      const part = m.part;
      if (!part.count || !part.lo || !boxVisible(planes, part.lo, part.hi)) continue;
      if (Math.hypot(Math.max(part.lo[0] - eye[0], 0, eye[0] - part.hi[0]), Math.max(part.lo[2] - eye[2], 0, eye[2] - part.hi[2])) > Math.min(LOD_AT, fogEnd)) continue;
      R.draw(part, PATCH_M);
    }
  }
  const PATCH_M = Mat.T(0, -0.15, 0);

  // Resolves when everything wanted is meshed and uploaded (the perf harness and the smoke test wait on it).
  async function ready(eye = lastEye) {
    tick(eye);
    while (queue.length || inFlight) { await new Promise(r => setTimeout(r, 5)); tick(eye); }
  }
  const pending = () => queue.length + inFlight;
  return { load, tick, draw, ready, pending };
}
