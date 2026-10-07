import { WEAPONS } from '../data/weapons.js';
import { DIFF, TURRET } from '../data/ai.js';
import { center, rayTerrain } from './geom.js';
import { volley } from './combat.js';
import { particle } from './effects.js';
import { norm, sub, wrapA, clampN } from '../util/math.js';

const { hypot, atan2, min } = Math;

// Turrets (docs/specs/04-campaign.md § Code touchpoints): mission 9's
// launchers. A structure of kind 'turret' that turns its head toward the
// player while it can see them within range, and fires a volley of its
// weapon (LRM) through the normal missile path on a cooldown. It is
// destroyed like any structure; a dead turret stops.
// e.headYaw is the head's angle relative to the base (the launcherHead prop).
export function turretRange(G, e) {
  const d = WEAPONS[e.weapon || TURRET.weapon];
  return min(d.range, (DIFF[G.diff] || DIFF.normal).sight);
}

export function stepTurrets(G, dt) {
  const P = G.player;
  for (let i = 0; i < G.entities.length; i++) {
    const e = G.entities[i];
    if (e.kind !== 'turret' || !e.alive) continue;
    e.cd = Math.max(0, (e.cd ?? 0) - dt);
    const mz = [e.x, e.y + e.height * TURRET.muzzle, e.z], at = P && P.alive ? center(P) : null;
    const d = at && sub(at, mz), dist = d ? hypot(d[0], d[2]) : Infinity;
    const sees = dist <= turretRange(G, e) && rayTerrain(G, mz, norm(d), hypot(...d)) == null;
    if (!sees) { e.seen = null; continue; }
    // Spotted: the first volley waits the difficulty's reaction time.
    if (e.seen == null) { e.seen = G.time; e.cd = Math.max(e.cd, (DIFF[G.diff] || DIFF.normal).react); }
    const want = wrapA(atan2(d[0], d[2]) - e.yaw), off = wrapA(want - (e.headYaw || 0));
    e.headYaw = wrapA((e.headYaw || 0) + clampN(off, -TURRET.turn * dt, TURRET.turn * dt));
    if (e.cd > 0 || Math.abs(wrapA(want - e.headYaw)) > TURRET.aimTol) continue;
    e.cd = TURRET.cd;
    const type = e.weapon || TURRET.weapon;
    volley(G, e, type, mz, norm(d), P);
    for (let i = 0; i < 6; i++) particle(G, mz, [G.rng.range(-3, 3), G.rng.range(1, 4), G.rng.range(-3, 3)], 1.2, 1.4, [0.6, 0.58, 0.55], 'smoke');   // the rack's backblast
    G.fx.sfx.missile(mz);
  }
}
