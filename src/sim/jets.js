import { JETS } from '../data/systems.js';
import { feel } from './feel.js';
import { particle, scorch } from './effects.js';

const { min, max, sin, cos } = Math;

// Blast-off jets (docs/specs/26-blast-off.md). Hold JUMP (`m.jetting`) on
// the ground with the jets ready and they charge (`m.jet.charge`, 0 to 1 in
// JETS[level].charge s): the mech crouches and the jets build. Let go and it
// blasts off, up and along the way it walks, higher the fuller the charge,
// with a thunk, a ring of dust and a shockwave where it stood, and a smoke
// streak up the climb. `m.fuel` is how ready the jets are: 0 after a blast,
// back to 1 over JETS[level].recharge s; only full can charge.

export function stepJets(G, m, dt) {
  const lvl = m.jets ?? 1, T = JETS[lvl], j = (m.jet ||= { charge: 0, blasted: false, top: 0, fly: [0, 0] });
  if (!T) { j.charge = 0; return; }
  const able = m.alive && !m.shutdown && !m.air && m.fuel >= 1;
  if (m.jetting && able) j.charge = min(1, j.charge + dt / T.charge);
  else if (j.charge > 0) {
    if (!m.jetting && able) blastOff(G, m, T);   // let go: off it goes
    j.charge = 0;   // or lost: shut down, knocked into the air, the jets spent
  }
  if (!j.charge) m.fuel = min(1, m.fuel + dt / T.recharge);
  if (m.air) j.top = max(j.top, m.y);
  else if (j.blasted && m.vy <= 0) j.blasted = false;   // down again
  if (j.blasted && m.vy > 0) streak(G, m);
}

// The blast: up by the charge, along the legs' heading by the charge and the
// throttle, and the thunk, the ring and the heat.
export function blastOff(G, m, T = JETS[m.jets ?? 1]) {
  const j = m.jet, c = max(j.charge, T.tap), k = (c - T.tap) / (1 - T.tap);
  m.vy = T.vy[0] + (T.vy[1] - T.vy[0]) * k;
  const along = T.fwd * c * (m.throttle || 0);   // backing up blasts back
  j.fly = [sin(m.yaw) * along, cos(m.yaw) * along];   // carried until it lands (sim/mech.js)
  m.y += 0.5; m.air = true;
  m.heat += T.heat[0] + (T.heat[1] - T.heat[0]) * k;
  m.fuel = 0;
  j.blasted = true; j.top = m.y;
  feel(G, 'blastoff', { mech: m, k: 0.4 + 0.6 * c, at: m === G.player ? null : [m.x, m.y, m.z] });
  blastRing(G, [m.x, m.y, m.z], c, m.ch.scale);
  G.fx.sfx.blastoff(m === G.player ? null : [m.x, m.y, m.z], c);
}

// Where a mech blasted off: the shockwave ring, a scorch, a ring of dust
// racing out along the ground and a puff of smoke, bigger with the charge.
export function blastRing(G, p, c, s = 1) {
  const r = G.rng, gy = G.ter ? G.ter.groundBelow(p[0], p[1] + 1, p[2]) : p[1];
  particle(G, [p[0], gy + 0.3, p[2]], [0, 0, 0], 0.45, (9 + 14 * c) * s, [0.95, 0.86, 0.66], 'shock', 0, 0);
  scorch(G, p[0], p[2], (1.8 + 2.4 * c) * s, gy);
  const n = Math.round(14 + 18 * c);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.1, 0.1), v = r.range(8, 16) * (0.6 + 0.6 * c);
    particle(G, [p[0] + sin(a) * 2 * s, gy + 0.6, p[2] + cos(a) * 2 * s], [sin(a) * v, r.range(0.5, 2.5), cos(a) * v], r.range(0.7, 1.3), r.range(1, 2) * s, G.pal.low, 'dust');
  }
  for (let i = 0; i < 6; i++) particle(G, [p[0] + r.range(-2, 2), gy + 1, p[2] + r.range(-2, 2)], [r.range(-1, 1), r.range(1, 3), r.range(-1, 1)], r.range(1.2, 2), r.range(1.5, 2.5) * s, [0.3, 0.28, 0.26], 'smoke');
}

// The climb's streak: flame at the nozzles and smoke left hanging behind, as
// a missile's trail.
function streak(G, m) {
  const r = G.rng, s = m.ch.scale, at = [m.x + r.range(-0.6, 0.6) * s, m.y + 0.8 * s, m.z + r.range(-0.6, 0.6) * s];
  particle(G, at, [r.range(-1, 1), -10 - m.vy * 0.3, r.range(-1, 1)], 0.3, 0.9 * s, [1, 0.6, 0.2], 'fire');
  particle(G, at, [r.range(-0.6, 0.6), r.range(-1, 0.5), r.range(-0.6, 0.6)], r.range(1.4, 2.2), r.range(0.9, 1.5) * s, [0.62, 0.6, 0.58], 'smoke');
}
