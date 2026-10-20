import { meshChunk } from '../world/mesher.js';
import { VS, Y0, PX, PY } from '../world/voxels.js';
import { HALF } from '../world/terrain.js';
import { M, chain } from '../util/math.js';

// Ground coming down (sim/dig.js G.falls): each piece meshed once from its
// own cells by the ground's mesher, then drawn dropping with a slight tumble
// (drawn only: the grid already has it where it lands).
const TUMBLE = 0.12;   // radians by the time it lands

export function createFalls(R) {
  const made = new Map();   // fall -> { buf, count }
  function meshOf(f, pal) {
    const [i0, i1, j0, j1, k0, k1] = f.box, nx = i1 - i0 + 5, ny = j1 - j0 + 5, nz = k1 - k0 + 5;
    const D = new Uint8Array(nx * ny * nz).fill(1), T = new Float32Array(nx * nz).fill(Y0 - 100);   // no roof over it
    f.cells.forEach((o, n) => {
      const i = o % PX - i0 + 2, j = ((o / PX) | 0) % PY - j0 + 2, k = ((o / (PX * PY)) | 0) - k0 + 2;
      D[i + nx * (j + ny * k)] = f.bytes[n];
    });
    const o = [-HALF + (i0 - 2) * VS, Y0 + (j0 - 2) * VS, -HALF + (k0 - 2) * VS];
    return R.upload({ d: meshChunk(D, T, [nx, ny, nz], o, VS, pal) });
  }
  function draw(G) {
    for (const [f, m] of made) if (!G.falls.includes(f)) { R.gl.deleteBuffer(m.buf); made.delete(f); }
    for (const f of G.falls) {
      if (!made.has(f)) made.set(f, meshOf(f, G.pal));
      const m = made.get(f);
      if (!m.count) continue;
      const [x, y, z] = f.at, a = TUMBLE * (f.dropM ? f.off / f.dropM : 1);
      R.draw(m, chain(M.T(x, y - f.off, z), M.RX(a), M.RZ(a * 0.6), M.T(-x, -y, -z)));
    }
  }
  return { draw };
}
