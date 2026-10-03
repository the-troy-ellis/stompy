import { TAU, add, clampN, len, mul, norm, sub } from '../util/math.js';
import { feel } from './feel.js';

export function msg(G, text, col = '#7f7') {
  G.msgs.push({ text, col, t: 3.5 });
  if (G.msgs.length > 4) G.msgs.shift();
}
export function particle(G, p, v, life, size, col, kind, grav = 0) {
  if (G.parts.length > 420) G.parts.shift();
  G.parts.push({ p: [...p], v, life, max: life, size, col, kind, grav, spin: G.rng.next() * TAU });
}
// A piece of a mech (an arm, a thigh, a shin, a foot) that fell off: it
// tumbles, bounces once, and lies there for `life` seconds. Drawn from the
// mech's own part meshes by the renderer. Capped so a long fight stays cheap.
export const DEBRIS_MAX = 40, DEBRIS_LIFE = 20;
export function shedPart(G, m, part, p, v) {
  const r = G.rng;
  if (G.debris.length >= DEBRIS_MAX) G.debris.shift();
  G.debris.push({ part, partsKey: m.partsKey, scale: m.ch.scale, p: [...p], v: [...v], rot: [r.range(0, 6.28), m.yaw, r.range(0, 6.28)],
    spin: [r.range(-6, 6), r.range(-3, 3), r.range(-6, 6)], landed: false, bounced: false, t: 0, life: DEBRIS_LIFE });
}
export function stepDebris(G, dt) {
  for (const d of G.debris) {
    d.t += dt;
    if (!d.landed) {
      d.v[1] -= 18 * dt;
      d.p = add(d.p, mul(d.v, dt));
      for (let i = 0; i < 3; i++) d.rot[i] += d.spin[i] * dt;
      const g = G.ter.height(d.p[0], d.p[2]) + 0.4 * d.scale;
      if (d.p[1] <= g) {
        d.p[1] = g;
        if (!d.bounced && -d.v[1] > 3) { d.bounced = true; d.v = [d.v[0] * 0.5, -d.v[1] * 0.3, d.v[2] * 0.5]; d.spin = mul(d.spin, 0.4); }
        else { d.landed = true; d.v = [0, 0, 0]; d.spin = [0, 0, 0]; }
      }
    }
  }
  G.debris = G.debris.filter(d => d.t < d.life);
}

export function explode(G, p, big) {
  const r = G.rng, n = big ? 34 : 10, s = big ? 1.6 : 0.7;
  for (let i = 0; i < n; i++) {
    const v = mul(norm([r.range(-1, 1), r.range(-0.2, 1), r.range(-1, 1)]), r.range(3, 14) * s);
    particle(G, p, v, r.range(0.35, 0.9), r.range(0.6, 1.6) * s, [1, r.range(0.45, 0.9), 0.1], 'fire');
  }
  for (let i = 0; i < n / 2; i++) particle(G, add(p, [r.range(-2, 2), r.range(0, 2), r.range(-2, 2)]), [r.range(-1, 1), r.range(2, 5), r.range(-1, 1)], r.range(1.5, 3), r.range(1, 2.4) * s, [0.25, 0.23, 0.22], 'smoke');
  if (big) for (let i = 0; i < 12; i++) particle(G, p, [r.range(-9, 9), r.range(8, 20), r.range(-9, 9)], r.range(1.5, 2.6), r.range(0.4, 1.1), [0.2, 0.2, 0.2], 'debris', 26);
  const d = len(sub(p, G.eye));
  feel(G, 'explosion', { mech: G.player, k: (big ? 1 : 0.35) * clampN(1 - d / 220, 0, 1), at: p });
  G.fx.sfx.boom(p, big);
}
