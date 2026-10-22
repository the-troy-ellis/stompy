import { startMatch } from './state.js';
import { clampN } from '../util/math.js';

const { hypot } = Math;

// ?debug=1's walk viewer (JUMP TO → WALK, ui/walkView.js): one mech, yours,
// walking on flat ground with nothing else about, watched from outside, to
// judge the gait's look (docs/specs/19-debug-menu.md § Walk viewer). The sim
// side is only this: the match, and the viewer's hands on the throttle and
// the legs. The page slows time, steps frames and moves the camera.
export const WALK_DEF = { name: 'Walk', pal: 'dusk', intel: '', ground: {}, objectives: [], foes: [], crew: [] };
// STRAIGHT walks north and, past WALK_WRAP m from the middle, is moved back
// (feet and all, so nothing slides); CIRCLE turns at WALK_TURN of the legs' rate.
export const WALK_PATHS = ['straight', 'circle'];
export const WALK_WRAP = 200, WALK_TURN = 0.35;
const THR_RATE = 0.9;   // as the keys move the throttle (update.js)

export function startWalkView(G, chassis, opts = {}) {
  startMatch(G, WALK_DEF, 1, false, chassis, { terrainOpts: { flat: true }, ...opts });
  G.kind = 'walk';
  G.walk = { thr: 0.6, go: true, path: 'straight' };
}

// Moves a mech and its planted feet together: the walk goes on as if nothing happened.
export function shiftMech(m, dx, dz) {
  m.x += dx; m.z += dz;
  for (const f of m.feet || []) {
    f.pos[0] += dx; f.pos[2] += dz;
    if (f.from) { f.from[0] += dx; f.from[2] += dz; }
  }
}

// One frame, before the sim runs it (update.js): the throttle eases to the
// picked speed (or to 0 on STOP) at the keys' rate, so starting and stopping
// look as they do in play; the path steers.
export function walkStep(G, inp, dt) {
  const W = G.walk, P = G.player, want = W.go ? W.thr : 0;
  P.heat = 0;
  P.throttle += clampN(want - P.throttle, -THR_RATE * dt, THR_RATE * dt);
  if (W.path === 'circle') inp.turn = WALK_TURN;
  else if (hypot(P.x, P.z) > WALK_WRAP) shiftMech(P, -P.x, -P.z);
  return inp;
}
