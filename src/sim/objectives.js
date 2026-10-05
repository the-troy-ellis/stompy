import { addEntity } from './entities.js';
import { voice } from './voice.js';
import { polar } from './placement.js';
import { spawnWave, waveFoes, WAVE_WARN } from './waves.js';
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
// ESCORT and EXTRACT arrive in #101-#102.

const TYPES = {
  eliminate: {
    init: () => ({}),
    tick(G, o) {
      const foes = G.mechs.filter(m => m.team !== 0 && !m.remote);
      o.left = foes.filter(m => m.alive).length; o.total = foes.length;
      if (o.left === 0) return 'done';
    },
  },
  destroy: {
    init: (G, d) => ({ targets: G.entities.filter(e => e.tags.some(t => d.targets.includes(t))) }),
    tick(G, o) {
      o.total = o.targets.length; o.done = o.targets.filter(e => !e.alive).length;
      if (o.total && o.done === o.total) return 'done';
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

export function initObjectives(G, def) {
  for (const s of def.entities || []) addEntity(G, { ...s, ...polar(s.at) });
  G.objectives = (def.objectives || [{ type: 'eliminate' }]).map(d => ({ def: d, state: 'active', ...TYPES[d.type].init(G, d) }));
}

// Once a frame while the match is on. Each active objective updates its
// progress and may finish or fail; then the mission's own outcome.
export function tickObjectives(G) {
  if (G.state !== 'play' || G.mode === 'mp' || !G.objectives || !G.player.alive) return;
  for (const o of G.objectives) {
    if (o.state !== 'active') continue;
    const r = TYPES[o.def.type].tick(G, o);
    if (r) o.state = r;
  }
  const main = G.objectives.filter(o => !o.def.secondary);
  if (main.some(o => o.state === 'failed')) {
    G.state = 'over'; G.endT = 3.2; G.won = false;
    voice(G, 'failed', {}, true, 600);
  } else if (main.every(o => o.state === 'done')) {
    G.state = 'over'; G.endT = 3.5; G.won = true;
    voice(G, 'complete', {}, true, 1400);
  }
}
