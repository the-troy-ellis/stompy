// The ground's corners in chunks (docs/specs/35-bigger-maps.md part 3): the
// same bytes as one array of px × py × pz, but held 16 × 8 × 16 corners at a
// time. A chunk that is all rock or all air is one shared array, so it costs
// nothing; it is copied the first time anything writes a different byte to it
// (a landmark, a dig, a fall). On today's map that's about 5 MB of chunks with
// bytes of their own, against 25.6 MB for the whole box.
//
// Corners are named two ways, as before: (i, j, k), or the corner index
// o = i + px × (j + py × k) (voxels.js cornerIndex). `at`/`put` take the first,
// and are what the hot paths use; `get`/`set` take the second.
const SX = 16, SY = 8, SZ = 16, SIZE = SX * SY * SZ;
export const ROCK = new Uint8Array(SIZE).fill(255), AIR = new Uint8Array(SIZE).fill(1);
const shared = c => c === ROCK || c === AIR;
const local = (i, j, k) => (i & 15) | ((j & 7) << 4) | ((k & 15) << 7);

export class Grid {
  // `fill(chunk, i0, j0, k0)` writes a chunk's bytes from its first corner
  // (corners past the box: air), or returns 255 or 1 when it knows the chunk
  // is all rock or all air; a chunk that turns out uniform is shared too.
  constructor(px, py, pz, fill = null) {
    this.px = px; this.py = py; this.pz = pz;
    this.cx = Math.ceil(px / SX); this.cy = Math.ceil(py / SY); this.cz = Math.ceil(pz / SZ);
    this.length = px * py * pz;
    const C = this.C = new Array(this.cx * this.cy * this.cz).fill(AIR);
    if (!fill) return;
    const s = new Uint8Array(SIZE);
    for (let ck = 0; ck < this.cz; ck++) for (let cj = 0; cj < this.cy; cj++) for (let ci = 0; ci < this.cx; ci++) {
      const quick = fill(s, ci * SX, cj * SY, ck * SZ);   // 255 or 1: the chunk is all that, nothing written
      if (quick === 255 || quick === 1) { C[ci + this.cx * (cj + this.cy * ck)] = quick === 255 ? ROCK : AIR; continue; }
      const v = s[0];
      let uni = v === 255 || v === 1;
      for (let n = 1; uni && n < SIZE; n++) if (s[n] !== v) uni = false;
      C[ci + this.cx * (cj + this.cy * ck)] = uni ? (v === 255 ? ROCK : AIR) : s.slice();
    }
  }
  // Where (i, j, k) lives in a chunk: the byte offset (for fill's scratch).
  static local(i, j, k) { return local(i, j, k); }
  at(i, j, k) { return this.C[(i >> 4) + this.cx * ((j >> 3) + this.cy * (k >> 4))][local(i, j, k)]; }
  put(i, j, k, v) {
    const n = (i >> 4) + this.cx * ((j >> 3) + this.cy * (k >> 4)), l = local(i, j, k);
    let c = this.C[n];
    if (c[l] === v) return;
    if (shared(c)) c = this.C[n] = c.slice();   // copy on first write
    c[l] = v;
  }
  get(o) { const i = o % this.px, r = (o - i) / this.px, j = r % this.py; return this.at(i, j, (r - j) / this.py); }
  set(o, v) { const i = o % this.px, r = (o - i) / this.px, j = r % this.py; this.put(i, j, (r - j) / this.py, v); }
  // A copy that shares nothing it could write to (the net's confirmed ground).
  clone() {
    const g = Object.create(Grid.prototype);
    Object.assign(g, this);
    g.C = this.C.map(c => (shared(c) ? c : c.slice()));
    return g;
  }
  // Bytes held in chunks of their own (tests, the perf scenes).
  get bytes() { let n = 0; for (const c of this.C) if (!shared(c)) n += SIZE; return n; }
}
