import { add, mul, norm, sub } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { SECT_NAME } from '../data/chassis.js';
import { center, muzzle, rayHit, viewYaw } from './geom.js';
import { explode, hitSparks, msg, particle, shedPart } from './effects.js';
import { M } from '../util/math.js';
import { geoOf as geo } from '../data/geo.js';
import { torsoFrame } from './geom.js';
import { died, fxShell, fxMissiles } from '../net/protocol.js';
import { blast, endGuide } from './missiles.js';
import { feel } from './feel.js';
import { HIT_BY_SECTION, HIT_STOP } from '../data/feel.js';
import { voice } from './voice.js';
import { alertEnemy } from './ai/perception.js';
import { WEAPONS } from '../data/weapons.js';
import { knock } from './knock.js';

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
// What a round does beyond its damage, by weapon: a bolt scrambles and
// rattles; anything with `knock` shoves the mech it hits along its flight.
export function onShotHit(G, s, t, p) {
  const d = WEAPONS[s.type];
  if (!d || !t.alive && !t.dying) return;
  if (d.scramble) scramble(G, t, d.scramble, p);
  if (d.knock && t.alive) { const h = Math.hypot(s.v[0], s.v[2]) || 1; knock(G, { target: t, attacker: s.owner, base: d.knock, dir: [s.v[0] / h, s.v[2] / h], recoil: false }); }
}
export function scramble(G, t, secs, p) {
  if (t.remote) { const q = G.pendingHits.get(t.netId); if (q) q.zap = 1; return; }   // their client scrambles itself
  t.scramble = Math.max(t.scramble || 0, secs);
  const a = viewYaw(t), side = -Math.sign((p[0] - t.x) * cos(a) - (p[2] - t.z) * sin(a)) || 1;
  feel(G, 'bolt', { mech: t, k: 1, roll: side, at: t === G.player ? null : p });
}

export function damage(G, m, p, amt, src, beam = false, melee = false) {
  if (!m.alive) return;
  if (!melee) m.lastHitMelee = false;
  if (m.remote) {
    // Another pilot: what the shooter sees counts, and the victim's own
    // client applies it. Hits are batched (a beam deals damage every
    // frame) and flushed a few times a second -- see flushHits.
    if (G.roundOver) return;
    if (!beam) hitSparks(G, m, p, sectionHit(m, p), amt);   // the shooter sees the sparks; the damage is the victim's to apply
    const q = G.pendingHits.get(m.netId) || { amt: 0, p };
    q.amt += amt; q.p = p;
    if (melee) q.me = 1;
    G.pendingHits.set(m.netId, q);
    if (src === G.player) { if (!beam) { G.stats.hits++; G.hitStop = HIT_STOP; } G.stats.dealt += amt; G.hitMark = 0.25; }
    return;
  }
  if (m === G.player && mp(G) && (m.spawnT > 0 || G.roundOver)) return;
  let sec = sectionHit(m, p);
  if (m.hp[sec] <= 0) sec = 'T';
  m.hp[sec] -= amt;
  if (!beam) hitSparks(G, m, p, sec, amt);
  if (src === G.player && m !== G.player) { if (!beam) { G.stats.hits++; G.hitStop = HIT_STOP; } G.stats.dealt += amt; }
  // Which side the blow came from, in torso space: the wobble leans away from it.
  const a = viewYaw(m), side = -Math.sign((p[0] - m.x) * cos(a) - (p[2] - m.z) * sin(a));
  if (!beam) feel(G, 'hit', { mech: m, k: amt / 10 * (HIT_BY_SECTION[sec] || 1), roll: side, at: m === G.player ? null : p });   // beams don't jolt: the renderer sways a melting mech instead
  if (m === G.player) {
    G.stats.taken += amt;
    if (!beam || G.time - (G.lastClang || 0) > 0.35) { G.lastClang = G.time; G.fx.sfx.clang(sectionHit(m, p)); }   // arms ring, legs thud, the torso is dull
    if (!G.target && src && src.alive) G.target = src;
  } else if (m.team !== 0 && !m.remote) { m.ai.hitAt = G.time; alertEnemy(G, m, G.player, src && src !== m ? [src.x, src.y, src.z] : null); }   // being hit is a contact; the shooter's spot is the belief
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
  if (m === G.player) {
    const leg = sec === 'LL' || sec === 'RL';
    if (leg && m.hp.LL <= 0 && m.hp.RL <= 0) voice(G, 'legsLost');
    else voice(G, leg ? 'legLost' : 'armLost', { flat: `${SECT_NAME[sec]} destroyed.` });
  }
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

// The death, in beats (docs/specs/13-thunk.md): on torso zero the mech
// freezes for BEAT seconds with only a rising whine, then the torso blows,
// then the body topples about its feet over TOPPLE seconds, then it is a
// wreck that pops a few more times. Gameplay (alive, scores, the match
// ending) changes at once; only the show is staged.
// The stages of a kill: a beat of silence, the torso blows (and sheds its
// arms and a shower of plates), the legs buckle, the body topples, the wreck
// settles and pops. Gameplay changes at once; only the show waits.
export const DEATH_BEAT = 0.25, DEATH_BUCKLE = 0.3, DEATH_TOPPLE = 0.8, WRECK_SETTLE = 1.0;
const BUCKLE_DROP = 0.4;   // fraction of the hip height the hull drops as the knees fold
export function beginDeath(G, m) {
  const r = G.rng;
  m.alive = false;
  m.dying = { t: 0, exploded: false, angle: 0, drop: 0, buckle: 0, fallYaw: m.yaw + (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.7, 0.7), roll: r.range(-0.6, 0.6) };
  G.fx.sfx.whine(m === G.player ? null : center(m));
  if (G.target === m) G.target = null;
}
export function stepDying(G, dt) {
  for (const m of G.mechs) {
    const d = m.dying;
    if (!d) continue;
    d.t += dt;
    if (!d.exploded && d.t >= DEATH_BEAT) {
      d.exploded = true;
      const r = G.rng;
      explode(G, center(m), true);
      explode(G, add(center(m), [r.range(-3, 3), 2, r.range(-3, 3)]), false);
      // The blast takes the arms off and strips plates; they land with the rest of the debris.
      const c = center(m);
      for (const sec of ['LA', 'RA']) if (m.hp[sec] > 0) { m.hp[sec] = 0; shedSection(G, m, sec, add(c, [r.range(-1, 1), 0, r.range(-1, 1)])); }
      for (let i = 0; i < 4; i++) shedPart(G, m, 'plate', add(c, [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)]), [r.range(-8, 8), r.range(4, 12), r.range(-8, 8)]);
      if (m === G.player) feel(G, 'death', { mech: m });
    }
    if (d.exploded) {
      // The legs buckle: the hull drops as the knees fold and the body starts to lean.
      const b = Math.min(1, (d.t - DEATH_BEAT) / DEATH_BUCKLE);
      d.buckle = b; d.drop = b * b * BUCKLE_DROP * geo(m).hip * m.ch.scale;
      const u = Math.max(0, Math.min(1, (d.t - DEATH_BEAT - DEATH_BUCKLE) / DEATH_TOPPLE));
      d.angle = b * 0.12 + u * u * (Math.PI / 2 - 0.12) * 0.95;   // a lean during the buckle, then it falls faster as it goes
      if (u >= 1) {
        G.wrecks.push({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, type: m.partsKey, scale: m.ch.scale, t: 0, roll: d.roll, pops: 2 + G.rng.int(3), settle: 0 });
        G.fx.sfx.boom([m.x, m.y, m.z], false);
        m.dying = null; m.gone = true;
      }
    }
  }
}

