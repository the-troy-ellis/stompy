import { add, clampN, wrapA } from '../util/math.js';
import { BOUND } from '../world/terrain.js';
import { center, viewYaw } from './geom.js';
import { fire } from './combat.js';

const { sin, cos, atan2, abs, hypot, max, PI } = Math;

// One enemy, one frame. State lives in e.ai.
export function think(G, e, dt) {
  const P = G.player, r = G.rng, dx = P.x - e.x, dz = P.z - e.z, dist = hypot(dx, dz);
  const toYaw = atan2(dx, dz);
  if (!e.ai.aware && (dist < 600 || G.time > 25)) e.ai.aware = true;
  let moveYaw, thr = 1;
  if (!e.ai.aware) {
    if (!e.ai.wp || hypot(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z) < 30) e.ai.wp = [clampN(e.x + r.range(-250, 250), -BOUND, BOUND), clampN(e.z + r.range(-250, 250), -BOUND, BOUND)];
    moveYaw = atan2(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z); thr = 0.5;
  } else {
    e.ai.strafeT -= dt;
    if (e.ai.strafeT <= 0) { e.ai.strafe *= -1; e.ai.strafeT = r.range(3, 7); }
    const pref = e.ch.pref;
    if (dist > pref * 1.35) moveYaw = toYaw + e.ai.strafe * 0.35;
    else if (dist < pref * 0.6) moveYaw = toYaw + PI - e.ai.strafe * 0.6;
    else { moveYaw = toYaw + e.ai.strafe * PI / 2; thr = 0.75; }
    // Steer away from the map edge.
    if (abs(e.x) > BOUND - 60 || abs(e.z) > BOUND - 60) moveYaw = atan2(-e.x, -e.z);
  }
  e.yaw += clampN(wrapA(moveYaw - e.yaw), -e.ch.turn * dt, e.ch.turn * dt);
  e.throttle = thr;
  if (!e.ai.aware) { e.twist *= 1 - dt; return; }
  const wantTwist = clampN(wrapA(toYaw - e.yaw), -1.9, 1.9);
  e.twist += clampN(wrapA(wantTwist - e.twist), -2 * dt, 2 * dt);
  const pc = center(P);
  e.pitch = atan2(pc[1] - (e.y + 6 * e.ch.scale), dist);
  // Fire when the torso is on target, the weapon is in range, and heat allows.
  const off = abs(wrapA(toYaw - viewYaw(e)));
  e.ai.jitter -= dt;
  // Lasers: hold the beam on in bursts while on target and cool enough,
  // with an aim error that drifts, so the beam wanders on and off you.
  const beam = e.weapons.find(w => w.def.kind === 'beam' && !w.dead);
  if (beam && off < 0.3 && dist < beam.def.range * 0.95 && !e.shutdown && P.alive) {
    if (e.heat > 70) e.ai.coolT = r.range(1.5, 3);
    if ((e.ai.coolT = max(0, (e.ai.coolT || 0) - dt)) === 0) {
      const err = dist * e.ch.acc0 * (1 + abs(P.speed) / 14) * (P.air ? 1.6 : 1), k = G.time * 0.9 + e.ai.strafeT;
      e.ai.beamAim = add(pc, [sin(k * 1.3) * err, sin(k * 1.7) * err * 0.5, cos(k * 1.1) * err]);
      e.beamOn = true;
    }
  }
  if (off > 0.25 || e.heat > 72 || e.shutdown || e.ai.jitter > 0 || !P.alive) return;
  for (const w of e.weapons) {
    if (w.def.kind === 'beam' || w.def.kind === 'fusion' || w.dead || w.cd > 0 || dist > w.def.range * 0.95) continue;
    let aim = pc;
    if (w.def.kind === 'shell') { const t = dist / w.def.speed; aim = add(pc, [sin(P.yaw) * P.speed * t, 0, cos(P.yaw) * P.speed * t]); }
    const err = dist * e.ch.acc0 * (1 + abs(P.speed) / 14) * (P.air ? 1.6 : 1);
    aim = add(aim, [r.range(-err, err), r.range(-err, err) * 0.6, r.range(-err, err)]);
    if (fire(G, e, w, aim, P)) { e.ai.jitter = r.range(0.15, 0.6); break; }
  }
}
