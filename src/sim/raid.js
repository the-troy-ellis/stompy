import { CHASSIS } from '../data/chassis.js';
import { CONSTRUCT } from '../data/construct.js';
import { crewOf } from './crew.js';
import { msg } from './effects.js';

// Raids and salvage (docs/specs/20-build-and-fight.md § The raid, § Raids go
// for buildings). A raid is a mission wave with `raid: true`: it is called
// with where it comes from and what is in it, and its foes go for the base.
const { hypot, round } = Math;
export const RAID_NEAR = 120;   // m: a crew mech this close gets the raider's attention instead

const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const SIDE = ['north', 'east', 'south', 'west'];
// The call: `Raid west. Two JACKALs.` (`from` a bearing; a ring or a nav
// point is just "Raid inbound.")
export function raidLine(w, foes) {
  const where = typeof w.from === 'number' ? SIDE[((round(w.from / 90) % 4) + 4) % 4] : 'inbound';
  const n = new Map();
  for (const t of foes) n.set(t, (n.get(t) || 0) + 1);
  const what = [...n].map(([t, k]) => `${NUMBER[k] ?? k} ${CHASSIS[t].name}${k > 1 ? 's' : ''}`).join(' and ');
  return `Raid ${where}. ${what[0].toUpperCase()}${what.slice(1)}.`;
}

// What a raider goes for: a crew mech within RAID_NEAR (null: fight it as
// usual), else the nearest standing building, else you (null again).
export function raidTarget(G, e) {
  if (!G.base) return null;
  for (const m of crewOf(G)) if (m.alive && hypot(m.x - e.x, m.z - e.z) < RAID_NEAR) return null;
  let best = null, bestD = Infinity;
  for (const b of [G.base.silo, G.base.factory]) {
    if (!b || !b.alive) continue;
    const d = hypot(b.x - e.x, b.z - e.z);
    if (d < bestD) { best = b; bestD = d; }
  }
  return best;
}

// What a foe's wreck is worth (combat.js makeWreck): only with a base to take it.
export const salvageOf = (G, m) => (G.base && m.team !== 0 ? CONSTRUCT.salvage[m.type] ?? 0 : 0);

// Once a frame: any crew mech walking over a wreck sends its salvage to the
// silo. The wreck stays where it fell.
export function stepSalvage(G) {
  const b = G.base;
  if (!b || !b.silo.alive) return;
  for (const w of G.wrecks) {
    if (!w.salvage) continue;
    for (const m of crewOf(G)) {
      if (!m.alive || hypot(m.x - w.x, m.z - w.z) > CONSTRUCT.pickup * w.scale) continue;
      b.salvage += w.salvage; w.salvage = 0;
      if (m === G.player) { G.fx.say('Salvage in.'); msg(G, 'SALVAGE IN'); }
      break;
    }
  }
}
