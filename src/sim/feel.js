import { FEEL } from '../data/feel.js';
import { kickSpring, makeSpring, stepSpring } from '../util/spring.js';

const { min, max } = Math;

// The body springs every mech carries: squash (scalar) and wobble (pitch, roll).
export function initFeel(m) {
  const S = FEEL.spring;
  m.push = [0, 0];   // horizontal impulse, m/s; stepMech integrates and decays it
  m.squash = makeSpring(S.squashK, S.squashZeta);
  m.wob = { p: makeSpring(S.wobbleK, S.wobbleZeta), r: makeSpring(S.wobbleK, S.wobbleZeta) };
  m.sag = makeSpring(S.sagK, S.sagZeta);   // hip drop while shut down, metres
}
export function stepFeel(m, dt) {
  if (!m.squash) initFeel(m);
  stepSpring(m.squash, dt); stepSpring(m.wob.p, dt); stepSpring(m.wob.r, dt);
  // A mech with its reactor down slumps; a running one stands back up.
  stepSpring(m.sag, dt, m.shutdown ? FEEL.shutdown.sag * m.ch.scale : 0);
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
  if (mine) {
    if (row.kick) G.kick = max(G.kick, row.kick * k);
    if (row.shake) G.shake = min(V.shakeMax, G.shake + row.shake * k);
    if (row.flash) G.flash = min(V.flashMax, G.flash + row.flash * k);
    if (row.white) G.whiteFlash = max(G.whiteFlash || 0, row.white * k);
  }
  if (mech) {
    if (!mech.squash) initFeel(mech);
    if (row.squash) kickSpring(mech.squash, row.squash * k * 8);
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
  if (row.bass || row.duck || row.haptic) G.fx.thump(row.bass * k, row.duck * k, mine ? row.haptic * k : 0, at);
}
