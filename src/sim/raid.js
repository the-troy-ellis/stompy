import { buildingsOf, RAID_KINDS } from './buildings.js';
import { CHASSIS } from '../data/chassis.js';
import { CONSTRUCT } from '../data/construct.js';
import { crewOf } from './crew.js';
import { stealRow } from './steal.js';
import { isDown } from './down.js';
import { msg } from './effects.js';

// Raids and salvage (docs/specs/20-build-and-fight.md § The raid, § Raids go
// for buildings). A raid is a mission wave with `raid: true`: it is called
// with where it comes from and what is in it, and its foes go for the base.
const { hypot, round } = Math;
export const RAID_NEAR = 120;   // m: a crew mech this close gets the raider's attention instead
export const RAID_WALL = 30;   // m: a wall slab across its way this close is shot down first (docs/specs/32-base-loop.md § Raids from above)

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
  // On HARD (stealRow knock) a raid knocks an exposed building down for its
  // thieves and leaves it at that: the exposed ones first, never one down.
  const knock = stealRow(G).knock, list = buildingsOf(G, RAID_KINDS);   // what a raid goes for (sim/buildings.js)
  if (knock) for (const b of list) {
    if (!b?.alive || !b.exposed || isDown(b)) continue;
    const d = hypot(b.x - e.x, b.z - e.z);
    if (d < bestD) { best = b; bestD = d; }
  }
  if (best) return wallInWay(G, e, best) || best;
  for (const b of list) {   // not walls (docs/specs/21-mining.md): raiders go round or through; beacons, so a raid opens the border (spec 33)
    if (!b || !b.alive || (knock && isDown(b))) continue;
    const d = hypot(b.x - e.x, b.z - e.z);
    if (d < bestD) { best = b; bestD = d; }
  }
  return best && (wallInWay(G, e, best) || best);
}

// Walls matter (spec 32 part 2): a wall slab standing across the straight line
// from the raider to its target, within RAID_WALL of the raider, is what it
// shoots, rather than walking a long way round. The nearest such slab.
export function wallInWay(G, e, t) {
  const dx = t.x - e.x, dz = t.z - e.z, L = hypot(dx, dz);
  if (L < 1) return null;
  const ux = dx / L, uz = dz / L, reach = Math.min(RAID_WALL, L);
  let best = null, bestT = Infinity;
  for (const w of G.base.walls || []) {
    if (!w.alive || isDown(w)) continue;
    const ax = w.x - e.x, az = w.z - e.z, along = ax * ux + az * uz;
    if (along < 0 || along > reach || along >= bestT) continue;
    if (Math.abs(ax * uz - az * ux) > w.radius + 1.5) continue;   // off to the side of the line
    best = w; bestT = along;
  }
  return best;
}

// What a foe's wreck is worth (combat.js makeWreck): only with a base to take it.
export const salvageOf = (G, m) => (G.base && m.team !== 0 ? CONSTRUCT.salvage[m.type] ?? 0 : 0);

// Once a frame: any crew mech walking over a wreck sends its salvage to the
// silo. The wreck stays where it fell.
export function stepSalvage(G) {
  const b = G.base;
  if (!b || !b.silos.some(e => e.alive)) return;
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
