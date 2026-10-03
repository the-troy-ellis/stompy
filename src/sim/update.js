import { add, clampN, dirOf, dot, len, mul, norm, sub } from '../util/math.js';
import { WEAPONS } from '../data/weapons.js';
import { geoOf } from '../data/geo.js';
import { center, eyeOf, muzzle, rayHit, viewYaw } from './geom.js';
import { stepMech } from './mech.js';
import { gait } from './gait.js';
import { think } from './ai.js';
import { stepShots, stepDying } from './combat.js';
import { beamTick, coolArmour, remoteBeam } from './beams.js';
import { fusionTick, updatePulses } from './fusion.js';
import { fireCat, missileTrigger, steerVolley } from './missiles.js';
import { meleeGhost, meleePress, meleeTarget, meleeTick } from './melee.js';
import { explode, particle, stepDebris } from './effects.js';
import { stepFeel } from './feel.js';
import { netInterp } from '../net/interp.js';

const { sin, abs, min, max, hypot, cos } = Math;

// The empty input: what the sim sees when nobody is touching anything.
export const noInput = () => ({ thrUp: false, thrDown: false, stop: false, turn: 0, twist: 0, pitch: 0, centre: false, jets: false,
  held: { energy: false, ballistic: false, missile: false, fusion: false }, missileTap: false, punch: false });

