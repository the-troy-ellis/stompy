import { addEntity } from './entities.js';
import { voice } from './voice.js';
import { polar } from './placement.js';
import { spawnWave, waveFoes, WAVE_WARN } from './waves.js';
import { allDown, coopLives } from './coopRules.js';
import { pilotsOf } from './hitqueue.js';
export { polar, flatZones } from './placement.js';

// Mission objectives (docs/specs/03-objectives.md § State machine). A mission
// lists `objectives`; without any it is ELIMINATE, as missions always were.
// The mission is won when every non-secondary objective is done, and lost
// when one fails or the player dies (the player's death is still declared in
// combat.js). `secondary: true` counts in the debrief and never fails it.
//   { type: 'eliminate' }                                  every team-1 mech
//   { type: 'destroy', targets: ['relay'], label: 'RELAY' } entities with those tags
//   { type: 'survive', seconds: 150, waves: [{ at: 0, foes: [...], from }] }
//                                                          hold out; waves arrive on the clock
//   { type: 'extract', at: 'nav_lz', within: 180 }        reach a nav point, in time if `within`
//   { type: 'escort', convoy: 'c1', to: 'nav_exit', minAlive: 2, label: 'CONVOY' }
//                                     at least minAlive of the vehicles tagged c1 reach the nav point
//   { type: 'protect', targets: ['store'], minAlive: 2, label: 'TANK' }
//                                     keep minAlive of those entities standing; it goes with
//                                     another objective (it is done when the mission is won)
// (A mission with `prefer: 'convoy'` sends its enemies after the trucks; ai.js.)
// Any objective may wait for another: `after: n`
// (its index) holds it until that one is done, and its clock starts then.

const TYPES = {
  eliminate: {
    init: () => ({}),
    tick(G, o) {
      const foes = G.mechs.filter(m => m.team !== 0 && !m.remote);
      o.left = foes.filter(m => m.alive).length; o.total = foes.length;
      if (o.left === 0 && !wavesPending(G)) return 'done';   // not while a wave is on its way
    },
  },
  destroy: {
    init: (G, d) => ({ targets: G.entities.filter(e => e.tags.some(t => d.targets.includes(t))) }),
    tick(G, o) {
      const was = o.done ?? 0;
      o.total = o.targets.length; o.done = o.targets.filter(e => !e.alive).length;
      if (o.done > was) voice(G, 'structureDown', {}, true, 900);   // after the bang
      if (o.total && o.done === o.total) return 'done';
    },
  },
  // Get the convoy home: done once minAlive of its vehicles have reached the
  // nav point, failed the moment fewer than minAlive are left. The voice says
  // so when it is shot at (no more than every CONVOY_WARN_EVERY seconds).
  escort: {
    init: (G, d) => ({ vehicles: G.entities.filter(e => e.kind === 'vehicle' && e.tags.includes(d.convoy)), nav: G.entities.find(e => e.id === d.to), warned: -Infinity }),
    tick(G, o) {
      const need = o.def.minAlive ?? 1, alive = o.vehicles.filter(v => v.alive), n = o.nav;
      const home = alive.filter(v => Math.hypot(v.x - n.x, v.z - n.z) <= n.trigger);
      o.alive = alive.length; o.total = o.vehicles.length; o.home = home.length;
      o.dist = alive.length ? Math.min(...alive.map(v => Math.hypot(v.x - n.x, v.z - n.z))) : 0;
      if (o.vehicles.some(v => v.lastHitAt > o.warned + CONVOY_WARN_EVERY)) { o.warned = G.time; voice(G, 'convoyHit'); }
      if (alive.length < need) { voice(G, 'convoyLost'); return 'failed'; }
      if (home.length >= need) return 'done';
    },
  },
  // Reach the nav point (its trigger radius); `within` seconds from when this
  // objective started, or it fails.
  extract: {
    init: (G, d) => ({ start: G.time, nav: G.entities.find(e => e.id === d.at) }),
    tick(G, o) {
      // Every pilot still standing must be there (co-op); dist is the furthest one's.
      const n = o.nav;
      o.dist = 0;
      for (const P of pilotsOf(G)) if (P.alive) o.dist = Math.max(o.dist, Math.hypot(n.x - P.x, n.z - P.z));
      if (o.def.within != null) o.left = Math.max(0, o.def.within - (G.time - o.start));
      if (o.dist <= n.trigger) { voice(G, 'extracted'); return 'done'; }
      if (o.left === 0) return 'failed';
    },
  },
  // Keep things standing: failed the moment fewer than minAlive are left,
  // otherwise held until the mission is won, and done then.
  protect: {
    init: (G, d) => ({ targets: G.entities.filter(e => e.tags.some(t => d.targets.includes(t))) }),
    tick(G, o) {
      o.total = o.targets.length; o.alive = o.targets.filter(e => e.alive).length;
      if (o.alive < (o.def.minAlive ?? o.total)) return 'failed';
    },
  },
  // The clock runs from the mission start; each wave is called in WAVE_WARN
  // seconds before it arrives (waves at the very start just arrive).
  survive: {
    init: (G, d) => ({ start: G.time, waves: (d.waves || []).map(w => ({ ...w, warned: w.at < WAVE_WARN, spawned: false })) }),
    tick(G, o) {
      const t = G.time - o.start;
      for (const w of o.waves) {
        if (!w.warned && t >= w.at - WAVE_WARN) { w.warned = true; voice(G, 'inbound'); }
        if (!w.spawned && t >= w.at) { w.spawned = true; spawnWave(G, waveFoes(G, w.foes), w); }
      }
      o.left = Math.max(0, o.def.seconds - t);
      if (o.left === 0) return 'done';
    },
  },
};
export const OBJECTIVE_TYPES = Object.keys(TYPES);
// A waiting objective starting: its tracking built, as the tick does when the
// one it waits on is done (a co-op guest calls it when the host says so).
export function activate(G, o) { Object.assign(o, TYPES[o.def.type].init(G, o.def)); o.state = 'active'; }
// Where the HUD marker for an objective goes (null: nowhere in particular):
// the nearest standing target (to knock down or to guard), the convoy's lead,
// the extraction point.
export function objectivePoint(G, o) {
  if (o.state !== 'active') return null;
  const P = G.player, near = list => list.reduce((b, e) => (!b || Math.hypot(e.x - P.x, e.z - P.z) < Math.hypot(b.x - P.x, b.z - P.z) ? e : b), null);
  const at = e => e && [e.x, e.y + (e.height || 0) / 2 + 2, e.z];
  if (o.def.type === 'destroy' || o.def.type === 'protect') return at(near(o.targets.filter(e => e.alive)));
  if (o.def.type === 'escort') { const n = o.nav, live = o.vehicles.filter(v => v.alive); return at(live.reduce((b, v) => (!b || Math.hypot(v.x - n.x, v.z - n.z) < Math.hypot(b.x - n.x, b.z - n.z) ? v : b), null)); }
  if (o.def.type === 'extract') return at(o.nav);
  return null;
}
export const CONVOY_WARN_EVERY = 12;

