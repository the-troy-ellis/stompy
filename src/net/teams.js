import { TAU } from '../util/math.js';
import { BOUND } from '../world/terrain.js';
import { MP_COLORS } from '../data/colors.js';

const { sin, cos, min, hypot } = Math;

// Team deathmatch (docs/specs/08-lan-polish.md § Modes): two teams, each in
// its forced colour (server/server.py TEAM_COLORS keeps the same pair), and
// each spawning on its own half of the map.
export const TEAM_COLORS = [0, 1];   // MP_COLORS: STEEL, RED
export const teamName = t => MP_COLORS[TEAM_COLORS[t]]?.name || '';
export const teamCss = t => MP_COLORS[TEAM_COLORS[t]]?.css || '#9f9';
// The half a team spawns on: STEEL to the south (z < 0), RED to the north;
// 0 (free-for-all) anywhere.
export const sideOf = (mode, team) => (mode === 'tdm' ? (team ? 1 : -1) : 0);

// Somewhere on the map, as far as possible from every hostile alive (a
// teammate is team 0, like the player, and doesn't count). With a side, only
// on that half: angles within SIDE_ARC of its axis keep the point clear of
// the middle line.
const SIDE_ARC = 1.2;
export function spawnPoint(G, side = 0, rand = Math.random) {
  const rnd = (a, b) => a + rand() * (b - a);
  let best = [0, 0], bestD = -1;
  for (let k = 0; k < 20; k++) {
    const a = side ? rnd(-SIDE_ARC, SIDE_ARC) : rand() * TAU, d = rnd(80, BOUND - 80);
    const x = sin(a) * d, z = (side ? side * cos(a) : cos(a)) * d;
    let near = 1e9;
    for (const m of G.mechs) if (m.alive && m !== G.player && m.team !== 0) near = min(near, hypot(m.x - x, m.z - z));
    if (near > bestD) { bestD = near; best = [x, z]; }
  }
  return best;
}
