import { add, clampN, mul } from '../util/math.js';
import { BOUND } from '../world/terrain.js';
import { particle } from './effects.js';
import { gait } from './gait.js';
import { feel, stepFeel } from './feel.js';
import { FEEL } from '../data/feel.js';

const { sin, cos, min, max } = Math;

// Touchdown dust: a puff under the feet, and for a hard landing (force over
// 0.7) a ring that races outward along the ground. (The shockwave mesh is M4.)
function landingDust(G, m, ground, force) {
  const r = G.rng, s = m.ch.scale, col = mul(G.pal.low, 0.85), n = Math.round(4 * FEEL.land.dust * force * s);
  for (let i = 0; i < n; i++) particle(G, [m.x + r.range(-1.5, 1.5) * s, ground + 0.3, m.z + r.range(-1.5, 1.5) * s], [r.range(-3, 3), r.range(1, 3), r.range(-3, 3)], r.range(0.7, 1.2), r.range(0.6, 1.1) * s, col, 'smoke');
  if (force > 0.7) {
    const ring = Math.round(6 * FEEL.land.dust * s);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + r.range(-0.1, 0.1), v = r.range(9, 14) * force;
      particle(G, [m.x + sin(a) * 1.2 * s, ground + 0.2, m.z + cos(a) * 1.2 * s], [sin(a) * v, r.range(0.5, 1.5), cos(a) * v], r.range(0.5, 0.9), r.range(0.8, 1.4) * s, col, 'smoke');
    }
  }
}

// One mech, one frame: speed, jets, gravity, heat, shutdown, cooldowns, legs.
export function stepMech(G, m, dt) {
  const r = G.rng, legs = (m.hp.LL > 0 ? 0.5 : 0) + (m.hp.RL > 0 ? 0.5 : 0);
  let maxS = m.ch.speed * (legs >= 1 ? 1 : legs > 0 ? 0.45 : 0);   // no legs: sat down, a turret
  if (m.heat > 85) maxS *= 0.65;
  const target = !m.alive || m.shutdown ? 0 : m.throttle * maxS;
  m.speed += clampN(target - m.speed, -11 * dt, 7 * dt);
  const push = m.push || (m.push = [0, 0]);
  m.x = clampN(m.x + (sin(m.yaw) * m.speed + push[0]) * dt, -BOUND, BOUND);
  m.z = clampN(m.z + (cos(m.yaw) * m.speed + push[1]) * dt, -BOUND, BOUND);
  const keep = max(0, 1 - 4 * dt);
  push[0] *= keep; push[1] *= keep;
  // Skidding: dust streaks behind the feet while the push is strong.
  const skid = Math.hypot(push[0], push[1]);
  if (skid > 2 && m.alive && !m.air && r.chance(dt * FEEL.knock.skidDust * min(1, skid / 10))) {
    particle(G, [m.x - push[0] / skid * 1.5 * m.ch.scale + r.range(-1, 1), m.y + 0.3, m.z - push[1] / skid * 1.5 * m.ch.scale + r.range(-1, 1)],
      [-push[0] * 0.3 + r.range(-1, 1), r.range(1, 2.5), -push[1] * 0.3 + r.range(-1, 1)], r.range(0.5, 0.9), r.range(0.6, 1.1) * m.ch.scale, mul(G.pal.low, 0.8), 'smoke');
  }

  const ground = G.ter.height(m.x, m.z);
  const jets = m.jetting && m.fuel > 0 && !m.shutdown && m.alive;
  if (jets) {
    m.vy = min(m.vy + 30 * dt, 12);
    m.fuel = max(0, m.fuel - dt * 0.32);
    m.heat += 10 * dt;
    if (r.chance(0.6)) particle(G, add([m.x, m.y + 1.5, m.z], [r.range(-1, 1), 0, r.range(-1, 1)]), [r.range(-1, 1), -8, r.range(-1, 1)], 0.35, 0.7, [1, 0.6, 0.2], 'fire');
  } else m.fuel = min(1, m.fuel + dt * 0.12);
  m.vy -= 18 * dt;
  m.y += m.vy * dt;
  if (!jets && m.vy <= 0 && m.y - ground < 1.2) {
    if (m.air) {
      const force = clampN(-m.vy / 20, 0.25, 1);
      feel(G, 'land', { mech: m, k: force, at: m === G.player ? null : [m.x, m.y, m.z] });
      if (m === G.player) G.fx.sfx.land(force);
      else G.fx.sfx.step(m, force * 0.8);
      landingDust(G, m, ground, force);
    }
    m.y = ground; m.vy = 0; m.air = false;
  } else if (m.y > ground + 1.2) m.air = true;
  if (m.y < ground) { m.y = ground; m.vy = max(0, m.vy); }

  m.heat = max(0, m.heat - (m.shutdown ? 20 : m.ch.sink) * dt);
  if (!m.shutdown && m.heat >= 100) {
    m.shutdown = true;
    feel(G, 'shutdown', { mech: m, at: m === G.player ? null : [m.x, m.y, m.z] });
    if (m === G.player) { G.fx.sfx.powerdown(); G.fx.say('Reactor shutdown.', true); }
  } else if (m.shutdown && m.heat < 45) {
    m.shutdown = false;
    feel(G, 'restart', { mech: m, at: m === G.player ? null : [m.x, m.y, m.z] });
    if (m === G.player) { G.fx.sfx.powerup(); G.fx.say('Reactor online.', true); }
  }
  if (m === G.player && m.heat > 80 && !m.shutdown) G.fx.say('Warning. Heat critical.');
  for (const w of m.weapons) w.cd = max(0, w.cd - dt);

  stepFeel(m, dt);
  gait(G, m, dt);
}
