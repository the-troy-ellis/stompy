// A damped spring for squash, wobble and sag. Critically damped by default
// (zeta = 1: settles with no overshoot); lower zeta for a wobble that rings.
// Semi-implicit Euler with substeps so a 50 ms frame stays stable.
export function makeSpring(k = 120, zeta = 1) {
  return { x: 0, v: 0, k, c: 2 * Math.sqrt(k) * zeta };
}
export function stepSpring(s, dt, target = 0) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-s.k * (s.x - target) - s.c * s.v) * h;
    s.x += s.v * h;
  }
  if (Math.abs(s.x - target) < 1e-5 && Math.abs(s.v) < 1e-5) { s.x = target; s.v = 0; }
  return s.x;
}
// An impulse: velocity, not position, so stacked hits add up and the spring carries them.
export const kickSpring = (s, v) => { s.v += v; };
