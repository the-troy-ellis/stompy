import { add, clampN } from '../util/math.js';
import { BOUND } from '../world/terrain.js';
import { particle } from './effects.js';
import { gait } from './gait.js';

const { sin, cos, min, max } = Math;

// One mech, one frame: speed, jets, gravity, heat, shutdown, cooldowns, legs.
export function stepMech(G, m, dt) {
  const r = G.rng, legs = (m.hp.LL > 0 ? 0.5 : 0) + (m.hp.RL > 0 ? 0.5 : 0);
  let maxS = m.ch.speed * (legs >= 1 ? 1 : legs > 0 ? 0.45 : 0.04);
  if (m.heat > 85) maxS *= 0.65;
  const target = !m.alive || m.shutdown ? 0 : m.throttle * maxS;
  m.speed += clampN(target - m.speed, -11 * dt, 7 * dt);
  m.x = clampN(m.x + sin(m.yaw) * m.speed * dt, -BOUND, BOUND);
  m.z = clampN(m.z + cos(m.yaw) * m.speed * dt, -BOUND, BOUND);

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
      if (m === G.player) { G.shake = min(1.2, G.shake + 0.6 * force); G.kick = 1; G.fx.sfx.land(force); }
      else G.fx.sfx.step(m, force * 0.8);
    }
    m.y = ground; m.vy = 0; m.air = false;
  } else if (m.y > ground + 1.2) m.air = true;
  if (m.y < ground) { m.y = ground; m.vy = max(0, m.vy); }

  m.heat = max(0, m.heat - (m.shutdown ? 20 : m.ch.sink) * dt);
  if (!m.shutdown && m.heat >= 100) {
    m.shutdown = true;
    if (m === G.player) { G.fx.sfx.powerdown(); G.fx.say('Reactor shutdown.', true); }
  } else if (m.shutdown && m.heat < 45) {
    m.shutdown = false;
    if (m === G.player) { G.fx.sfx.powerup(); G.fx.say('Reactor online.', true); }
  }
  if (m === G.player && m.heat > 80 && !m.shutdown) G.fx.say('Warning. Heat critical.');
  for (const w of m.weapons) w.cd = max(0, w.cd - dt);

  gait(G, m, dt);
}
