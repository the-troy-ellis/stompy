import { clampN } from '../util/math.js';
import { FEEL } from '../data/feel.js';

// Knockback (docs/specs/12-melee.md): a horizontal impulse on a mech, scaled
// by the masses involved, so a shove sends a light mech skidding and a heavy
// one barely notices. mass = scale^3. The attacker takes a little recoil the
// other way, and the blow jolts the target's aim without taking control.
export const massOf = m => m.ch.scale ** 3;
export const KNOCK_MIN = 0.3, KNOCK_MAX = 2.5, RECOIL = 0.2;

// `base` is the impulse in m/s before mass scaling; `dir` the unit [x, z] the
// target is pushed along. Returns the impulse actually applied.
export function knock(G, { target, attacker = null, base, dir, recoil = true }) {
  if (!target || !(base > 0) || !dir) return 0;
  const ratio = attacker ? clampN(massOf(attacker) / massOf(target), KNOCK_MIN, KNOCK_MAX) : 1;
  const v = base * ratio;
  if (!target.push) target.push = [0, 0];
  target.push[0] += dir[0] * v; target.push[1] += dir[1] * v;
  if (recoil && attacker && attacker.push) { attacker.push[0] -= dir[0] * v * RECOIL; attacker.push[1] -= dir[1] * v * RECOIL; }
  // The aim jolts toward the blow and up, and the wobble springs carry it back.
  const side = Math.sign(dir[0] * Math.cos(target.yaw + target.twist) - dir[1] * Math.sin(target.yaw + target.twist)) || 1;
  const j = clampN(v / 10, 0, 1);
  target.twist = clampN(target.twist + side * FEEL.knock.twist * j, -1.9, 1.9);
  target.pitch = clampN(target.pitch + FEEL.knock.pitch * j, -0.4, 0.45);
  return v;
}
