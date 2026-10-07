import { add, clampN, dot, len, mul, norm, sub, wrapA } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { WEAPONS } from '../data/weapons.js';
import { center, muzzle, rayHit, rayTerrain } from './geom.js';
import { destroy } from './combat.js';
import { explode, particle } from './effects.js';
import { r2 } from '../net/protocol.js';
import { feel } from './feel.js';
import { sendFx } from './hitqueue.js';

const { sin, abs, atan2, hypot, min, max } = Math;

// The fusion cannon: scan the resonant frequency, then dump the reactor into it.
export function fusionTick(G, m, dt, on) {
  const w = m.weapons.find(w => w.def.kind === 'fusion' && !w.dead), r = G.rng;
  const st = m.fusion || (m.fusion = { mech: null, t: 0, on: false, end: null });
  if (!on || !w || w.cd > 0 || m.shutdown || !m.alive) {
    st.on = false; st.t = 0; st.mech = null; st.end = null;
    if (m === G.player) G.fx.fusionSound(false, 0);
    return;
  }
  st.on = true;
  const d = w.def, mz = muzzle(m, w), dir = norm(sub(G.aim, mz));
  const hit = rayHit(G, mz, dir, d.range, m);
  // What the laser is on: a direct hit, or a mech it passes within
  // `slack` of (with clear line of sight to it).
  const tgt = hit?.mech || nearMiss(G, m, mz, dir, d);
  const end = tgt ? center(tgt) : hit ? hit.point : add(mz, mul(dir, d.range));
  st.end = end;
  m.heat += d.scanHeat * dt;
  // A thin, flickering targeting laser, not a weapon beam.
  G.cbeams.push({ a: mz, b: end, col: d.col, w: 0.05 + 0.035 * abs(sin(G.time * 37)) });
  // The scan counts on one mech. A slip shorter than `grace` pauses it;
  // longer, or onto another mech, and it starts over.
  if (tgt && tgt === st.mech) { st.t += dt; st.off = 0; }
  else if (st.mech && !tgt && (st.off = (st.off || 0) + dt) < d.grace) { /* slipping: hold */ }
  else { st.mech = tgt || null; st.t = 0; st.off = 0; }
  st.slipping = !!(st.mech && st.off > 0);
  // Locked and on it: draw the torso gently toward the target.
  if (m === G.player && st.mech && !st.slipping) {
    const c = center(st.mech), e = G.eye, k = 1 - Math.exp(-d.assist * dt);
    const wantTwist = wrapA(atan2(c[0] - e[0], c[2] - e[2]) - m.yaw);
    const wantPitch = atan2(c[1] - e[1], hypot(c[0] - e[0], c[2] - e[2]));
    m.twist = clampN(m.twist + wrapA(wantTwist - m.twist) * k, -1.9, 1.9);
    m.pitch = clampN(m.pitch + (wantPitch - m.pitch) * k, -0.4, 0.45);
  }
  const p = st.mech ? min(1, st.t / d.scan) : 0;
  if (st.mech && r.chance(dt * (20 + 60 * p))) particle(G, add(end, [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)]), [r.range(-2, 2), r.range(0, 3), r.range(-2, 2)], 0.3, 0.3, w.def.col, 'fire');
  if (m === G.player) G.fx.fusionSound(true, p);
  if (st.mech && st.t >= w.def.scan) fusionFire(G, m, w, mz, st.mech);
}

// The mech the laser passes closest to, if within its radius + slack and
// nothing (terrain) is in the way.
export function nearMiss(G, m, mz, dir, d) {
  let best = null, bestD = Infinity;
  for (const t of G.mechs) {
    if (!t.alive || t === m) continue;
    const c = center(t), v = sub(c, mz), along = dot(v, dir);
    if (along < 0 || along > d.range) continue;
    const miss = len(sub(v, mul(dir, along))), lim = geoOf(t).radius * t.ch.scale + d.slack;
    if (miss > lim || miss >= bestD) continue;
    if (rayTerrain(G, mz, norm(v), len(v) - 1) != null) continue;
    best = t; bestD = miss;
  }
  return best;
}

// Fire: launch the pulse down the beam, then the reactor pays for it --
// feedback into your own torso, a deep overload shutdown, a recharge.
export function fusionFire(G, m, w, mz, t) {
  const d = w.def;
  launchPulse(G, mz, t, m, false);
  sendFx(G, m, { t: 'fx', k: 'fu', a: mz.map(r2), id2: t.netId || 0, e2: t.eid || 0, b: center(t).map(r2) });
  m.heat = d.overload; m.shutdown = true; w.cd = d.cd;
  m.fusion.t = 0; m.fusion.mech = null; m.fusion.on = false;
  feel(G, 'fusionFire', { mech: m, at: m === G.player ? null : mz });
  if (m === G.player) { G.fx.fusionSound(false, 0); G.fx.sfx.fusionCrack(); G.fx.sfx.powerdown(); }
  const cost = m.max.T * d.feedback;
  m.hp.T -= cost;
  if (m === G.player) { G.stats.taken += cost; G.fx.sfx.clang(); }
  if (m.hp.T <= 0) { m.hp.T = 0; destroy(G, m, null); return; }
  if (m === G.player) G.fx.say('Resonance discharge. Reactor overload. Torso damage.', true);
}

// The pulse: travels from the muzzle to the target (following it if it
// moves); kills on arrival. Ghost pulses are other pilots' -- visual only.
export function launchPulse(G, a, target, shooter, ghost, b) {
  const end = target ? center(target) : b;
  G.pulses.push({ a, b: end, target, shooter, ghost, t: 0, dur: max(0.2, len(sub(end, a)) / WEAPONS.fusion.pulseSpeed), hit: false, seed: G.rng.next() * 100 });
}
export function updatePulses(G, dt) {
  const r = G.rng;
  for (const pu of G.pulses) {
    pu.t += dt;
    if (pu.target && pu.target.alive) pu.b = center(pu.target);
    if (pu.hit || pu.t < pu.dur) continue;
    pu.hit = true;
    explode(G, pu.b, true); explode(G, add(pu.b, [0, 3, 0]), true);
    for (let i = 0; i < 14; i++) particle(G, add(pu.b, [r.range(-2, 2), r.range(-3, 3), r.range(-2, 2)]), [r.range(-16, 16), r.range(4, 20), r.range(-16, 16)], r.range(0.5, 1.1), r.range(0.8, 2.2), [0.95, 0.85, 1], 'fire');
    G.fx.sfx.fusion(pu.b);
    if (pu.ghost || !pu.target || !pu.target.alive) continue;
    // Resonance: the whole frame shakes itself apart, however much armour.
    const t = pu.target;
    if (t.remote) {
      // Another pilot's client, or the co-op host for an enemy, applies the kill.
      G.fx.netSend(t.eid && G.role === 'guest' ? { t: 'ehit', eid: t.eid, amt: 40, p: pu.b.map(r2), fu: 1 } : { t: 'hit', to: t.netId, amt: 40, p: pu.b.map(r2), fu: 1 });
      if (pu.shooter === G.player) { G.stats.hits++; G.hitMark = 0.6; }
    } else { t.hp.T = 0; destroy(G, t, pu.shooter); }
  }
  G.pulses = G.pulses.filter(pu => pu.t < pu.dur + 0.25);
}
