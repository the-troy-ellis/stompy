import { WEAPONS } from '../data/weapons.js';
import { CHASSIS } from '../data/chassis.js';
import { PALS } from '../data/palettes.js';
import { makeTerrain, BOUND } from '../world/terrain.js';
import { makeRng } from './rng.js';
import { nullFx } from './fx.js';
import { add, mul, dirOf, TAU } from '../util/math.js';
import { initFeet } from './gait.js';
import { eyeOf } from './geom.js';
import { initFeel } from './feel.js';

const { sin, cos, atan2 } = Math;

// The whole game state in one plain object. The sim mutates it; the renderer,
// HUD and network read it. `fx` is the effects sink (see fx.js) and `rng` the
// seeded randomness every gameplay decision draws from.
export function createGame({ fx = nullFx, touchUI = false, seed = 1 } = {}) {
  return {
    state: 'brief', paused: false, mode: 'sp', kind: 'free', worldKind: null,
    mechs: [], shots: [], beams: [], cbeams: [], parts: [], debris: [], wrecks: [], msgs: [], pulses: [], pendingHits: new Map(),
    eye: [0, 0, 0], view: [0, 0, 1], aim: [0, 0, 100], aimMech: null, lock: false, VP: null,
    flash: 0, shake: 0, kick: 0, whiteFlash: 0, lastTwist: 0, hitMark: 0,
    touchUI, touchTurn: 0, zoom: false, target: null, endT: 0, time: 0, frame: 0, clock: 0,
    player: null, def: null, stats: null, guide: null, mDown: false, won: false, roundOver: false,
    ter: null, pal: null, rng: makeRng(seed), fx,
    input: null,   // the last input snapshot, for the HUD
    volleySeq: 0, lastVolley: 0, respawnAt: 0, killer: 0,
    hooks: {},     // optional callbacks the net client installs (arenaDeath)
  };
}

export function newMech(G, type, team, x, z, yaw, opts = {}) {
  const ch = CHASSIS[type], rng = G.rng;
  const m = {
    type, ch, team, partsKey: opts.partsKey || type, netId: 0, remote: false, spawnT: 0, x, z, y: G.ter.height(x, z), vy: 0, yaw, twist: 0, pitch: 0, speed: 0, throttle: 0, heat: 0,
    fuel: 1, jetting: false, air: false, shutdown: false, alive: true,
    hp: { ...ch.hp }, max: { ...ch.hp },
    weapons: ch.weapons.map(([w, mount], i) => ({ type: w, def: WEAPONS[w], mount, cd: rng.next() * 0.5, ammo: WEAPONS[w].ammo || null, dead: false, side: i })),
    ai: { aware: false, strafe: rng.sign(), strafeT: rng.range(2, 5), jitter: rng.range(0.2, 0.8), wp: null },
  };
  initFeet(G, m);
  initFeel(m);
  return m;
}

// Reset per-match state and build the world. `terrainOpts` is for tests (flat).
export function resetMatch(G, { def, seed, pal, terrainOpts }) {
  G.rng = makeRng(seed);
  G.pal = PALS[pal || def.pal] || PALS.dusk;
  G.ter = makeTerrain(seed, terrainOpts);
  G.worldKind = 'match';
  G.mechs = []; G.shots = []; G.beams = []; G.cbeams = []; G.parts = []; G.debris = []; G.wrecks = []; G.msgs = []; G.pulses = []; G.pendingHits.clear();
  G.target = null; G.aimMech = null; G.flash = 0; G.shake = 0; G.kick = 0; G.whiteFlash = 0; G.zoom = false; G.endT = 0; G.time = 0; G.frame = 0;
  G.guide = null; G.mDown = false; G.won = false; G.roundOver = false; G.hitMark = 0; G.voice = null;
  G.stats = { shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0 };
  G.def = def;
}

// A single-player match: the player at the origin, the foes on a ring.
export function startMatch(G, def, seed, gentle, chassis, { partsKey, terrainOpts } = {}) {
  resetMatch(G, { def, seed, terrainOpts });
  G.player = newMech(G, chassis, 0, 0, 0, 0, { partsKey });
  G.mechs.push(G.player);
  G.eye = eyeOf(G.player); G.view = dirOf(0, 0); G.aim = add(G.eye, mul(G.view, 100));
  const rng = G.rng;
  def.foes.forEach((t, i) => {
    const a = (i / def.foes.length) * TAU + rng.range(-0.4, 0.4) + Math.PI * 0.6, d = rng.range(520, 760);
    const x = Math.max(-BOUND, Math.min(BOUND, sin(a) * d)), z = Math.max(-BOUND, Math.min(BOUND, cos(a) * d));
    const e = newMech(G, t, 1, x, z, atan2(-x, -z) + rng.range(-1, 1));
    e.ai.aware = i === 0 && gentle ? false : rng.chance(0.3);
    G.mechs.push(e);
  });
  G.state = 'play'; G.paused = false;
}
