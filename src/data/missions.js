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
//   weather, time  for M4's atmosphere (docs/specs/07-atmosphere.md); the
//               plain palette until it lands
// Bearings: 0 is straight ahead at the start, 90 to the right.
const RELAY = { kind: 'structure', mesh: 'relay', height: 18, radius: 3, tags: ['relay'], label: 'RELAY', pad: 9 };
const TRUCK = { kind: 'vehicle', mesh: 'truck', tags: ['convoy'], label: 'TRUCK', speed: 7 };
const ROUTE = [[200, 120], [100, 200], [40, 520], [15, 850], [350, 1040]];   // ~1.6 km down the valley
const TANK = { kind: 'structure', mesh: 'tank', height: 7, radius: 5, tags: ['tank'], label: 'TANK', pad: 11 };
const PAD = { kind: 'nav', mesh: 'pad', radius: 14, pad: 16 };
const ICE_ROUTE = [[160, 110], [120, 260], [70, 520], [30, 800], [10, 1030]];   // ~1.4 km across the glacier

export const MISSIONS = [
  // Act I: Redwater, dusk desert.
  { key: 'm01', pal: 'dusk', seed: 7,
    foes: [{ type: 'jackal', at: [20, 600], aware: false }, { type: 'jackal', at: [335, 460], profile: 'brawler' }],
    objectives: [{ type: 'eliminate' }],
    intel: 'Two scouts sleep by the road. Wake them up. Knock them down.' },
  { key: 'm02', pal: 'dusk', seed: 20,
    foes: [{ type: 'jackal', at: [345, 700] }, { type: 'jackal', at: [30, 480], aware: false }],
    entities: [{ ...RELAY, id: 'relay1', at: [10, 380] }, { ...RELAY, id: 'relay2', at: [310, 620] }, { ...RELAY, id: 'relay3', at: [55, 820] }],
    objectives: [{ type: 'destroy', targets: ['relay'], label: 'RELAY' }, { type: 'eliminate', secondary: true }],
    waves: [{ when: { obj: 0, done: 2 }, foes: ['jackal'], from: 0, dist: 450 }],
    intel: 'Three tall towers talk and talk. Knock them down. Someone will come.' },
  { key: 'm03', pal: 'dusk', seed: 33, prefer: 'convoy',
    foes: [],
    entities: [
      ...[[200, 120], [207, 135], [213, 151], [218, 169]].map((at, i) => ({ ...TRUCK, id: `truck${i + 1}`, at, path: ROUTE })),
      { kind: 'nav', id: 'exit', at: ROUTE[ROUTE.length - 1], mesh: 'pad', radius: 14, pad: 16 },
    ],
    objectives: [{ type: 'escort', convoy: 'convoy', to: 'exit', minAlive: 2, label: 'CONVOY' }],
    waves: [{ at: 30, foes: ['jackal', 'jackal'], from: 90 }, { at: 105, foes: ['jackal'], from: 270 }],
    intel: 'Four little trucks drive down the valley. JACKALs come to catch them. Keep two trucks safe.' },
  { key: 'm04', pal: 'dusk', seed: 46,   // dusk into night once M4's time ramp exists
    foes: [{ type: 'warden', at: [0, 720] }, { type: 'jackal', at: [330, 600] }, { type: 'jackal', at: [30, 640] }],
    objectives: [{ type: 'eliminate' }],
    intel: 'One big mech walks on four legs. Two little mechs walk with it. Stomp all three.' },
  // Act II: the glacier. A PIPSQUEAK drops in at 5 and unlocks after 6; the
  // BEANPOLEs are 7, and unlock after 8.
  { key: 'm05', pal: 'ice', seed: 59, weather: 'fog',
    foes: [],
    objectives: [{ type: 'survive', seconds: 150, waves: [
      { at: 0, foes: ['jackal', 'jackal'], from: 0 },
      { at: 50, foes: ['jackal', 'jackal', 'light1'], from: 300 },
      { at: 100, foes: ['warden'], from: 30 },
    ] }],
    intel: 'Fog rolls over the ridge. Mechs walk out of it. Stay on the ridge.' },
  { key: 'm06', pal: 'ice', seed: 72,
    foes: [{ type: 'warden', at: [0, 680] }, { type: 'light1', at: [25, 470] }, { type: 'light1', at: [330, 520], aware: false }, { type: 'jackal', at: [300, 640] }],
    entities: [{ ...TANK, id: 'tank1', at: [12, 430] }, { ...TANK, id: 'tank2', at: [340, 560] }, { ...PAD, id: 'lz', at: [170, 650] }],
    objectives: [{ type: 'destroy', targets: ['tank'], label: 'TANK' }, { type: 'extract', at: 'lz', within: 180, after: 0 }],
    intel: 'Two fuel tanks sit in the snow. Pop them. Then run to the pad.' },
  { key: 'm07', pal: 'ice', seed: 85, weather: 'snow',
    foes: [{ type: 'sniper1', at: [350, 820], face: 180 }, { type: 'sniper1', at: [15, 780], face: 180 }, { type: 'jackal', at: [300, 480] }, { type: 'jackal', at: [55, 430], aware: false }],
    objectives: [{ type: 'eliminate' }],
    intel: 'Two tall mechs stand on the far slope. Their guns are long. Get close.' },
  { key: 'm08', pal: 'ice', seed: 98, time: 'night', prefer: 'convoy',
    foes: [{ type: 'warden', at: [35, 620], aware: true }, { type: 'warden', at: [0, 920], aware: true }, { type: 'sniper1', at: [60, 820], aware: false }, { type: 'sniper1', at: [5, 700], aware: false }],
    entities: [
      ...[[160, 110], [166, 126], [171, 143]].map((at, i) => ({ ...TRUCK, id: `truck${i + 1}`, at, path: ICE_ROUTE })),
      { ...PAD, id: 'exit', at: ICE_ROUTE[ICE_ROUTE.length - 1] },
    ],
    objectives: [{ type: 'escort', convoy: 'convoy', to: 'exit', minAlive: 2, label: 'CONVOY' }],
    waves: [{ at: 40, foes: ['jackal', 'jackal'], from: 270 }, { at: 120, foes: ['jackal', 'jackal'], from: 90 }],
    intel: 'Three trucks cross the ice at night. Their lights are on. Get them across.' },
].map(m => ({ ...m, name: NAMES.missions[m.key] }));
// Every hostile a mission brings: placed, in its waves, and on a SURVIVE's clock.
export const missionFoes = d => [...d.foes, ...(d.waves || []).flatMap(w => w.foes), ...(d.objectives || []).flatMap(o => (o.waves || []).flatMap(w => w.foes))];
// Board-book numbers (docs/vision.md § Tone guide): words, not digits.
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const count = n => WORDS[n] || 'Lots of';
export function missionDef(n) {
  if (n < MISSIONS.length) return MISSIONS[n];
  const pals = Object.keys(PALS), k = 3 + Math.floor(n / 2), heavies = Math.floor(n / 3);
  return { name: `Contract ${n + 1}`, pal: pals[n % pals.length],
    foes: Array.from({ length: k }, (_, i) => (i < heavies ? 'warden' : 'jackal')),
    intel: `${count(k)} mechs are out there. ${heavies ? `${count(heavies)} of them ${heavies > 1 ? 'are' : 'is'} big.` : 'None of them are big.'} Go and stomp them.` };
}
// Free play: a one-off battle on the chosen map with the chosen number of hostiles.
export const FP_MAPS = ['random', 'dusk', 'ice', 'volcanic'];
// Free Play's MIX: the chassis the hostiles are drawn from, by weight. MIXED
// is the old default. Only chassis the player has unlocked turn up (`open`),
// so the campaign keeps its surprises.
export const FP_MIXES = [
  { key: 'mixed', label: 'MIXED', w: { jackal: 0.65, warden: 0.35 } },
  { key: 'light', label: 'LIGHT', w: { jackal: 1, light1: 1 } },
  { key: 'heavy', label: 'HEAVY', w: { warden: 1, sniper1: 1, puncher: 1 }, fallback: 'kestrel' },   // before any heavy is unlocked: the heaviest of the starting pair
  { key: 'all', label: 'EVERYTHING', w: { kestrel: 1, jackal: 1, warden: 1, light1: 1, sniper1: 1, puncher: 1 } },
];
export function pickFoes(mix, n, rand, open = () => true) {
  const w = Object.entries(mix.w).filter(([k]) => open(k)), total = w.reduce((a, [, v]) => a + v, 0);
  if (!w.length) return Array.from({ length: n }, () => mix.fallback || 'jackal');   // nothing in the mix is open yet
  return Array.from({ length: n }, () => {
    let r = rand() * total;
    for (const [k, v] of w) if ((r -= v) < 0) return k;
    return w[w.length - 1][0];
  });
}
