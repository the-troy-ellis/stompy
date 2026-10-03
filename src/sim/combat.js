import { add, mul, norm, sub } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { SECT_NAME } from '../data/chassis.js';
import { center, muzzle, rayHit, viewYaw } from './geom.js';
import { explode, msg, particle, shedPart } from './effects.js';
import { M } from '../util/math.js';
import { geoOf as geo } from '../data/geo.js';
import { torsoFrame } from './geom.js';
import { r2 } from '../net/protocol.js';
import { blast, endGuide } from './missiles.js';
import { feel } from './feel.js';

const { sin, cos } = Math;

export function sectionHit(m, p) {
  const dx = p[0] - m.x, dz = p[2] - m.z, ly = (p[1] - m.y) / m.ch.scale;
  if (ly < geoOf(m).legTop) { const a = m.yaw; return dx * cos(a) - dz * sin(a) > 0 ? 'LL' : 'RL'; }
  const a = viewYaw(m), lx = (dx * cos(a) - dz * sin(a)) / m.ch.scale;
  return lx > 1.6 ? 'LA' : lx < -1.6 ? 'RA' : 'T';
}

const mp = G => G.mode === 'mp';

// `beam`: a slice of continuous laser damage (one frame's worth) -- it
// isn't a "hit" for accuracy, and mustn't ring the armour every frame.
export function damage(G, m, p, amt, src, beam = false) {
  if (!m.alive) return;
  if (m.remote) {
    // Another pilot: what the shooter sees counts, and the victim's own
    // client applies it. Hits are batched (a beam deals damage every
    // frame) and flushed a few times a second -- see flushHits.
    if (G.roundOver) return;
    const q = G.pendingHits.get(m.netId) || { amt: 0, p };
    q.amt += amt; q.p = p;
    G.pendingHits.set(m.netId, q);
    if (src === G.player) { if (!beam) G.stats.hits++; G.stats.dealt += amt; G.hitMark = 0.25; }
    return;
  }
  if (m === G.player && mp(G) && (m.spawnT > 0 || G.roundOver)) return;
  let sec = sectionHit(m, p);
  if (m.hp[sec] <= 0) sec = 'T';
  m.hp[sec] -= amt;
  if (src === G.player && m !== G.player) { if (!beam) G.stats.hits++; G.stats.dealt += amt; }
  // Which side the blow came from, in torso space: the wobble leans away from it.
  const a = viewYaw(m), side = -Math.sign((p[0] - m.x) * cos(a) - (p[2] - m.z) * sin(a));
  if (!beam) feel(G, 'hit', { mech: m, k: amt / 10, roll: side, at: m === G.player ? null : p });   // beams don't jolt: the renderer sways a melting mech instead
  if (m === G.player) {
    G.stats.taken += amt;
    if (!beam || G.time - (G.lastClang || 0) > 0.35) { G.lastClang = G.time; G.fx.sfx.clang(sectionHit(m, p)); }   // arms ring, legs thud, the torso is dull
    if (!G.target && src && src.alive) G.target = src;
  } else m.ai.aware = true;
  if (m.hp[sec] > 0) {
    if (m === G.player && sec === 'T' && m.hp.T < m.max.T * 0.3) G.fx.say('Warning. Critical damage.');
    return;
  }
  const over = -m.hp[sec];
  m.hp[sec] = 0;
  if (sec === 'T') return destroy(G, m, src);
  m.weapons.forEach(w => { if (w.mount === sec) w.dead = true; });
  shedSection(G, m, sec, p);
  feel(G, 'sectionLost', { mech: m, roll: sec === 'LA' || sec === 'LL' ? -1 : sec === 'RA' || sec === 'RL' ? 1 : 0, at: m === G.player ? null : p });
  explode(G, p, false);
  if (m === G.player) G.fx.say(m.hp.LL <= 0 && m.hp.RL <= 0 && (sec === 'LL' || sec === 'RL') ? 'Legs destroyed. We are now a turret.' : `${SECT_NAME[sec]} destroyed.`, true);
  else if (src === G.player) msg(G, `${m.ch.name}: ${SECT_NAME[sec].toUpperCase()} DESTROYED`);
  if (over > 0) { m.hp.T -= over; if (m.hp.T <= 0) { m.hp.T = 0; destroy(G, m, src); } }
}

