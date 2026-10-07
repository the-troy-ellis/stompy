import { clampN, wrapA } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { meleeOf, punchArm } from '../data/melee.js';
import { center, viewYaw } from './geom.js';
import { damage } from './combat.js';
import { knock } from './knock.js';
import { hitQueue } from './hitqueue.js';
import { feel } from './feel.js';
import { fxPunch } from '../net/protocol.js';
import { damageEntity, solid, sceneryNear } from './entities.js';

const { atan2, hypot, sin, cos } = Math;

// Melee: a press starts a wind-up; at the hit frame the nearest mech within
// reach and arc takes the blow and the knockback; then a recovery during
// which the mech cannot fire and turns at half rate. Miss and it whiffs.

export const canPunch = (G, m) => m.alive && !m.shutdown && !m.melee && !(m.meleeCd > 0) && !(m === G.player && G.guide);

export function meleePress(G, m) {
  if (!canPunch(G, m)) return false;
  const def = meleeOf(m);
  m.melee = { t: 0, phase: 'windup', hit: null };
  if (def.fists) m.melee.arm = m.lastArm = punchArm(m);   // left, right, left: whichever fist is still on
  m.meleeCd = def.cd;
  if (G.mode === 'mp' && m === G.player) G.fx.netSend(fxPunch());
  return true;
}

// A remote pilot's swing: its client resolves the blow; this one only keeps
// the pose moving between state reports. `pu` is the phase it last reported.
export function meleeGhost(m, dt, pu) {
  const def = meleeOf(m);
  if (pu === 1 && !m.melee) { m.melee = { t: 0, phase: 'windup', hit: null }; if (def.fists) m.melee.arm = m.lastArm = punchArm(m); }
  else if (pu === 2 && m.melee?.phase !== 'recover') m.melee = { t: def.windup, phase: 'recover', hit: null };
  else if (pu === 0 && m.melee?.phase === 'recover') m.melee = null;   // a wind-up outlives a stale 0 until the next report
  if (!m.melee) return;
  m.melee.t += dt;
  if (m.melee.phase === 'windup' && m.melee.t >= def.windup) m.melee.phase = 'recover';
  if (m.melee.t >= def.windup + def.recover) m.melee = null;
}

const NEAR = [];
// The mech this one's swing would land on right now, or null.
export function meleeTarget(G, m) {
  const def = meleeOf(m), c = center(m), facing = viewYaw(m), reach = def.reach * m.ch.scale;
  let best = null, bestD = Infinity;
  for (const t of G.mechs) {
    if (t === m || !t.alive) continue;
    const dx = t.x - m.x, dz = t.z - m.z, d = hypot(dx, dz) - geoOf(t).radius * t.ch.scale;
    if (d > reach || d >= bestD) continue;
    if (Math.abs(wrapA(atan2(dx, dz) - facing)) > def.arc) continue;
    best = t; bestD = d;
  }
  // Structures and vehicles can be punched too (a punched-down tower topples away from the fist).
  // The map's scenery too (it sparks; it's bolted down), from the cells nearby.
  const E = G.entities, n = sceneryNear(G, m.x, m.z, reach, NEAR);
  for (let i = 0; i < E.length + n; i++) {   // indexed, far ones rejected squared: see pushOutOfEntities
    const e = i < E.length ? E[i] : NEAR[i - E.length];
    if (!solid(e)) continue;
    const dx = e.x - m.x, dz = e.z - m.z, far = reach + e.radius;
    if (dx * dx + dz * dz > far * far) continue;
    const d = Math.sqrt(dx * dx + dz * dz) - e.radius;
    if (d > reach || d >= bestD) continue;
    if (Math.abs(wrapA(atan2(dx, dz) - facing)) > def.arc) continue;
    best = e; bestD = d;
  }
  void c;
  return best;
}

