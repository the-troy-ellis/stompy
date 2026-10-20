import { chunkCorners, farCorners, CX, CY, CZ, CS, VS } from '../world/voxels.js';
import { HALF } from '../world/terrain.js';
import { meshChunk, boundsOf } from '../world/mesher.js';
import { boxVisible } from '../util/math.js';

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
const plain = p => ({ low: p.low, mid: p.mid, high: p.high, rock: p.rock });
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
  const corners = id => {
    if (id >= FAR) { const g = id - FAR; return farCorners(ground, (g % GX) * G2, ((g / GX) | 0) * G2, G2); }
    return chunkCorners(ground, id % CX, ((id / CX) | 0) % CY, (id / (CX * CY)) | 0);
  };
  function took(id, v, f, box) {
    if (v !== ver[id]) return;   // edited again since: a newer one is on its way
    if (waiting[id]) { waiting[id] = 0; if (id < FAR) groups[chunkGroup(id)].left--; }
    mesh[id] = box ? { f, lo: box[0], hi: box[1] } : null;
    const gr = groups[jobGroup(id)];
    (id >= FAR ? gr.far : gr.near).dirty = true;
  }
  function meshHere(id) {
    const c = corners(id), f = meshChunk(c.D, c.T, c.dims, c.o, c.s, pal);
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
    ground = g; pal = plain(p); world++; inFlight = 0;
    mesh.fill(null); ver.fill(0); waiting.fill(0); queue = [];
    for (const gr of groups) { gr.wanted = false; gr.left = 0; gr.near.dirty = gr.far.dirty = true; }
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
  function tick(eye) {
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
          worker.postMessage({ id, ver: ver[id], world, D: c.D, T: c.T, dims: c.dims, o: c.o, s: c.s }, [c.D.buffer, c.T.buffer]);
          inFlight++;
        }
      } else {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < BUDGET_MS) meshHere(queue.shift());
      }
    }
    upload();
  }
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
  function upload() {
    for (let gi = 0; gi < groups.length; gi++) {
      const gr = groups[gi];
      if (gr.near.dirty && !gr.left) fill(gr.near, CHUNKS_OF[gi]);   // all its chunks at once, or the far one meanwhile
      if (gr.far.dirty) fill(gr.far, [FAR + gi]);
    }
  }

  // Each group in view and nearer than the fog's end, near or far. Far ones
  // are drawn `Mfar` (a couple of metres down), so where one overlaps its
  // near neighbour it stays under it: no gap and no seam at the change.
  function draw(eye, fogEnd, planes, M, Mfar) {
    for (let gi = 0; gi < groups.length; gi++) {
      const gr = groups[gi], d = groupDist(gi, eye);
      if (d > fogEnd) continue;
      const near = d < LOD_AT && gr.wanted && !gr.left && !gr.near.dirty, part = near || !gr.far.count ? gr.near : gr.far;
      if (!part.count || !boxVisible(planes, part.lo, part.hi)) continue;
      R.draw(part, part === gr.near ? M : Mfar);
    }
  }

  // Resolves when everything wanted is meshed and uploaded (the perf harness and the smoke test wait on it).
  async function ready(eye = lastEye) {
    tick(eye);
    while (queue.length || inFlight) { await new Promise(r => setTimeout(r, 5)); tick(eye); }
  }
  const pending = () => queue.length + inFlight;
  return { load, tick, draw, ready, pending };
}
