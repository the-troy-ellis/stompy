// The TOWER (docs/specs/32-base-loop.md § Part 2): a gun on a post that shoots
// raiders by itself. Built and working (sim/down.js works), it turns its head
// toward the nearest foe in TOWER.range it can see and, once on target, puts
// an autocannon round into it through the normal shell path (combat.js
// stepShots), every TOWER.cd. A hit on a raider is the tower's.
import { TOWER } from '../data/construct.js';
import { WEAPONS } from '../data/weapons.js';
import { center, rayHit } from './geom.js';
import { mechsNear } from './near.js';
import { works } from './down.js';
import { particle } from './effects.js';
import { norm, sub, wrapA, clampN, mul, add } from '../util/math.js';

const NEAR = [];
// The foe it would shoot now: the nearest live one in range with a clear line
// of fire from the muzzle: not behind a hill, and not through anything of the
// base's (a silo, a wall, a crew mech) in between.
export function towerTarget(G, e, mz) {
  const k = mechsNear(G, e.x, e.z, TOWER.range, NEAR);
  let best = null, bestD = Infinity;
  for (let i = 0; i < k; i++) {
    const m = NEAR[i];
    if (!m.alive || m.team === 0 || m.team == null) continue;
    const c = center(m), d = sub(c, mz), flat = Math.hypot(d[0], d[2]);
    if (flat > TOWER.range || flat >= bestD) continue;
    const hit = rayHit(G, mz, norm(d), Math.hypot(...d) + 2, e);
    if (!hit || hit.mech !== m) continue;   // the ground, or something of ours, in the way
    best = m; bestD = flat;
  }
  return best;
}

export function stepTowers(G, dt) {
  for (const e of G.base?.towers || []) {
    if (!e.alive || !works(e)) continue;
    e.cd = Math.max(0, (e.cd || 0) - dt);
    const mz = [e.x, e.y + e.height * TOWER.muzzle, e.z], t = towerTarget(G, e, mz);
    if (!t) continue;
    const d = sub(center(t), mz), want = wrapA(Math.atan2(d[0], d[2]) - e.yaw), off = wrapA(want - (e.headYaw || 0));
    e.headYaw = wrapA((e.headYaw || 0) + clampN(off, -TOWER.turn * dt, TOWER.turn * dt));
    if (e.cd > 0 || Math.abs(wrapA(want - e.headYaw)) > TOWER.aim) continue;
    e.cd = TOWER.cd;
    shoot(G, e, mz, norm(d));
  }
}

// One round out of the barrel: a shell like a mech's autocannon's, owned by the tower.
function shoot(G, e, mz, dir) {
  const w = WEAPONS[TOWER.weapon], r = G.rng, p = add(mz, mul(dir, 1.5));
  G.shots.push({ kind: 'shell', type: TOWER.weapon, p, v: mul(dir, w.speed), owner: e, dmg: w.dmg, life: w.range / w.speed });
  for (let i = 0; i < 4; i++) particle(G, p, add(mul(dir, r.range(4, 12)), [r.range(-2, 2), r.range(-1, 2), r.range(-2, 2)]), 0.15, 0.6, [1, 0.8, 0.3], 'fire');
  G.fx.sfx[w.sfx || 'cannon'](mz);
}
