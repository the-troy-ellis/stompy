import { PALS } from './palettes.js';
import { NAMES } from './names.js';

// A mission: { key, pal, seed, foes, intel }; its display name comes from
// NAMES.missions[key]. From M3 also (docs/specs/03-objectives.md; the sim
// reads them in state.js and objectives.js):
//   foes        chassis keys, or { type, at: [bearing°, dist], face, aware, profile }
//   objectives  default ELIMINATE; see sim/objectives.js
//   entities    structures, vehicles, turrets and nav points placed `at: [bearing°, dist]`
//               from the start, vehicles with a `path` of the same; `pad: r` flattens under one
//   waves       { at } on the clock or { when: { obj, done } } on progress, with foes and from
//   flat        [[bearing°, dist, radius]] extra pads
//   prefer      'convoy': the enemies go for the trucks
// Bearings: 0 is straight ahead at the start, 90 to the right.
const RELAY = { kind: 'structure', mesh: 'relay', height: 18, radius: 3, tags: ['relay'], label: 'RELAY', pad: 9 };
const TRUCK = { kind: 'vehicle', mesh: 'truck', tags: ['convoy'], label: 'TRUCK', speed: 7 };
const ROUTE = [[200, 120], [100, 200], [40, 520], [15, 850], [350, 1040]];   // ~1.6 km down the valley

export const MISSIONS = [
  // Act I: Redwater, dusk desert.
  { key: 'm01', pal: 'dusk', seed: 7,
    foes: [{ type: 'jackal', at: [20, 600], aware: false }, { type: 'jackal', at: [335, 460], profile: 'brawler' }],
    objectives: [{ type: 'eliminate' }],
    intel: 'Two scouts are napping on the Redwater road, and it would be rude not to wake them.' },
  { key: 'm02', pal: 'dusk', seed: 20,
    foes: [{ type: 'jackal', at: [345, 700] }, { type: 'jackal', at: [30, 480], aware: false }],
    entities: [{ ...RELAY, id: 'relay1', at: [10, 380] }, { ...RELAY, id: 'relay2', at: [310, 620] }, { ...RELAY, id: 'relay3', at: [55, 820] }],
    objectives: [{ type: 'destroy', targets: ['relay'], label: 'RELAY' }, { type: 'eliminate', secondary: true }],
    waves: [{ when: { obj: 0, done: 2 }, foes: ['jackal'], from: 0, dist: 450 }],
    intel: 'Three relay towers are telling everyone where you are, and they all bend at the bottom.' },
  { key: 'm03', pal: 'dusk', seed: 33, prefer: 'convoy',
    foes: [],
    entities: [
      ...[[200, 120], [207, 135], [213, 151], [218, 169]].map((at, i) => ({ ...TRUCK, id: `truck${i + 1}`, at, path: ROUTE })),
      { kind: 'nav', id: 'exit', at: ROUTE[ROUTE.length - 1], mesh: 'pad', radius: 14, pad: 16 },
    ],
    objectives: [{ type: 'escort', convoy: 'convoy', to: 'exit', minAlive: 2, label: 'CONVOY' }],
    waves: [{ at: 30, foes: ['jackal', 'jackal'], from: 90 }, { at: 105, foes: ['jackal'], from: 270 }],
    intel: 'Four little trucks need walking down the valley; bring back at least two.' },
  { key: 'm04', pal: 'dusk', seed: 46,   // dusk into night once M4's time ramp exists
    foes: [{ type: 'warden', at: [0, 720] }, { type: 'jackal', at: [330, 600] }, { type: 'jackal', at: [30, 640] }],
    objectives: [{ type: 'eliminate' }],
    intel: 'Something with four legs is stomping around Redwater, which is two too many.' },
].map(m => ({ ...m, name: NAMES.missions[m.key] }));
export function missionDef(n) {
  if (n < MISSIONS.length) return MISSIONS[n];
  const pals = Object.keys(PALS), k = 3 + Math.floor(n / 2), heavies = Math.floor(n / 3);
  return { name: `Contract ${n + 1}`, pal: pals[n % pals.length],
    foes: Array.from({ length: k }, (_, i) => (i < heavies ? 'warden' : 'jackal')),
    intel: `Open contract. ${k} hostiles reported, ${heavies} of them heavy. Pay is by the kill.` };
}
// Free play: a one-off battle on the chosen map with the chosen number of hostiles.
export const FP_MAPS = ['random', 'dusk', 'ice', 'volcanic'];
// Free Play's MIX: the chassis the hostiles are drawn from, by weight. MIXED
// is the old default. Only chassis the player has unlocked turn up (`open`),
// so the campaign keeps its surprises.
export const FP_MIXES = [
  { key: 'mixed', label: 'MIXED', w: { jackal: 0.65, warden: 0.35 } },
  { key: 'light', label: 'LIGHT', w: { jackal: 1, light1: 1 } },
  { key: 'heavy', label: 'HEAVY', w: { warden: 1, sniper1: 1, puncher: 1 } },
  { key: 'all', label: 'EVERYTHING', w: { kestrel: 1, jackal: 1, warden: 1, light1: 1, sniper1: 1, puncher: 1 } },
];
export function pickFoes(mix, n, rand, open = () => true) {
  const w = Object.entries(mix.w).filter(([k]) => open(k)), total = w.reduce((a, [, v]) => a + v, 0);
  return Array.from({ length: n }, () => {
    let r = rand() * total;
    for (const [k, v] of w) if ((r -= v) < 0) return k;
    return w[w.length - 1][0];
  });
}