export function initObjectives(G, def) {
  for (const s of def.entities || []) addEntity(G, { ...s, ...polar(s.at), path: s.path?.map(p => { const q = polar(p); return [q.x, q.z]; }) });
  G.objectives = (def.objectives || [{ type: 'eliminate' }]).map(d => (d.after != null ? { def: d, state: 'waiting' } : { def: d, state: 'active', ...TYPES[d.type].init(G, d) }));
  G.waves = (def.waves || []).map(w => ({ ...w, due: w.at ?? null, warned: (w.at ?? Infinity) < WAVE_WARN, spawned: false }));
}

// The mission's own waves (a SURVIVE has its own on its clock):
//   { at: 40, foes, from, dist }                 on the mission clock
//   { when: { obj: 0, done: 2 }, foes, from }    once objective 0's count reaches 2
// A wave is called in WAVE_WARN seconds before it arrives; a triggered one
// arrives WAVE_WARN after its trigger, so the call always comes first.
function tickWaves(G) {
  for (const w of G.waves || []) {
    if (w.spawned) continue;
    if (w.due == null && w.when && (G.objectives[w.when.obj]?.done ?? 0) >= w.when.done) w.due = G.time + WAVE_WARN;
    if (w.due == null) continue;
    if (!w.warned && G.time >= w.due - WAVE_WARN) { w.warned = true; voice(G, 'inbound'); }
    if (G.time >= w.due) { w.spawned = true; spawnWave(G, waveFoes(G, w.foes), w); }
  }
}
// A wave that is coming for certain: timed, or triggered and on its way.
const wavesPending = G => (G.waves || []).some(w => !w.spawned && w.due != null);

// Once a frame while the match is on. Each active objective updates its
// progress and may finish or fail; then the mission's own outcome.
export function tickObjectives(G) {
  if (G.state !== 'play' || G.mode === 'mp' || !G.objectives) return;
  if (!G.player.alive && !coopLives(G)) return;   // solo: the death is the end (combat.js); co-op goes on
  if (allDown(G)) {   // co-op: everyone down at once
    G.state = 'over'; G.endT = 3.2; G.won = false;
    voice(G, 'failed', {}, true, 600);
    return;
  }
  for (const o of G.objectives) {
    if (o.state === 'waiting' && G.objectives[o.def.after]?.state === 'done') { activate(G, o); voice(G, 'updated'); }
    if (o.state !== 'active') continue;
    const r = TYPES[o.def.type].tick(G, o);
    if (r) o.state = r;
  }
  tickWaves(G);
  const main = G.objectives.filter(o => !o.def.secondary), held = o => o.state === 'done' || (o.def.type === 'protect' && o.state === 'active');
  if (main.some(o => o.state === 'failed')) {
    G.state = 'over'; G.endT = 3.2; G.won = false;
    voice(G, 'failed', {}, true, 600);
  } else if (main.every(held)) {
    G.state = 'over'; G.endT = 3.5; G.won = true;
    for (const o of G.objectives) if (o.def.type === 'protect' && o.state === 'active') o.state = 'done';
    voice(G, 'complete', {}, true, 1400);
  }
}
