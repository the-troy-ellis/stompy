import { CHASSIS } from '../data/chassis.js';
import { palAt } from '../data/palettes.js';
import { makeWeather } from '../data/weather.js';
import { makeTerrain, BOUND } from '../world/terrain.js';
import { makeRng } from './rng.js';
import { Particles } from './particles.js';
import { nullFx } from './fx.js';
import { add, mul, dirOf, TAU } from '../util/math.js';
import { initFeet } from './gait.js';
import { eyeOf } from './geom.js';
import { initFeel } from './feel.js';
import { flatZones, initObjectives } from './objectives.js';
import { polar } from './placement.js';
import { PROFILES } from './ai/profiles.js';
import { applyLoadout, stockLoadout } from './loadout.js';

const { sin, cos, atan2 } = Math;

// The whole game state in one plain object. The sim mutates it; the renderer,
// HUD and network read it. `fx` is the effects sink (see fx.js) and `rng` the
// seeded randomness every gameplay decision draws from.
export function createGame({ fx = nullFx, touchUI = false, seed = 1 } = {}) {
  return {
    state: 'brief', paused: false, mode: 'sp', kind: 'free', worldKind: null,
    mechs: [], entities: [], shots: [], beams: [], cbeams: [], parts: new Particles(), debris: [], wrecks: [], msgs: [], pulses: [], pendingHits: new Map(),
    eye: [0, 0, 0], view: [0, 0, 1], aim: [0, 0, 100], aimMech: null, lock: false, VP: null,
    flash: 0, shake: 0, kick: 0, whiteFlash: 0, lastTwist: 0, hitMark: 0,
    touchUI, touchTwist: 0, zoom: false, target: null, endT: 0, time: 0, frame: 0, clock: 0,
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
    hp: null, max: null, weapons: null, ai: null, lights: true,   // headlights: on unless switched off (they only show at night)
  };
  applyLoadout(G, m, opts.loadout || stockLoadout(ch));   // weapons, armour, sink, speed, jets; draws the cooldown stagger first, as always
  m.ai = { aware: false, strafe: rng.sign(), strafeT: rng.range(2, 5), jitter: rng.range(0.2, 0.8), wp: null };
  initFeet(G, m);
  initFeel(m);
  return m;
}

// Reset per-match state and build the world. `terrainOpts` is for tests (flat).
export function resetMatch(G, { def, seed, pal, terrainOpts }) {
  G.rng = makeRng(seed);
  // The biome's palette at the mission's time of day; `ramp: [from, to, s]`
  // blends one into the other over s seconds (tickTime in update.js).
  const biome = pal || def.pal, r = def.ramp;
  G.pal = palAt(biome, r ? r[0] : def.time);
  G.palRamp = r ? { from: palAt(biome, r[0]), to: palAt(biome, r[1]), secs: r[2] } : null;
  G.weather = makeWeather(def.weather, seed);   // fog, radar and wind (data/weather.js)
  G.ter = makeTerrain(seed, { ...terrainOpts, zones: flatZones(def) });
  G.worldKind = 'match';
  G.mechs = []; G.entities = []; G.waves = []; G.shots = []; G.beams = []; G.cbeams = []; G.parts.clear(); G.debris = []; G.wrecks = []; G.msgs = []; G.pulses = []; G.pendingHits.clear();
  G.target = null; G.aimMech = null; G.flash = 0; G.shake = 0; G.kick = 0; G.bob = null; G.bobIn = null; G.whiteFlash = 0; G.zoom = false; G.endT = 0; G.time = 0; G.frame = 0;
  G.death = null; G.lastKill = null; G.guide = null; G.mDown = false; G.won = false; G.roundOver = false; G.hitMark = 0; G.voice = null;
  G.stats = { shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0 };
  G.def = def;
}

// A single-player match: the player at the origin, the foes on a ring.
// A foe is a chassis key, or { type, at: [bearing°, dist], face: bearing°,
// aware, profile } to place it, point it, wake it (or not) and give it a
// fighting style other than its chassis's (ai/profiles.js).
export const foeType = f => (typeof f === 'string' ? f : f.type);
export function startMatch(G, def, seed, gentle, chassis, { partsKey, terrainOpts, loadout } = {}) {
  resetMatch(G, { def, seed, terrainOpts });
  // `start: [bearing°, dist, face°]` moves the player off the map's centre
  // (mission 11's long run); every other position stays measured from the centre.
  const st = def.start ? polar(def.start) : { x: 0, z: 0 }, face = def.start?.[2] ? -def.start[2] * Math.PI / 180 : 0;
  G.player = newMech(G, chassis, 0, st.x, st.z, face, { partsKey, loadout });
  G.mechs.push(G.player);
  G.eye = eyeOf(G.player); G.view = dirOf(0, 0); G.aim = add(G.eye, mul(G.view, 100));
  const rng = G.rng;
  def.foes.forEach((f, i) => {
    const s = typeof f === 'string' ? { type: f } : f;
    let x, z;
    if (s.at) ({ x, z } = polar(s.at));
    else { const a = (i / def.foes.length) * TAU + rng.range(-0.4, 0.4) + Math.PI * 0.6, d = rng.range(520, 760); x = sin(a) * d; z = cos(a) * d; }
    x = Math.max(-BOUND, Math.min(BOUND, x)); z = Math.max(-BOUND, Math.min(BOUND, z));
    const e = newMech(G, s.type, 1, x, z, s.face != null ? -s.face * Math.PI / 180 : atan2(-x, -z) + rng.range(-1, 1));
    e.ai.aware = s.aware ?? (i === 0 && gentle ? false : rng.chance(0.3));
    if (s.profile) { e.ai.plan = PROFILES[s.profile](e); e.ai.profile = s.profile; }
    G.mechs.push(e);
  });
  initObjectives(G, def);
  G.state = 'play'; G.paused = false;
}