export function meleeTick(G, m, dt) {
  if (m.meleeCd > 0) m.meleeCd = Math.max(0, m.meleeCd - dt);
  const st = m.melee;
  if (!st) return;
  const def = meleeOf(m);
  st.t += dt;
  if (st.phase === 'windup' && st.t >= def.windup) {
    st.phase = 'recover';
    const t = meleeTarget(G, m);
    if (t && t.kind) {
      // A structure or vehicle: the blow, the thunk, no knockback (it is bolted down, or a truck).
      const dx = t.x - m.x, dz = t.z - m.z, hd = hypot(dx, dz) || 1;
      const p = [t.x - dx / hd * t.radius, clampN(m.y + 5 * m.ch.scale, t.y + 0.5, t.y + t.height - 0.5), t.z - dz / hd * t.radius];
      damageEntity(G, t, def.dmg, m, p, { punch: true, yaw: atan2(dx, dz) });
      st.hit = { ent: t, p, v: 0 };
      m.heat += def.heat;
      feel(G, 'punch', { mech: m, k: 1, at: m === G.player ? null : p });
      G.fx.sfx.punch(m === G.player ? null : p, true);
    } else if (t) {
      // The blow lands on the target's skin, facing the attacker, at fist height.
      const dx = t.x - m.x, dz = t.z - m.z, hd = hypot(dx, dz) || 1, nx = dx / hd, nz = dz / hd;
      const R = geoOf(t).radius * t.ch.scale, p = [t.x - nx * R, clampN(m.y + 5 * m.ch.scale, t.y + 1, t.y + geoOf(t).height * t.ch.scale - 1), t.z - nz * R];
      t.lastHitMelee = 'punch';
      damage(G, t, p, def.dmg, m, false, true);
      const v = knock(G, { target: t, attacker: m, base: def.knock, dir: [nx, nz] });
      st.hit = { mech: t, p, v };
      m.heat += def.heat;
      const side = Math.sign(dx * cos(viewYaw(t)) - dz * sin(viewYaw(t))) || 1;
      feel(G, 'punch', { mech: m, k: 1, at: m === G.player ? null : p });
      feel(G, 'punched', { mech: t, k: 1, roll: -side, at: t === G.player ? null : p });
      G.fx.sfx.punch(m === G.player ? null : p, true);
      G.farthestShove = Math.max(G.farthestShove || 0, v);
    } else {
      feel(G, 'whiff', { mech: m });
      G.fx.sfx.punch(m === G.player ? null : center(m), false);
    }
  }
  if (st.phase === 'recover' && st.t >= def.windup + def.recover) m.melee = null;
}

// Landing on a mech: a stomp. Called from the landing branch with how long
// the lander was in the air.
export function tryStomp(G, m, airT) {
  const def = meleeOf(m);
  if (airT < def.stompAir) return null;
  const gm = geoOf(m), rm = gm.radius * m.ch.scale;
  for (const t of G.mechs) {
    if (t === m || !t.alive) continue;
    const gt = geoOf(t), top = t.y + gt.height * t.ch.scale, dx = t.x - m.x, dz = t.z - m.z, hd = hypot(dx, dz);
    // Feet passing through the top of the target this frame, and over it.
    if (hd > (rm + gt.radius * t.ch.scale) * 1.2 || m.y < top - 1.5 || m.y > top + 1.0) continue;
    const nx = hd > 0.01 ? dx / hd : 1, nz = hd > 0.01 ? dz / hd : 0;
    t.lastHitMelee = 'stomp';
    damage(G, t, [t.x, top - 0.5, t.z], def.stompDmg, m, false, true);
    knock(G, { target: t, attacker: m, base: def.stompKnock, dir: [nx, nz] });
    if (t.remote) { const q = hitQueue(G, t); if (q) q.st = 1; }
    m.vy = 4; m.push[0] -= nx * def.stompKnock * 0.5; m.push[1] -= nz * def.stompKnock * 0.5;
    feel(G, 'stomp', { mech: m, k: 1, at: m === G.player ? null : [t.x, top, t.z] });
    feel(G, 'punched', { mech: t, k: 1.2, at: t === G.player ? null : [t.x, top, t.z] });
    G.fx.sfx.punch(m === G.player ? null : [t.x, top, t.z], true);
    return t;
  }
  return null;
}
