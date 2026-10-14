import { startMatch } from './state.js';
import { center } from './geom.js';
import { destroy, fire, loseSection } from './combat.js';
import { toPolar } from './placement.js';
import { add, clampN, wrapA } from '../util/math.js';

const { sin, cos, atan2, hypot, PI } = Math;

// The bench (?debug=1: BENCH on the FEEL panel, or &bench=1): one scripted
// scene, the same every run, for looking at a change to the look, the walk
// or the effects side by side with the last one, and for `npm run perf`.
// Nobody thinks and nobody takes damage: every step, shot, lost limb and kill
// is on its clock, on level ground and a fixed seed, so a change to the AI,
// the dice or the balance doesn't reshuffle the field it measures.
export const BENCH_SEED = 4242;
export const BENCH_CHASSIS = 'kestrel';
// The segments, each ending at `to` seconds. perf.mjs budgets each one.
export const BENCH_SEGS = [
  { key: 'walk', to: 5 },     // five mechs, one of each gait, walk circles ahead; you stand and look
  { key: 'run', to: 11 },     // you turn, run, brake, jump and land; they keep walking
  { key: 'fight', to: 17 },   // they stop and shoot (beams, shells, missiles) and you shoot back; three lose a limb at 15.5
  { key: 'deaths', to: 19 },  // three die, a beat apart
  { key: 'wrecks', to: 22 },  // the two left fight on over the burning wrecks
  { key: 'away', to: 25 },    // everyone stops; you turn your back on it all (culling)
];
export const BENCH_END = BENCH_SEGS[BENCH_SEGS.length - 1].to;
export const benchSeg = t => (BENCH_SEGS.find(s => t < s.to) || BENCH_SEGS[BENCH_SEGS.length - 1]).key;

// Each walks a circle (centre, radius, way round, throttle) clear of the others and of your run.
const CAST = [
  { type: 'jackal', c: [-30, 60], r: 18, way: 1, thr: 0.7, limb: 'LA', dies: 17.0 },
  { type: 'warden', c: [30, 70], r: 22, way: -1, thr: 0.9, limb: 'LA' },
  { type: 'puncher', c: [0, 115], r: 20, way: 1, thr: 0.9 },
  { type: 'light1', c: [-55, 145], r: 22, way: -1, thr: 0.6, limb: 'RL', dies: 17.4 },
  { type: 'sniper1', c: [50, 145], r: 18, way: 1, thr: 0.8, dies: 17.8 },
];
const LIMBS_AT = 15.5;
// Who you shoot, first one standing.
const ORDER = ['puncher', 'warden', 'jackal', 'sniper1', 'light1'];

export const BENCH_DEF = {
  name: 'Bench', pal: 'dusk', intel: '', flat: [[0, 80, 140]],
  // Each starts on its circle, a third of the way round, facing along it.
  foes: CAST.map((s, i) => {
    const a = i * 1.3, x = s.c[0] + s.r * cos(a), z = s.c[1] + s.r * sin(a);
    const yaw = atan2(-sin(a) * s.way, cos(a) * s.way);
    return { type: s.type, at: toPolar(x, z), face: -yaw * 180 / PI, aware: false };
  }),
};

// A fresh bench match. The caller uploads the world and launches it as for any match.
export function startBench(G) {
  startMatch(G, BENCH_DEF, BENCH_SEED, false, BENCH_CHASSIS);
  G.kind = 'bench'; G.diff = 'normal';
  G.mechs.filter(m => m.team).forEach((m, i) => { m.script = CAST[i]; });
  G.bench = { seg: 'walk', done: false, lost: false, dead: 0 };
}

const turnTo = (m, yaw, dt) => { m.yaw += clampN(wrapA(yaw - m.yaw), -m.ch.turn * dt, m.ch.turn * dt); };
const toward = (a, b) => atan2(b.x - a.x, b.z - a.z);