export function destroy(G, m, src) {
  if (m === G.player) { endGuide(G, true); G.mDown = false; }
  beginDeath(G, m);
  if (mp(G) && m === G.player) {
    // In the arena your own client declares your death; the server scores it.
    G.fx.netSend(died(src?.netId, m.lastHitMelee));
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
  voice(G, m.lastHitMelee === 'stomp' ? 'killStomp' : m.lastHitMelee ? 'killPunch' : 'kill', {}, true, DEATH_BEAT * 1000);   // after the bang, not before
  if (G.player.alive && !G.mechs.some(e => e.team !== 0 && e.alive)) {
    G.state = 'over'; G.endT = 3.5; G.won = true;
    voice(G, 'complete', {}, true, 1400);
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
    G.shots.push({ kind: 'shell', type: w.type, p: mz, v: mul(dir, d.speed), owner: m, dmg: d.dmg, life: d.range / d.speed });
    if (mp(G) && m === G.player) G.fx.netSend(fxShell(mz, mul(dir, d.speed), w.type));
    for (let i = 0; i < 5; i++) particle(G, add(mz, mul(dir, 1.5)), add(mul(dir, r.range(4, 12)), [r.range(-2, 2), r.range(-1, 2), r.range(-2, 2)]), 0.15, 0.6, [1, 0.8, 0.3], 'fire');
    G.fx.sfx.cannon(mz, !!d.recoil);
    m.flash = { frame: G.frame, p: mz, dir, big: true };   // muzzle flash, drawn for two frames
    if (m === G.player) feel(G, d.bolt ? 'fireBolt' : d.recoil ? 'fireGauss' : 'fireAc', { mech: m, dir: [-dir[0], -dir[2]] });
    if (d.recoil) { const h = Math.hypot(dir[0], dir[2]) || 1; m.push[0] -= dir[0] / h * d.recoil; m.push[1] -= dir[2] / h * d.recoil; }   // rocks the shooter back a step, whoever it is
  } else {
    const vid = ++G.volleySeq;
    for (let i = 0; i < d.count; i++) {
      const sp = d.spread ?? 0.08, lift = d.lift ?? 0.12;   // homing volleys fan out and climb; they find their way down
      const spread = norm(add(dir, [r.range(-sp, sp), r.range(0, lift), r.range(-sp, sp)]));
      G.shots.push({ kind: 'missile', type: w.type, p: add(mz, [r.range(-0.6, 0.6), r.range(-0.4, 0.4), r.range(-0.6, 0.6)]), v: mul(spread, d.speed * r.range(0.85, 1.1)),
        owner: m, dmg: d.dmg, life: d.range / d.speed + 1, target: d.homing === false ? null : target, smoke: 0, age: 0, vid });
    }
    m.flash = { frame: G.frame, p: mz, dir, big: false };
    if (m === G.player) { G.lastVolley = vid; feel(G, 'fireLrm', { mech: m, dir: [-dir[0], -dir[2]] }); }
    G.fx.sfx.missile(mz);
    if (mp(G) && m === G.player) G.fx.netSend(fxMissiles(mz, dir, d.homing === false ? 0 : target?.netId, G.lastVolley, w.type));
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
      if (hit.mech && !s.ghost) { damage(G, hit.mech, hit.point, s.dmg, s.owner); onShotHit(G, s, hit.mech, hit.point); }   // ghosts are other pilots' shots: theirs to score
      if (s.kind === 'missile' && !s.ghost) blast(G, hit.point, s.dmg, s.owner, hit.mech);
      explode(G, hit.point, false);
    } else s.p = add(s.p, mul(s.v, dt));
    if (s.life <= 0 && s.kind === 'missile' && !hit) { if (!s.ghost) blast(G, s.p, s.dmg, s.owner, null); explode(G, s.p, false); }
  }
  G.shots = G.shots.filter(s => s.life > 0);
}
