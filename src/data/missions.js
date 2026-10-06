import { NAMES } from './names.js';
import { makeRng } from '../sim/rng.js';

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
//   start       [bearing°, dist, face°]: the player starts there, not at the centre
//   weather, time  for M4's atmosphere (docs/specs/07-atmosphere.md); the
//               plain palette until it lands
// Bearings: 0 is straight ahead at the start, 90 to the right.
const RELAY = { kind: 'structure', mesh: 'relay', height: 18, radius: 3, tags: ['relay'], label: 'RELAY', pad: 9 };
const TRUCK = { kind: 'vehicle', mesh: 'truck', tags: ['convoy'], label: 'TRUCK', speed: 7 };
const ROUTE = [[200, 120], [100, 200], [40, 520], [15, 850], [350, 1040]];   // ~1.6 km down the valley
const TANK = { kind: 'structure', mesh: 'tank', height: 7, radius: 5, tags: ['tank'], label: 'TANK', pad: 11 };
const PAD = { kind: 'nav', mesh: 'pad', radius: 14, pad: 16 };
const LAUNCHER = { kind: 'turret', mesh: 'launcher', height: 6, radius: 4, tags: ['battery'], label: 'LAUNCHER', pad: 10 };
const PROP_TANK = { kind: 'structure', mesh: 'tank', height: 7, radius: 5, hp: Infinity, pad: 11 };   // the refinery's: scenery
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
  // Act III: the volcanic plain. Structures that shoot back at 9, PURPLE
  // PUNCHER makes an entrance at 10 and unlocks after 11.
  { key: 'm09', pal: 'volcanic', seed: 111,
    foes: [{ type: 'warden', at: [5, 720] }, { type: 'warden', at: [335, 780], aware: false }, { type: 'jackal', at: [30, 480] }, { type: 'jackal', at: [320, 520], aware: false }],
    entities: [
      { ...LAUNCHER, id: 'launcher1', at: [350, 590] }, { ...LAUNCHER, id: 'launcher2', at: [5, 640] }, { ...LAUNCHER, id: 'launcher3', at: [20, 570] },
      { ...PROP_TANK, id: 'refinery1', at: [0, 700] }, { ...PROP_TANK, id: 'refinery2', at: [12, 720] },
    ],
    objectives: [{ type: 'destroy', targets: ['battery'], label: 'LAUNCHER' }, { type: 'eliminate' }],
    intel: 'Three launchers sit by the refinery. They shoot back. Knock them over.' },
  { key: 'm10', pal: 'volcanic', seed: 124, weather: 'dust',
    foes: [],
    entities: [{ kind: 'nav', id: 'ridge', at: [40, 300] }, { ...TANK, id: 'store1', at: [0, 70], tags: ['store'] }, { ...TANK, id: 'store2', at: [120, 75], tags: ['store'] }, { ...TANK, id: 'store3', at: [240, 70], tags: ['store'] }],
    objectives: [
      { type: 'survive', seconds: 180, waves: [
        { at: 0, foes: ['jackal', 'jackal'], from: 0 },
        { at: 40, foes: ['jackal', 'light1'], from: 120 },
        { at: 80, foes: ['warden', 'jackal', 'jackal'], from: 240 },
        { at: 120, foes: ['puncher'], from: 'ridge', reveal: 8 },   // the set piece: it walks in off the ridge, and you feel it first
        { at: 150, foes: ['light1', 'light1'], from: 180 },
      ] },
      { type: 'protect', targets: ['store'], minAlive: 2, label: 'TANK', secondary: true },
    ],
    intel: 'Hold the refinery for three minutes. Keep the tanks in one piece.' },
  { key: 'm11', pal: 'volcanic', seed: 137, start: [225, 1100, 45],   // corner to corner: ~2.2 km
    foes: [
      { type: 'jackal', at: [225, 620], aware: false }, { type: 'jackal', at: [180, 90], aware: false }, { type: 'jackal', at: [45, 560], aware: false },
      { type: 'puncher', at: [80, 220], aware: false }, { type: 'sniper1', at: [110, 520], aware: false }, { type: 'sniper1', at: [350, 420], aware: false },
    ],
    entities: [{ ...PAD, id: 'lz', at: [45, 1100] }],
    objectives: [{ type: 'extract', at: 'lz', within: 240 }, { type: 'eliminate', secondary: true }],
    intel: 'The canyon is long. The clock is short. Run to the end.' },
  { key: 'm12', pal: 'volcanic', seed: 150, time: 'night',   // lightning with M4's weather
    foes: [{ type: 'puncher', at: [355, 650] }, { type: 'puncher', at: [30, 720] }, { type: 'warden', at: [330, 600] }, { type: 'warden', at: [20, 560] }, { type: 'light1', at: [300, 440] }, { type: 'light1', at: [60, 420] }],
    objectives: [{ type: 'eliminate' }],
    intel: 'Everyone is here. Big ones, little ones, purple ones. Stomp them all.' },
].map(m => ({ ...m, name: NAMES.missions[m.key] }));
// Every hostile a mission brings: placed, in its waves, and on a SURVIVE's clock.
export const missionFoes = d => [...d.foes, ...(d.waves || []).flatMap(w => w.foes), ...(d.objectives || []).flatMap(o => (o.waves || []).flatMap(w => w.foes))];
// Board-book numbers (docs/vision.md § Tone guide): words, not digits.
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const count = n => WORDS[n] || 'Lots of';
export function missionDef(n) {
  return n < MISSIONS.length ? MISSIONS[n] : contractDef(n);
}

