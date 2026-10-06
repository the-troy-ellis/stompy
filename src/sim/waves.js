import { newMech } from './state.js';
import { polar } from './placement.js';
import { BOUND } from '../world/terrain.js';

const { atan2, sin, cos, max, min, PI } = Math;

// Waves (docs/specs/03-objectives.md § Waves): reinforcements that walk on
// awake and already looking for you. A voice line calls each one WAVE_WARN
// seconds ahead. Difficulty changes a wave's size by one mech, never anyone's HP.
export const WAVE_WARN = 3;
export const WAVE_DIST = 520;   // m from the player for a ring or bearing entry

export function waveFoes(G, foes) {
  if (G.diff === 'easy' && foes.length > 1) return foes.slice(0, -1);
  if (G.diff === 'hard') return [...foes, foes[foes.length - 1]];
  return [...foes];
}

// `from`: 'ring' (spread round the player, the start's maths), a bearing in
// degrees from the start (a flank), or a nav point's id (they walk in from
// there). `reveal: s` makes an entrance (mission 10's PURPLE PUNCHER): for
// its first s seconds it walks straight in without firing, and its steps are
// heard and felt at any distance (ai.js, gait.js). Returns the new mechs.
export const revealing = (G, m) => (m.ai?.revealUntil ?? 0) > G.time;
export function spawnWave(G, foes, { from = 'ring', dist = WAVE_DIST, reveal = 0 } = {}) {
  const rng = G.rng, P = G.player, nav = typeof from === 'string' && from !== 'ring' ? G.entities.find(e => e.id === from) : null;
  return foes.map((t, i) => {
    let x, z;
    if (nav) { const a = rng.range(0, 2 * PI), r = rng.range(8, 30); x = nav.x + sin(a) * r; z = nav.z + cos(a) * r; }
    else if (typeof from === 'number') { const p = polar([from + rng.range(-20, 20), dist]); x = P.x + p.x; z = P.z + p.z; }
    else { const a = (i / foes.length) * 2 * PI + rng.range(-0.4, 0.4); x = P.x + sin(a) * dist; z = P.z + cos(a) * dist; }
    x = max(-BOUND, min(BOUND, x)); z = max(-BOUND, min(BOUND, z));
    const m = newMech(G, t, 1, x, z, atan2(P.x - x, P.z - z));
    m.ai.aware = true;
    if (reveal) m.ai.revealUntil = G.time + reveal;
    G.mechs.push(m);
    return m;
  });
}
