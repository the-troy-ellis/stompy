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

// Section-specific hit effects (roadmap M1: hit feedback). Sparks fan off
// the armour away from the blow; a leg hit kicks dust up at the feet; a
// torso hit leaves a little smoke; and a blow of PLATE_DMG or more knocks an
// armour plate loose that tumbles, bounces once and lies there with the
// rest of the debris. Beams have their own sparks (beams.js).
export const PLATE_DMG = 6;
export function hitSparks(G, m, p, sec, amt) {
  const r = G.rng, k = clampN(amt / 10, 0.3, 2), s = m.ch.scale;
  let n = norm(sub(p, [m.x, p[1], m.z]));
  if (!(len(n) > 0.5)) n = [0, 0, 1];
  const leg = sec === 'LL' || sec === 'RL', torso = sec === 'T';
  const sparks = Math.round((leg ? 4 : torso ? 6 : 8) * k);
  for (let i = 0; i < sparks; i++) {
    particle(G, p, add(mul(n, r.range(4, 12)), [r.range(-3, 3), r.range(1, 6), r.range(-3, 3)]), r.range(0.15, 0.4), r.range(0.2, 0.45), [1, r.range(0.7, 0.95), 0.3], 'fire', 20);
  }
  if (leg) for (let i = 0; i < Math.round(4 * k); i++) {
    particle(G, [m.x + r.range(-1.5, 1.5) * s, m.y + 0.3, m.z + r.range(-1.5, 1.5) * s], [r.range(-2, 2), r.range(1, 3), r.range(-2, 2)], r.range(0.5, 0.9), r.range(0.6, 1.2) * s, mul(G.pal.low, 0.8), 'smoke');
  }
  if (torso) for (let i = 0; i < Math.round(2 * k); i++) {
    particle(G, add(p, mul(n, 0.5)), add(mul(n, 1.5), [r.range(-0.5, 0.5), r.range(1.5, 3), r.range(-0.5, 0.5)]), r.range(1, 1.8), r.range(0.8, 1.4), [0.25, 0.23, 0.22], 'smoke');
  }
  if (amt >= PLATE_DMG) {
    for (let i = 0, nP = amt >= PLATE_DMG * 2 ? 2 : 1; i < nP; i++) {
      shedPart(G, m, 'plate', add(p, mul(n, 0.3)), add(mul(n, r.range(3, 7)), [r.range(-2, 2), r.range(3, 7), r.range(-2, 2)]));
    }
  }
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
