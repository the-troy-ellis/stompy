import { FEEL } from '../data/feel.js';
import { kickSpring, makeSpring, stepSpring } from '../util/spring.js';
import { clampN, wrapA } from '../util/math.js';

const { min, max } = Math;

// The body springs every mech carries: squash (scalar) and wobble (pitch, roll).
export function initFeel(m) {
  const S = FEEL.spring;
  m.push = [0, 0];   // horizontal impulse, m/s; stepMech integrates and decays it
  m.squash = makeSpring(S.squashK, S.squashZeta);
  m.wob = { p: makeSpring(S.wobbleK, S.wobbleZeta), r: makeSpring(S.wobbleK, S.wobbleZeta) };
  m.sag = makeSpring(S.sagK, S.sagZeta);   // hip drop while shut down, metres
  m.tilt = { p: makeSpring(), r: makeSpring() };   // the whole body's lean from its own inertia, radians
}
export function stepFeel(m, dt) {
  if (!m.squash) initFeel(m);
  stepSpring(m.squash, dt); stepSpring(m.wob.p, dt); stepSpring(m.wob.r, dt);
  stepTilt(m, dt);
  // A mech with its reactor down slumps; a running one stands back up.
  stepSpring(m.sag, dt, m.shutdown ? FEEL.shutdown.sag * m.ch.scale : 0);
}

// Weight (FEEL.inertia): the body tips about its feet against its own
// acceleration, back as it speeds up, forward as it brakes (and rocks), and
// out of a turn. Seen, not simulated: the feet, the aim and the eye stay put.
// tilt.p > 0 pitches it forward (RX), tilt.r > 0 rolls it toward its right
// (RZ; a mech's left is +x, where its LL leg is). A turn left is yaw rising.
export function inertiaTargets(m, accel, yawRate) {
  const I = FEEL.inertia;
  if (m.air || !m.alive) return [0, 0];
  return [clampN(-accel * I.pitch, -I.max, I.max), clampN((m.speed || 0) * yawRate * I.roll, -I.max, I.max)];
}
function stepTilt(m, dt) {
  const I = FEEL.inertia, sp = m.speed || 0;
  if (!m.tilt) m.tilt = { p: makeSpring(), r: makeSpring() };
  const accel = dt > 0 ? (sp - (m.tiltSpeed ?? sp)) / dt : 0, yawRate = dt > 0 ? wrapA(m.yaw - (m.tiltYaw ?? m.yaw)) / dt : 0;
  m.tiltSpeed = sp; m.tiltYaw = m.yaw;
  const [p, r] = inertiaTargets(m, accel, yawRate), k = I.k / (m.ch.scale * m.ch.scale), c = 2 * Math.sqrt(k) * I.zeta;
  for (const s of [m.tilt.p, m.tilt.r]) { s.k = k; s.c = c; }   // live from the FEEL panel
  stepSpring(m.tilt.p, dt, p); stepSpring(m.tilt.r, dt, r);
}

// The camera's eased drop (the `bob` column), in the same units as G.kick.
// Impulses go into G.bobIn and G.bob follows it: two critically damped
// springs in series, so the view starts from rest, dips and comes back
// without ringing. stepBob runs them once a frame.
const tune = s => { const S = FEEL.spring; s.k = S.bobK; s.c = 2 * Math.sqrt(S.bobK) * S.bobZeta; return s; };   // live from the FEEL panel
function bobIn(G) {
  if (!G.bob) { G.bob = makeSpring(); G.bobIn = makeSpring(); }
  return tune(G.bobIn);
}
export function stepBob(G, dt) {
  if (!G.bob) return;
  stepSpring(tune(G.bobIn), dt);
  stepSpring(tune(G.bob), dt, G.bobIn.x);
}

// One event, one row of the table. `k` is the intensity the event supplies
// (pace, landing force, damage / 10, blast falloff); `mech` is who it
// happened to (its body springs react); `roll` leans the wobble sideways
// (-1..1, e.g. a hit from the left); `dir` is the unit [x, z] the mech is
// pushed along for rows with a push column; `at` places the thump in the world.
// Camera and screen effects apply only when it happened to the player.
export function feel(G, event, { mech = null, k = 1, roll = 0, dir = null, at = null } = {}) {
  const row = FEEL[event];
  if (!row || !(k > 0)) return;
  const V = FEEL.view, mine = mech === G.player || mech === null;
  // REDUCED MOTION: the player's camera and body response at 30%, no haptics; other mechs are untouched.
  const rm = mine && G.reducedMotion ? V.reducedScale : 1;
  if (mine) {
    if (row.kick) G.kick = max(G.kick, row.kick * k * rm);
    if (row.bob) kickSpring(bobIn(G), row.bob * k * rm);
    if (row.shake) G.shake = min(V.shakeMax, G.shake + row.shake * k * rm);
    if (row.flash) G.flash = min(V.flashMax, G.flash + row.flash * k);
    if (row.white) G.whiteFlash = max(G.whiteFlash || 0, row.white * k);
  }
  if (mech) {
    if (!mech.squash) initFeel(mech);
    if (row.squash) kickSpring(mech.squash, row.squash * k * 8 * rm);
    if (row.wobble) { kickSpring(mech.wob.p, row.wobble * k * (1 - 0.5 * Math.abs(roll))); if (roll) kickSpring(mech.wob.r, row.wobble * k * roll); }
    if (row.push && dir) { mech.push[0] += dir[0] * row.push * k; mech.push[1] += dir[1] * row.push * k; }
    // The restart snaps the body up past standing height before it settles.
    if (row.overshoot && mech.sag) {
      // Enough upward velocity to carry a critically damped spring from where it
      // sags now through standing height to about `overshoot` above it.
      const w = Math.sqrt(mech.sag.k);
      kickSpring(mech.sag, -(w * Math.max(0, mech.sag.x) + row.overshoot * mech.ch.scale * w * Math.E * 1.6) - mech.sag.v);   // 1.6: ~4 cm past standing for overshoot 0.1
    }
  }
  if (row.bass || row.duck || row.haptic) G.fx.thump(row.bass * k, row.duck * k, mine && !G.reducedMotion ? row.haptic * k : 0, at);
}
