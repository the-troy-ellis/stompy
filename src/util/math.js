// Scalars, 3-vectors as plain arrays, and 4x4 column-major matrices.
const { sin, cos, hypot, random } = Math;

export const TAU = Math.PI * 2;
export const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapA = a => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
// Cosmetic randomness (render, audio). The simulation uses game.rng instead.
export const rnd = (a, b) => a + random() * (b - a);

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// Unit vector for a yaw (about +y, growing to the left) and a pitch.
export const dirOf = (yaw, pitch) => [sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)];

export const M = {
  id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  T(x, y, z) { const m = M.id(); m[12] = x; m[13] = y; m[14] = z; return m; },
  S(x, y = x, z = x) { const m = M.id(); m[0] = x; m[5] = y; m[10] = z; return m; },
  RY(a) { const c = cos(a), s = sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  RX(a) { const c = cos(a), s = sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  RZ(a) { const c = cos(a), s = sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  persp(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
  },
  lookAt(eye, at, up = [0, 1, 0]) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  apply(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  },
};
export const chain = (...ms) => ms.reduce((a, b) => M.mul(a, b));

// A per-frame matrix arena for the renderer (docs/specs/14-look-and-performance.md
// P3): the same id, T, S, RX, RY, RZ, mul and chain as M, but every result is a
// reused Float32Array from a fixed pool instead of a new one. Call reset() at
// the start of each frame; a matrix from the arena is only good until then, so
// nothing that outlives a frame (the sim, saved state) may keep one.
export function makeMatrixArena(size = 8192) {
  const pool = Array.from({ length: size }, () => new Float32Array(16));
  let i = 0, warned = false;
  const take = () => {
    if (i === size) { i = 0; if (!warned) { warned = true; console.warn('matrix arena wrapped within a frame'); } }
    return pool[i++];
  };
  const ident = m => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  const A = {
    reset() { i = 0; },
    get used() { return i; },
    id: () => ident(take()),
    T(x, y, z) { const m = ident(take()); m[12] = x; m[13] = y; m[14] = z; return m; },
    S(x, y = x, z = x) { const m = ident(take()); m[0] = x; m[5] = y; m[10] = z; return m; },
    RY(a) { const c = cos(a), s = sin(a), m = ident(take()); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    RX(a) { const c = cos(a), s = sin(a), m = ident(take()); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    RZ(a) { const c = cos(a), s = sin(a), m = ident(take()); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    mul(a, b) {
      const o = take();
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    // Fixed parameters, not ...rest or `arguments`, so a call allocates nothing (up to ten matrices).
    chain(a, b, c, d, e, f, g, h, i2, j) {
      let r = a;
      if (b) r = A.mul(r, b); if (c) r = A.mul(r, c); if (d) r = A.mul(r, d); if (e) r = A.mul(r, e);
      if (f) r = A.mul(r, f); if (g) r = A.mul(r, g); if (h) r = A.mul(r, h); if (i2) r = A.mul(r, i2); if (j) r = A.mul(r, j);
      return r;
    },
  };
  return A;
}

// Frustum culling (spec 14 P6): the six planes of a view-projection matrix
// (column-major, as M builds them), written into `out` (Float32Array(24): a,
// b, c, d per plane, normals pointing in and normalised), and whether a
// sphere touches the inside of all six.
export function frustumPlanes(VP, out = new Float32Array(24)) {
  for (let p = 0; p < 6; p++) {
    const row = p >> 1, sign = p & 1 ? -1 : 1, o = p * 4;
    let a = VP[3] + sign * VP[row], b = VP[7] + sign * VP[4 + row], c = VP[11] + sign * VP[8 + row], d = VP[15] + sign * VP[12 + row];
    const l = Math.hypot(a, b, c) || 1;
    out[o] = a / l; out[o + 1] = b / l; out[o + 2] = c / l; out[o + 3] = d / l;
  }
  return out;
}
export function sphereVisible(planes, x, y, z, r) {
  for (let o = 0; o < 24; o += 4) if (planes[o] * x + planes[o + 1] * y + planes[o + 2] * z + planes[o + 3] < -r) return false;
  return true;
}
