import { polar } from '../sim/placement.js';

// The DEBUG tab's test range (docs/specs/19-debug-menu.md § Test range): flat
// ground, you at the centre facing north (bearing 0), the picked landmark
// straight ahead, and the foes on an arc in front, off to the sides of it.
// Positions are polar [bearing°, dist] like a mission's; strokes are world
// [op, x, y, z, r] (world/voxels.js).

// A slab on a pillar, built from editor strokes (op 1, build): the torque
// test's shape. A 24 m pillar 44 m tall, a 64 m slab on top.
function pillar(at) {
  const c = polar(at), s = [];
  for (let y = 4; y <= 40; y += 6) for (const dx of [-6, 0, 6]) for (const dz of [-6, 0, 6]) s.push([1, c.x + dx, y, c.z + dz, 7]);
  for (let x = -28; x <= 28; x += 8) for (let z = -28; z <= 28; z += 8) s.push([1, c.x + x, 44, c.z + z, 7]);
  return s;
}
// A mesa with a tunnel straight through it, along the line from you.
const tunnel = (b, d) => [{ kind: 'mesa', at: [b, d] }, { kind: 'tunnel', from: [b, d - 130, 12], to: [b, d + 130, 12], r: 12 }];
// A cave into a low mesa, its mouth toward you (a cave's mouth looks along
// `face`). The mouth stands just clear of the mesa's lip, on the flat, so the
// cave runs in at the ground's level.
const cave = (b, d) => [{ kind: 'mesa', at: [b, d + 90], r: 60, top: 50 }, { kind: 'cave', at: [b, d], face: 180 + b, depth: 90 }];

export const RANGE_GROUNDS = [
  { key: 'flat', label: 'FLAT', ground: {} },
  { key: 'arch', label: 'ARCH', ground: { landmarks: [{ kind: 'arch', at: [0, 220] }] } },
  { key: 'mesa', label: 'MESA', ground: { landmarks: [{ kind: 'mesa', at: [0, 260] }] } },
  { key: 'tunnel', label: 'TUNNEL', ground: { landmarks: tunnel(0, 260) } },
  { key: 'cave', label: 'CAVE', ground: { landmarks: cave(0, 200) } },
  { key: 'pillar', label: 'PILLAR', ground: { strokes: pillar([0, 180]) } },
  // Each of them on a ring 300 m out, the arch ahead.
  { key: 'all', label: 'ALL OF THEM', ground: { landmarks: [{ kind: 'arch', at: [0, 300], face: 0 }, { kind: 'mesa', at: [72, 300] }, ...tunnel(144, 300), ...cave(216, 300)], strokes: pillar([288, 300]) } },
];
export const RANGE_FOES = [['none', 'NONE'], ['still', 'STANDING STILL'], ['awake', 'AWAKE']];
export const RANGE_MAX = 8, RANGE_ARC = 200;

// Where foe i of n stands: on the arc, alternately left and right of the
// landmark, never within 30° of straight ahead.
export const rangeSpot = i => [(i % 2 ? -1 : 1) * (35 + 12 * (i >> 1)), RANGE_ARC];

// The match def for a range: the picked ground, `foes` (chassis keys, already
// picked), STANDING STILL or AWAKE, and Free Play's weather and time.
export function rangeDef({ ground = 'flat', foes = [], mode = 'none', weather = 'clear', time = 'day' } = {}) {
  const g = RANGE_GROUNDS.find(r => r.key === ground) || RANGE_GROUNDS[0];
  return {
    name: 'Range', pal: 'dusk', intel: '', weather, time,
    ground: g.ground,
    objectives: [],   // nothing to win: the range stays open (sim/objectives.js)
    foes: mode === 'none' ? [] : foes.map((type, i) => ({ type, at: rangeSpot(i), aware: mode === 'awake', still: mode === 'still' })),
  };
}
