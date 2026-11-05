import { TREES } from '../data/forest.js';
import { geoOf } from '../data/geo.js';
import { damage } from './combat.js';
import { feel } from './feel.js';
import { particle } from './effects.js';

// Rigid pieces (docs/specs/39-forest.md part 2; spec 38 builds its buildings'
// falls on the same idea): something cut loose that tips over as one body
// about its foot, toward `yaw`, and lands whole. A tree for now:
// `G.pieces = [{ tree, yaw, t, dur, by }]`. While it falls its tree's state
// is 1 (drawn on its own, render/scene.js); on landing it's 2 (lying, in the
// batches), and what it lands on, along its length, is crushed.
const { sin, cos, hypot, sqrt, min, max, PI } = Math;

// How far over (rad, 0 standing, PI/2 down) a piece is at its time: slow, then fast.
export const tipOf = p => (PI / 2) * min(1, (p.t / p.dur) ** 2);

// Fell tree `i` toward `yaw` (rad), by `by` (who gets the credit, or null).
export function fellTree(G, i, yaw, by = null) {
  const T = G.trees;
  if (!T || T.state[i]) return false;
  T.state[i] = 1;
  const P = (G.pieces ||= []);
  if (P.length >= TREES.pieces) land(G, P.shift());   // past the cap the oldest lands now
  P.push({ tree: i, yaw, t: 0, dur: TREES.fall * sqrt(T.h[i]), by });
  return true;
}

export function stepPieces(G, dt) {
  const P = G.pieces;
  if (!P || !P.length) return;
  for (let k = 0; k < P.length; k++) P[k].t += dt;
  for (let k = P.length - 1; k >= 0; k--) if (P[k].t >= P[k].dur) land(G, P.splice(k, 1)[0]);
}

// A tree lands: down where it fell; the mechs under its length (from its foot
// out along `yaw`, as wide as its crown) take the crush by its size; the
// thunk by its size and how near you are, and its dust.
function land(G, p) {
  const T = G.trees, i = p.tree, fx = sin(p.yaw), fz = cos(p.yaw), L = T.h[i], w = T.r[i] * 0.8;
  T.state[i] = 2; T.fall[i] = ((p.yaw / (2 * PI)) * 256 + 256) & 255;
  let foe = false;
  for (const m of G.mechs) {
    if (!m.alive || m.remote) continue;
    const ax = m.x - T.x[i], az = m.z - T.z[i], along = ax * fx + az * fz, side = Math.abs(ax * fz - az * fx);
    if (along < 0 || along > L || side > w + geoOf(m).radius * m.ch.scale) continue;
    damage(G, m, [m.x, m.y + geoOf(m).legTop * m.ch.scale, m.z], min(TREES.crushMax, TREES.crush * L), p.by);
    if (p.by && m.team !== p.by.team) foe = true;
  }
  if (foe && p.by === G.player) G.fx.say('Timber.');
  const at = [T.x[i] + fx * L * 0.6, T.y[i], T.z[i] + fz * L * 0.6], P = G.player;
  const near = P ? max(0, 1 - hypot(P.x - at[0], P.z - at[2]) / 120) : 0;
  if (near > 0) feel(G, 'land', { mech: null, k: near * min(1, 0.2 + L / 30), at });
  G.fx.sfx.settle?.(at);
  const r = G.rng;
  for (let k = 0; k < 6 + L / 3; k++) {
    const s = r.range(0.2, 1);
    particle(G, [T.x[i] + fx * L * s, T.y[i] + 0.5, T.z[i] + fz * L * s], [r.range(-2, 2), r.range(0.5, 2.5), r.range(-2, 2)], r.range(1, 2), r.range(1.2, 2.4), G.pal.low, 'dust');
  }
}
