import { NAMES } from './names.js';

const n = NAMES.weapons;
// `sfx` names a weapon's own sound recipe (audio/sound.js); without one, shells
// use the cannon and beams the laser zap.
// `dig`: how big a hole a hit digs, a radius in metres (spec 18 § Digging in
// play: the owner's approved battle table, to tweak after play). Not worked out
// from damage: battle weapons stay at 0 to 4 m, the big events at 6 to 7 m
// (DIG below), and construction gear, later, gets 8 to 16 m. None means 0
// (lasers, the TOASTER, the PEASHOOTER). Reserved for that gear: `build` (it
// adds ground) and `kind: 'tool'`; neither is used yet.
export const WEAPONS = {
  // Lasers are continuous beams: damage per second (dps) climbs the longer
  // a beam stays on one mech -- its armour melts (see MELT_T / MELT_MAX) -- and heat per second
  // (hps) is the price -- two large lasers outrun the heat sinks.
  // tons: what it costs in the mechlab; fp: its firepower score for the FIT screen's bars (about damage per second).
  laser:  { name: n.laser,  kind: 'beam',    dps: 3.5, hps: 12, range: 520, col: [1, 0.25, 0.2], w: 0.22, cd: 1, tons: 5, fp: 3.5 },
  mlaser: { name: n.mlaser, kind: 'beam',    dps: 2.0, hps: 6,  range: 360, col: [0.3, 1, 0.35], w: 0.16, cd: 1, tons: 2, fp: 2 },
  // Short-range melt specialist: armour under it melts `meltRate` times as fast
  // (full in 2 s), and the beam stutters at `stutter` Hz.
  plaser: { name: n.plaser, kind: 'beam',    dps: 2.6, hps: 8,  range: 300, col: [1, 0.55, 0.15], w: 0.15, cd: 1, tons: 3, fp: 2.6, meltRate: 1.5, stutter: 12 },
  // Forces shutdowns at knife range: a `cone` of fire instead of a line, and
  // `targetHeat` (per second) poured into whatever it is on.
  flamer: { name: n.flamer, kind: 'beam',    dps: 0.8, hps: 3,  range: 90,  col: [1, 0.5, 0.12], w: 0.1, cd: 1, tons: 1.5, fp: 0.8, targetHeat: 6, cone: true, sfx: 'toaster' },
  // The autocannon is the opposite: big individual hits, little heat, ammo.
  // The sniper's gun: a bright tracer, a heavy `recoil` that rocks the shooter
  // back a step (m/s on its push), and a `knock` on the target worth a shove.
  gauss:  { name: n.gauss, kind: 'shell', dig: 3.5, dmg: 20, heat: 1, cd: 3.2, range: 800, speed: 700, ammo: 12, knock: 6, recoil: 1.6, tracer: [0.85, 0.95, 1], sfx: 'bonker', tons: 12, fp: 6.3 },
  // Strips a melted section fast: each trigger pull is a `burst` of n rounds,
  // dt apart (ammo and heat are per burst, damage per round), with a little jitter.
  mg:     { name: n.mg, kind: 'shell', dmg: 0.8, heat: 0.2, cd: 0.5, range: 220, speed: 520, ammo: 60, burst: { n: 6, dt: 0.05 }, jitter: 0.012, tracer: [1, 0.85, 0.45], tw: 0.18, tl: 3.5, sfx: 'peashooter', tons: 1, fp: 9.6 },
  ac:     { name: n.ac, kind: 'shell', dig: 2.5, dmg: 11,  heat: 2,  cd: 1.1, range: 650, speed: 340, ammo: 30, tons: 8, fp: 10 },
  // A slow blue bolt: a shell with `bolt` set (drawn as a bolt, fired with the
  // energy weapons). Its hit scrambles the target's HUD for `scramble` s and
  // gives it a hard wobble (FEEL.bolt).
  ppc:    { name: n.ppc, kind: 'shell', bolt: true, dig: 4, dmg: 14, heat: 11, cd: 3.5, range: 600, speed: 420, scramble: 1.5, col: [0.45, 0.7, 1], tons: 7, fp: 4, sfx: 'thunderclap' },
  // Dumb-fire spread that pops: no homing (`homing: false`), no lock or minimum
  // range for the AI, hold-to-guide still works, and each hit shoves (`knock`, m/s).
  srm:    { name: n.srm, kind: 'missile', homing: false, dig: 2, dmg: 2.6, heat: 4, cd: 3, range: 260, speed: 160, ammo: 18, count: 6, knock: 1.2, spread: 0.035, lift: 0.02, tons: 3, fp: 5.2 },   // tighter and flatter than a homing volley: it cannot correct
  lrm:    { name: n.lrm, kind: 'missile', dig: 1.5, dmg: 1.9, heat: 6,  cd: 4.5, range: 850, speed: 120, ammo: 14, count: 10, tons: 6, fp: 4.2 },
  // Hold a targeting laser on one mech for `scan` seconds -- any break and it
  // starts over -- and the reactor discharges at the target's resonant
  // frequency: an outright kill. The price: heat jumps to `overload` (a
  // deep shutdown, ~5 s) and the cannon needs `cd` seconds to recharge.
  // Lock help, so it's hard but possible: the laser counts within `slack` m
  // of a mech, a slip shorter than `grace` s pauses the scan rather than
  // resetting it, and while locked the torso is drawn gently toward the
  // target (`assist`, per second).
  fusion: { name: n.fusion, kind: 'fusion', dig: 6, scan: 3, cd: 25, overload: 140, range: 600, scanHeat: 2, col: [0.78, 0.5, 1],
    slack: 1.5, grace: 0.5, assist: 2.2,
    // Reactor feedback: firing costs this share of your own torso's max
    // armour -- enough to kill you if it's already low. The discharge is a
    // pulse of sine waves travelling the targeting beam at `pulseSpeed` m/s;
    // the target dies when it arrives.
    feedback: 0.35, pulseSpeed: 350 },
};