// One frame of the whole simulation. `input` is a snapshot (see noInput);
// `dt` is seconds (capped by the caller). Everything the sim wants the
// outside to do goes through G.fx.
export function update(G, input, dt) {
  G.time += dt;
  G.cbeams = [];   // continuous beams are redrawn every frame they're on
  G.frame = (G.frame || 0) + 1;
  G.input = input;
  const P = G.player;
  if (P.alive && !P.shutdown && !G.paused) {
    if (input.thrUp) P.throttle = min(1, P.throttle + dt * 0.9);
    if (input.thrDown) P.throttle = max(-0.35, P.throttle - dt * 0.9);
    if (input.stop) P.throttle = 0;
    P.yaw += clampN(input.turn, -1, 1) * P.ch.turn * dt * (P.hp.LL > 0 && P.hp.RL > 0 ? 1 : 0.5) * (P.melee ? 0.5 : 1);   // half rate mid-swing
    if (G.guide) { G.guide.yaw += input.twist * 1.4 * dt; G.guide.pitch = clampN(G.guide.pitch + input.pitch * 1.0 * dt, -1.3, 1.3); }
    else {
      P.twist = clampN(P.twist + input.twist * 1.6 * dt, -1.9, 1.9);
      P.pitch = clampN(P.pitch + input.pitch * 0.9 * dt, -0.4, 0.45);
    }
    if (input.centre) P.twist *= max(0, 1 - 6 * dt);
    P.jetting = !!input.jets;
  } else P.jetting = false;

  G.eye = eyeOf(P);
  G.view = dirOf(viewYaw(P), P.pitch);
  const aimHit = rayHit(G, G.eye, G.view, 1100, P);
  G.aim = aimHit ? aimHit.point : add(G.eye, mul(G.view, 1100));
  G.aimMech = aimHit?.mech || null;
  const t = G.target;
  G.lock = !!(t && t.alive && len(sub(center(t), G.eye)) < WEAPONS.lrm.range && dot(norm(sub(center(t), G.eye)), G.view) > cos(0.3));

  const live = P.alive && !G.paused && !G.roundOver;
  if (live && input.punch) meleePress(G, P);
  G.punchReady = live && !P.melee && !!meleeTarget(G, P);   // the HUD's fist and the PUNCH button light up
  const armed = live && !P.melee;   // no guns during a swing or its recovery
  P.beamOn = armed && input.held.energy && !G.guide;
  fusionTick(G, P, dt, armed && input.held.fusion && !G.guide);
  if (armed && input.held.ballistic) fireCat(G, 'ballistic');
  missileTrigger(G, armed && (input.held.missile || input.missileTap));
  if (G.guide) steerVolley(G, dt);

  for (const m of G.mechs) {
    if (m.remote) {
      if (m.alive) { netInterp(m, dt, G.clock); stepFeel(m, dt); gait(G, m, dt); meleeGhost(m, dt, m.net?.pu || 0); }
      else m.melee = null;
      if (m.alive && m.net?.bm && m.net.be) remoteBeam(G, m, m.net.be); else m.beaming = false;
      if (m.alive && m.net?.fl) G.cbeams.push({ a: muzzle(m, m.weapons.find(w => w.def.kind === 'fusion')), b: m.net.fl, col: WEAPONS.fusion.col, w: 0.05 + 0.035 * abs(sin(G.time * 37)) });
      continue;
    }
    if (m.team !== 0 && m.alive) think(G, m, dt);
    if (m.alive) { stepMech(G, m, dt); meleeTick(G, m, dt); }
    if (m.alive && m.beamOn) beamTick(G, m, dt, m === P ? G.aim : m.ai.beamAim);
    else m.beaming = false;
    if (m !== P) m.beamOn = false;
  }
  coolArmour(G, dt);
  // Mechs don't walk through each other.
  const alive = G.mechs.filter(m => m.alive);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j], dx = b.x - a.x, dz = b.z - a.z, d = hypot(dx, dz), r = geoOf(a).radius * a.ch.scale + geoOf(b).radius * b.ch.scale;
    const over = a.y > b.y + geoOf(b).height * b.ch.scale - 0.5 || b.y > a.y + geoOf(a).height * a.ch.scale - 0.5;   // one is clear above the other
    if (d < r && d > 0.01 && !over && !(a.remote && b.remote)) {
      // Only move mechs this client owns; other pilots' clients move theirs.
      const fa = a.remote ? 0 : b.remote ? 1 : 0.5, fb = b.remote ? 0 : a.remote ? 1 : 0.5, gap = r - d;
      a.x -= (dx / d) * gap * fa; a.z -= (dz / d) * gap * fa; b.x += (dx / d) * gap * fb; b.z += (dz / d) * gap * fb;
    }
  }

  stepShots(G, dt);
  stepDying(G, dt);
  updatePulses(G, dt);
  for (const b of G.beams) b.life -= dt;
  G.beams = G.beams.filter(b => b.life > 0);
  const rng = G.rng;
  for (const p of G.parts) {
    p.life -= dt;
    p.v[1] -= p.grav * dt;
    if (p.kind === 'smoke') p.v = mul(p.v, 1 - dt * 0.6);
    p.p = add(p.p, mul(p.v, dt));
    if (p.kind === 'debris') { const g = G.ter.height(p.p[0], p.p[2]); if (p.p[1] < g) { p.p[1] = g; p.v = [p.v[0] * 0.5, -p.v[1] * 0.35, p.v[2] * 0.5]; } }
    p.spin += dt * 3;
  }
  G.parts = G.parts.filter(p => p.life > 0);
  stepDebris(G, dt);
  for (const w of G.wrecks) {
    w.t += dt;
    // Secondaries: a few more pops in the first seconds after it goes down.
    if (w.pops > 0 && w.t > 0.4 && rng.chance(dt * 1.3)) { w.pops--; explode(G, [w.x + rng.range(-2, 2), w.y + rng.range(1, 3), w.z + rng.range(-2, 2)], false); }
    if (w.t < 30 && rng.chance(dt * 5)) particle(G, [w.x + rng.range(-2, 2), w.y + 2, w.z + rng.range(-2, 2)], [rng.range(-0.5, 0.5), rng.range(3, 5), rng.range(-0.5, 0.5)], rng.range(2, 3.5), rng.range(1, 2.2), [0.18, 0.17, 0.17], 'smoke');
  }
  for (const m of G.msgs) m.t -= dt;
  G.msgs = G.msgs.filter(m => m.t > 0);
  G.flash = max(0, G.flash - dt * 1.2);
  G.shake = max(0, G.shake - dt * 2.2);
  G.kick = max(0, G.kick - dt * 5);
  G.whiteFlash = max(0, (G.whiteFlash || 0) - dt * 1.6);
  G.hitMark = max(0, (G.hitMark || 0) - dt);
  G.twistRate = abs(P.twist - G.lastTwist) / max(dt, 1e-3);
  G.lastTwist = P.twist;

  if (G.state === 'over') {
    G.endT -= dt;
    if (G.endT <= 0) { G.state = 'debrief'; G.hooks.debrief?.(); }
  }
}
