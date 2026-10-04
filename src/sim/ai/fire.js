import { add, wrapA } from '../../util/math.js';
import { center, viewYaw } from '../geom.js';
import { fire } from '../combat.js';
import { planFor } from './profiles.js';
import { diffOf, FIRE as F } from '../../data/ai.js';

const { sin, cos, abs, max } = Math;

// Fire discipline (docs/specs/05-ai.md § Fire discipline). The laser
// burst-and-wander rule from before, plus: a heat cap by difficulty with a
// cool-down before opening up again, an alpha when the target's torso is
// nearly gone, section targeting on HARD, missiles only with a held lock and
// never close in. The autocannon leads on the target's real velocity.

// Where to aim on the target: HARD picks the more damaged arm's side; the
// others aim at the centre. In the target's torso frame, +x is its left.
export function aimPoint(G, e, P) {
  const c = center(P);
  if (!diffOf(G).sections) return c;
  const la = P.hp.LA / P.max.LA, ra = P.hp.RA / P.max.RA;
  if (P.hp.LA <= 0 && P.hp.RA <= 0) return c;
  let side = 0;
  if (P.hp.LA > 0 && (P.hp.RA <= 0 || la <= ra)) side = 1;
  else if (P.hp.RA > 0) side = -1;
  if (side && Math.min(la, ra) >= 1) return c;   // nothing damaged yet: the centre is the bigger target
  const a = viewYaw(P), o = F.armOffset * P.ch.scale;
  return add(c, [side * o * cos(a), 0, -side * o * sin(a)]);
}

// The aim error in metres at this range, by chassis, difficulty and the target's motion.
export const aimError = (G, e, P, dist) => dist * e.ch.acc0 * diffOf(G).aimErr * (1 + abs(P.speed) / 14) * (P.air ? 1.6 : 1);

// Once a frame for an aware, seeing enemy. `off` is how far the torso is off the bearing.
export function decideFire(G, e, P, { dist, toYaw }, dt) {
  const a = e.ai, r = G.rng, cap = diffOf(G).heatCap;
  const off = abs(wrapA(toYaw - viewYaw(e)));
  // Lock: facing well for a second. Lost the moment the torso wanders.
  a.lockT = off < F.lockFace ? (a.lockT || 0) + dt : 0;
  a.jitter -= dt;
  // Overheated: nothing until it is well under the cap again.
  if (e.heat > cap) a.hot = true;
  else if (a.hot && e.heat < cap - F.coolBelow) a.hot = false;
  const may = !a.hot && !e.shutdown && P.alive;
  const pc = aimPoint(G, e, P);
  // Lasers: in bursts while on target and cool enough, with an aim error
  // that drifts, so the beam wanders on and off you.
  const beam = e.weapons.find(w => w.def.kind === 'beam' && !w.dead);
  if (beam && may && off < 0.3 && dist < beam.def.range * 0.95) {
    if (e.heat > cap - 2) a.coolT = r.range(1.5, 3);
    if ((a.coolT = max(0, (a.coolT || 0) - dt)) === 0) {
      const err = aimError(G, e, P, dist), k = G.time * 0.9 + a.strafeT;
      a.beamAim = add(pc, [sin(k * 1.3) * err, sin(k * 1.7) * err * 0.5, cos(k * 1.1) * err]);
      e.beamOn = true;
    }
  }
  if (!may || off > 0.25 || a.jitter > 0) return;
  // Alpha: the target's torso is nearly gone, so everything that is ready goes now.
  const plan = e.ai.plan || (e.ai.plan = planFor(e));   // think() normally builds it first
  const alpha = P.hp.T < P.max.T * (plan.alphaTorso ?? F.alphaTorso);
  for (const w of e.weapons) {
    if (w.def.kind === 'beam' || w.def.kind === 'fusion' || w.dead || w.cd > 0 || dist > w.def.range * 0.95) continue;
    // Homing missiles want a lock and some room; dumb-fire ones just need facing.
    if (w.def.kind === 'missile' && w.def.homing !== false && (dist < F.lrmMin || a.lockT < F.lockFor)) continue;
    let aim = pc;
    if (w.def.kind === 'shell') { const t = dist / w.def.speed; aim = add(pc, [sin(P.yaw) * P.speed * t, 0, cos(P.yaw) * P.speed * t]); }
    const err = aimError(G, e, P, dist);
    aim = add(aim, [r.range(-err, err), r.range(-err, err) * 0.6, r.range(-err, err)]);
    if (!fire(G, e, w, aim, P)) continue;
    a.shots = (a.shots || 0) + 1;   // the sniper counts them to know when to move
    if (!alpha) { a.jitter = r.range(0.15, 0.6); break; }
  }
}