// After twelve: contracts (spec 04 § After twelve). Contract n (0-based, so
// Contract 13 is n = 12) is fixed by n alone: the biome by n % 3, weather and
// time by a roll seeded from n, the objective by n % 5. The count of mechs and
// of big ones grows as it always has; who they are comes from the whole
// roster, lighter mechs more often.
export const CONTRACT_OBJECTIVES = ['eliminate', 'destroy', 'survive', 'extract', 'escort'];
const BIOMES = ['dusk', 'ice', 'volcanic'];
const SKIES = { dusk: ['rain', 'dust'], ice: ['snow', 'fog'], volcanic: ['dust', 'fog'] };   // spec 07's weather per biome
const LIGHT = { jackal: 3, light1: 3, kestrel: 2 }, BIG = { warden: 2, sniper1: 1.5, puncher: 1 };
const RELAY_AT = [[0, 0], [100, 60], [-100, 60]];   // a triangle of targets, turned and pushed out by the roll
function weighted(rng, w) {
  let r = rng.next() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) if ((r -= v) < 0) return k;
  return Object.keys(w)[0];
}
export function contractDef(n) {
  const rng = makeRng(9001 + n * 7919), pal = BIOMES[n % 3], type = CONTRACT_OBJECTIVES[n % 5];
  const k = 3 + Math.floor(n / 2), heavies = Math.min(k, Math.floor(n / 3));
  const foes = Array.from({ length: k }, (_, i) => weighted(rng, i < heavies ? BIG : LIGHT));
  const sky = rng.next(), time = rng.chance(0.3) ? 'night' : null, turn = rng.range(0, 360);
  const def = { name: `Contract ${n + 1}`, pal, seed: 1000 + n, foes, objectives: [{ type: 'eliminate' }] };
  if (sky < 0.4) def.weather = SKIES[pal][sky < 0.2 ? 0 : 1];
  if (time) def.time = time;
  const many = `${count(k)} mechs are out there.`, big = heavies ? `${count(heavies)} of them ${heavies > 1 ? 'are' : 'is'} big.` : 'None of them are big.';
  if (type === 'eliminate') def.intel = `${many} ${big} Go and stomp them.`;
  if (type === 'destroy') {
    const d = rng.range(420, 620);
    def.entities = RELAY_AT.map(([x, z], i) => ({ ...RELAY, id: `relay${i + 1}`, at: [turn + Math.atan2(x, d + z) * 180 / Math.PI, Math.hypot(x, d + z)] }));
    def.objectives = [{ type: 'destroy', targets: ['relay'], label: 'RELAY' }, { type: 'eliminate', secondary: true }];
    def.intel = `Three tall towers talk and talk. Knock them down. ${many}`;
  }
  if (type === 'survive') {
    const third = Math.ceil(k / 3);
    def.objectives = [{ type: 'survive', seconds: 150, waves: [0, 1, 2].map(w => ({ at: w * 50, foes: foes.slice(w * third, (w + 1) * third), from: turn + w * 120 })).filter(w => w.foes.length) }];
    def.foes = [];
    def.intel = `${count(k)} mechs are coming. Stay alive for two and a half minutes.`;
  }
  if (type === 'extract') {
    def.entities = [{ ...PAD, id: 'lz', at: [turn, 950] }];
    def.objectives = [{ type: 'extract', at: 'lz', within: 240 }, { type: 'eliminate', secondary: true }];
    def.intel = `Run to the pad. ${many} ${big}`;
  }
  if (type === 'escort') {
    const route = ROUTE.map(([b, d]) => [b + turn, d]);
    def.prefer = 'convoy';
    def.entities = [
      ...[0, 1, 2, 3].map(i => ({ ...TRUCK, id: `truck${i + 1}`, at: [route[0][0] + i * 6, route[0][1] + i * 16], path: route })),
      { ...PAD, id: 'exit', at: route[route.length - 1] },
    ];
    def.objectives = [{ type: 'escort', convoy: 'convoy', to: 'exit', minAlive: 2, label: 'CONVOY' }];
    def.intel = `Four little trucks drive far. Keep two trucks safe. ${many}`;
  }
  return def;
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