// One frame of the script, before the sim runs it: moves the cast, fires
// their guns, takes limbs and lives on time, and fills in your input (`inp`,
// an empty one: see update.js noInput).
export function benchStep(G, inp, dt) {
  const B = G.bench, t = G.time, P = G.player;
  B.seg = benchSeg(t);
  if (t >= BENCH_END) { B.done = true; P.throttle = 0; for (const m of G.mechs) m.throttle = 0; return inp; }
  for (const m of G.mechs) m.heat = Math.min(m.heat, 40);   // nobody overheats or shuts down: the heat is the script's to keep
  const fighting = t >= 11 && t < 22, cast = G.mechs.filter(m => m.script && m.alive);
  // The cast: circles until the fight, then stand, face you and shoot.
  cast.forEach((m, i) => {
    const s = m.script;
    if (t < 11) {
      const dx = m.x - s.c[0], dz = m.z - s.c[1], a = atan2(dz, dx), off = (hypot(dx, dz) - s.r) / s.r;
      turnTo(m, atan2(-sin(a) * s.way, cos(a) * s.way) - s.way * clampN(off, -0.5, 0.5) * 1.5, dt);   // along the circle, steering back onto it
      m.throttle = s.thr;
      return;
    }
    m.throttle = 0;
    turnTo(m, toward(m, P), dt);
    m.twist = 0;
    if (!fighting || Math.abs(wrapA(toward(m, P) - m.yaw)) > 0.3) return;
    // Aim wanders on a clock of its own, never the dice. Only the WARDEN's
    // gun and laser hit you, low on the legs (the hit's feel, on the record);
    // everything else, missiles too (unguided here), goes by a few metres to
    // the side and above, where you see it pass. Five guns' smoke at the
    // cockpit would fill the view.
    const dist = hypot(P.x - m.x, P.z - m.z), k = t * 1.7 + i * 2.1;
    const sx = (P.z - m.z) / dist, sz = -(P.x - m.x) / dist;
    const miss = (i % 2 ? 1 : -1) * (7 + 2 * sin(k)), low = [sin(k), -2.5, cos(k * 0.9)];
    const by = add(center(P), [sin(k) * 1.5 + sx * miss, 4 + sin(k * 1.3) * 1.2, cos(k * 0.9) * 1.5 + sz * miss]);
    for (const w of m.weapons) {
      if (w.dead || dist > w.def.range) continue;
      const at = s.type === 'warden' && w.def.kind !== 'missile' ? add(center(P), low) : by;
      if (w.def.kind === 'beam') { if (sin(t * 2.2 + i) > 0.1) { m.beamOn = true; m.ai.beamAim = at; } }
      else if (w.def.kind !== 'fusion') fire(G, m, w, at, null);
    }
  });
  if (t >= LIMBS_AT && !B.lost) {
    B.lost = true;
    for (const m of cast) if (m.script.limb) loseSection(G, m, m.script.limb, center(m), P);
  }
  for (const m of cast) if (m.script.dies != null && t >= m.script.dies) { destroy(G, m, P); B.dead++; }

  // You: look about, then the run, then the fight, then turn your back.
  P.pitch = -0.02;
  if (t < 5) { P.twist = 0.35 * sin(t * 1.2); P.throttle = 0; }
  else if (t < 11) {
    P.twist *= 0.9;
    if (t < 6.2) { turnTo(P, -PI / 2, dt); P.throttle = 0; }
    else if (t < 8.5) P.throttle = 1;
    else P.throttle = 0;   // brake: the body pitches forward
    inp.jets = t >= 9 && t < 9.8;   // a hop while still rolling
    if (t >= 10) turnTo(P, 0, dt);
  } else if (t < 22) {
    const tgt = ORDER.map(k => G.mechs.find(m => m.alive && m.type === k)).find(Boolean);
    G.target = tgt || null;
    if (tgt) {
      turnTo(P, toward(P, tgt), dt * 0.5);
      P.twist += clampN(clampN(wrapA(toward(P, tgt) - P.yaw), -1.9, 1.9) - P.twist, -1.6 * dt, 1.6 * dt);
      inp.held.energy = sin(t * 2.5) > -0.2;
      inp.held.ballistic = true;
      inp.held.missile = t % 1 < 0.1;   // taps: a held trigger would take the volley's camera
    }
  } else {
    G.target = null;
    turnTo(P, PI, dt); P.twist *= 0.9;
  }
  return inp;
}
