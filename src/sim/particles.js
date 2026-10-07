import { TAU } from '../util/math.js';

// The particle pool (docs/specs/14-look-and-performance.md § The plan, P2):
// every particle lives in preallocated typed arrays, so spawning, stepping and
// expiring allocate nothing, and the renderer copies straight out of them into
// its instance buffers. Live particles are packed in [0, n); one that expires
// is swapped with the last. A full pool overwrites slots round-robin, which
// approximates replacing the oldest. `length` is `n`, so code that only
// counted particles still works.
export const PARTICLE_CAP = 4000;   // room for weather (spec 07: up to 2,500 at once) on top of a fight
export const KINDS = ['smoke', 'fire', 'flame', 'debris', 'spark', 'dust', 'rain', 'snow'];
const KIND_ID = Object.fromEntries(KINDS.map((k, i) => [k, i]));

export class Particles {
  constructor(cap = PARTICLE_CAP) {
    this.cap = cap; this.n = 0; this.next = 0;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.size = new Float32Array(cap);
    this.grav = new Float32Array(cap); this.spin = new Float32Array(cap); this.kind = new Uint8Array(cap);
  }
  get length() { return this.n; }
  clear() { this.n = 0; this.next = 0; }
  // The index to write a new particle into.
  slot() {
    if (this.n < this.cap) return this.n++;
    const i = this.next; this.next = (this.next + 1) % this.cap;
    return i;
  }
  remove(i) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3, { pos, vel, col } = this;
    pos[i3] = pos[j3]; pos[i3 + 1] = pos[j3 + 1]; pos[i3 + 2] = pos[j3 + 2];
    vel[i3] = vel[j3]; vel[i3 + 1] = vel[j3 + 1]; vel[i3 + 2] = vel[j3 + 2];
    col[i3] = col[j3]; col[i3 + 1] = col[j3 + 1]; col[i3 + 2] = col[j3 + 2];
    this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j];
    this.grav[i] = this.grav[j]; this.spin[i] = this.spin[j]; this.kind[i] = this.kind[j];
  }
}

// Spawn one: position p, velocity v and colour col are copied (the caller's
// arrays are not kept). The spin takes one roll of the seeded RNG, as before.
export function spawn(G, p, v, life, size, col, kind, grav = 0) {
  const P = G.parts, i = P.slot(), i3 = i * 3;
  P.pos[i3] = p[0]; P.pos[i3 + 1] = p[1]; P.pos[i3 + 2] = p[2];
  P.vel[i3] = v[0]; P.vel[i3 + 1] = v[1]; P.vel[i3 + 2] = v[2];
  P.col[i3] = col[0]; P.col[i3 + 1] = col[1]; P.col[i3 + 2] = col[2];
  P.life[i] = life; P.max[i] = life; P.size[i] = size; P.grav[i] = grav;
  P.kind[i] = KIND_ID[kind] ?? 0;
  P.spin[i] = G.rng.next() * TAU;
}

// One frame: age, fall, drag (smoke slows and drifts with the wind), move,
// bounce (debris on the ground), spin; then drop the expired ones.
const SMOKE = KIND_ID.smoke, DEBRIS = KIND_ID.debris;
export function stepParticles(G, dt) {
  const P = G.parts, wind = G.weather?.wind, wx = wind ? wind[0] : 0, wz = wind ? wind[1] : 0, windy = wx !== 0 || wz !== 0;
  for (let i = 0; i < P.n; i++) {
    const i3 = i * 3, k = P.kind[i];
    P.life[i] -= dt;
    P.vel[i3 + 1] -= P.grav[i] * dt;
    if (k === SMOKE) {
      const d = 1 - dt * 0.6; P.vel[i3] *= d; P.vel[i3 + 1] *= d; P.vel[i3 + 2] *= d;
      if (windy) { P.vel[i3] += (wx - P.vel[i3]) * dt * 0.8; P.vel[i3 + 2] += (wz - P.vel[i3 + 2]) * dt * 0.8; }   // and drifts with the wind
    }
    P.pos[i3] += P.vel[i3] * dt; P.pos[i3 + 1] += P.vel[i3 + 1] * dt; P.pos[i3 + 2] += P.vel[i3 + 2] * dt;
    if (k === DEBRIS) {
      const g = G.ter.height(P.pos[i3], P.pos[i3 + 2]);
      if (P.pos[i3 + 1] < g) { P.pos[i3 + 1] = g; P.vel[i3] *= 0.5; P.vel[i3 + 1] *= -0.35; P.vel[i3 + 2] *= 0.5; }
    }
    P.spin[i] += dt * 3;
  }
  for (let i = P.n - 1; i >= 0; i--) if (P.life[i] <= 0) P.remove(i);
}

// For tests and debugging: the live particles as plain objects.
export function listParticles(G) {
  const P = G.parts, out = [];
  for (let i = 0; i < P.n; i++) {
    const i3 = i * 3;
    out.push({ kind: KINDS[P.kind[i]], p: [P.pos[i3], P.pos[i3 + 1], P.pos[i3 + 2]], v: [P.vel[i3], P.vel[i3 + 1], P.vel[i3 + 2]],
      col: [P.col[i3], P.col[i3 + 1], P.col[i3 + 2]], life: P.life[i], max: P.max[i], size: P.size[i], grav: P.grav[i], spin: P.spin[i] });
  }
  return out;
}