// The big battle events' digs, in metres (spec 18): a mech's death blast is
// `death` × its scale up to `deathMax`, ammunition cooking off in a wreck
// `cookOff`, a guided volley set off by hand `guided` where it was. On rock,
// battle digs reach `rock` of their radius.
export const DIG = { death: 5, deathMax: 7, cookOff: 7, guided: 4, rock: 0.5 };
// Falling ground landing on a mech (spec 18 § Falling ground): `perCell` per
// corner of ground that fell, to the torso, at most `max`. The owner's
// defaults, to try in the bench.
export const CRUSH = { perCell: 3, max: 40 };
// The torque rule (spec 18 § Overhangs that can't hold their weight): an
// overhang breaks when its load (each corner's reach from what holds it, in
// cells) is over `rock` × its section (the columns holding it). Measured:
// an arch on both legs 26, a mesa's 24 m lip 35, a ball on a whole pillar
// 22 stand; an arch on one leg 110, a thinned pillar 84 break. `rounds`: a
// break can leave a new overhang, checked again this many times a dig.
export const TORQUE = { rock: 50, rounds: 4 };

// Three fire controls, one per kind of weapon: lasers are energy (no ammo,
// lots of heat), the autocannon is ballistic, LRMs are missiles.
export const CATS = ['energy', 'ballistic', 'missile', 'fusion'];
export const CAT_OF = { laser: 'energy', mlaser: 'energy', ppc: 'energy', plaser: 'energy', flamer: 'energy', ac: 'ballistic', gauss: 'ballistic', mg: 'ballistic', lrm: 'missile', srm: 'missile', fusion: 'fusion' };
export const CAT_LABEL = NAMES.cats;
export const CAT_KEY = { energy: 'LMB 1', ballistic: 'RMB 2', missile: 'SPC 3', fusion: 'G 4' };