// The part comes off: an arm as one piece from the shoulder, a leg as thigh,
// shin and foot from where they are. Each flies away from the hit and tumbles.
export function shedSection(G, m, sec, p) {
  const r = G.rng, g = geo(m), s = m.ch.scale, away = norm([m.x - p[0], 0.4, m.z - p[2]]);
  const fling = () => add(mul(away, -r.range(3, 7)), [r.range(-2, 2), r.range(4, 8), r.range(-2, 2)]);
  if (sec === 'LA' || sec === 'RA') {
    const at = M.apply(torsoFrame(m), [(sec === 'LA' ? 1 : -1) * g.armX, g.armY, 0]);
    shedPart(G, m, 'arm', at, fling());
    return;
  }
  const feet = m.feet.filter((f, i) => (g.legs[i].hx > 0) === (sec === 'LL'));
  for (const f of feet) {
    const hip = [m.x, m.y + g.hip * s, m.z];
    shedPart(G, m, 'uleg', lerp3(hip, f.pos, 0.3), fling());
    shedPart(G, m, 'lleg', lerp3(hip, f.pos, 0.7), fling());
    shedPart(G, m, 'foot', f.pos, fling());
  }
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function destroy(G, m, src) {
  const r = G.rng;
  if (m === G.player) { endGuide(G, true); G.mDown = false; feel(G, 'death', { mech: m }); }
  m.alive = false;
  explode(G, center(m), true);
  explode(G, add(center(m), [r.range(-3, 3), 2, r.range(-3, 3)]), false);
  G.wrecks.push({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, type: m.partsKey, scale: m.ch.scale, t: 0, roll: r.range(-0.6, 0.6) });
  if (G.target === m) G.target = null;
  if (mp(G) && m === G.player) {
    // In the arena your own client declares your death; the server scores it.
    G.fx.netSend({ t: 'died', by: src?.netId || 0 });
    G.hooks.arenaDeath?.();
    // Real time, not game time: a slow phone shouldn't make the wait longer.
    G.respawnAt = G.clock + 5000; G.killer = src?.netId || 0;
    msg(G, 'MECH DESTROYED', '#f44');
    return;
  }
  if (m === G.player) {
    G.state = 'over'; G.endT = 3.2; G.won = false;
    msg(G, 'MECH DESTROYED', '#f44');
    return;
  }
  if (src === G.player) G.stats.kills++;
  G.fx.say('Target destroyed.', true);
  if (G.player.alive && !G.mechs.some(e => e.team !== 0 && e.alive)) {
    G.state = 'over'; G.endT = 3.5; G.won = true;
    G.fx.say('Mission objectives complete.', true, 1400);
  }
}

export function fire(G, m, w, aim, target) {
  const d = w.def, r = G.rng;
  if (d.kind === 'beam' || d.kind === 'fusion') return false;   // continuous: see beamTick / fusionTick
  if (!m.alive || m.shutdown || w.dead || w.cd > 0 || (d.ammo && w.ammo <= 0)) return false;
  const mz = muzzle(m, w);
  const dir = norm(sub(aim, mz));
  w.cd = d.cd; m.heat += d.heat;
  if (d.ammo) w.ammo--;
  if (m === G.player) G.stats.shots += d.count || 1;   // each missile can hit, so each counts
  if (d.kind === 'shell') {
    G.shots.push({ kind: 'shell', p: mz, v: mul(dir, d.speed), owner: m, dmg: d.dmg, life: d.range / d.speed });
    if (mp(G) && m === G.player) G.fx.netSend({ t: 'fx', k: 's', p: mz.map(r2), v: mul(dir, d.speed).map(r2) });
    for (let i = 0; i < 5; i++) particle(G, add(mz, mul(dir, 1.5)), add(mul(dir, r.range(4, 12)), [r.range(-2, 2), r.range(-1, 2), r.range(-2, 2)]), 0.15, 0.6, [1, 0.8, 0.3], 'fire');
    G.fx.sfx.cannon(mz);
    m.flash = { frame: G.frame, p: mz, dir, big: true };   // muzzle flash, drawn for two frames
    if (m === G.player) feel(G, 'fireAc', { mech: m, dir: [-dir[0], -dir[2]] });
  } else {
    const vid = ++G.volleySeq;
    for (let i = 0; i < d.count; i++) {
      const spread = norm(add(dir, [r.range(-0.08, 0.08), r.range(0, 0.12), r.range(-0.08, 0.08)]));
      G.shots.push({ kind: 'missile', p: add(mz, [r.range(-0.6, 0.6), r.range(-0.4, 0.4), r.range(-0.6, 0.6)]), v: mul(spread, d.speed * r.range(0.85, 1.1)),
        owner: m, dmg: d.dmg, life: d.range / d.speed + 1, target, smoke: 0, age: 0, vid });
    }
    m.flash = { frame: G.frame, p: mz, dir, big: false };
    if (m === G.player) { G.lastVolley = vid; feel(G, 'fireLrm', { mech: m, dir: [-dir[0], -dir[2]] }); }
    G.fx.sfx.missile(mz);
    if (mp(G) && m === G.player) G.fx.netSend({ t: 'fx', k: 'm', p: mz.map(r2), d: dir.map(r2), tg: target?.netId || 0, v: G.lastVolley });
  }
  return true;
}

// Shells and missiles, one frame: steer, fly, hit, splash.
export function stepShots(G, dt) {
  const r = G.rng;
  for (const s of G.shots) {
    s.life -= dt;
    if (s.kind === 'missile') {
      if (s.guided && G.guide && s.vid === G.guide.vid) {
        // Flown by the pilot: turn hard toward where the camera points.
        const sp = Math.hypot(...s.v);
        s.v = mul(norm(add(norm(s.v), mul(G.guide.dir, dt * 7))), sp);
      } else if (s.target && s.target.alive) {
        const want = norm(sub(center(s.target), s.p)), sp = Math.hypot(...s.v);
        s.v = mul(norm(add(norm(s.v), mul(want, dt * (s.owner === G.player ? 1.7 : 0.9)))), sp);
      }
      s.smoke += dt; s.age += dt;
      // No trail for the first moments: the racks sit beside the cockpit,
      // and smoke that close fills the whole screen.
      if (s.smoke > 0.05 && (s.age > 0.3 || s.owner !== G.player)) { s.smoke = 0; particle(G, s.p, [r.range(-0.5, 0.5), r.range(0, 1), r.range(-0.5, 0.5)], 0.9, 0.5, [0.55, 0.53, 0.5], 'smoke'); }
    } else s.v[1] -= 6 * dt;
    const stepL = Math.hypot(...s.v) * dt, dir = norm(s.v);
    const hit = rayHit(G, s.p, dir, stepL, s.owner);
    if (hit) {
      s.life = -1;
      if (hit.mech && !s.ghost) damage(G, hit.mech, hit.point, s.dmg, s.owner);   // ghosts are other pilots' shots: theirs to score
      if (s.kind === 'missile' && !s.ghost) blast(G, hit.point, s.dmg, s.owner, hit.mech);
      explode(G, hit.point, false);
    } else s.p = add(s.p, mul(s.v, dt));
    if (s.life <= 0 && s.kind === 'missile' && !hit) { if (!s.ghost) blast(G, s.p, s.dmg, s.owner, null); explode(G, s.p, false); }
  }
  G.shots = G.shots.filter(s => s.life > 0);
}
