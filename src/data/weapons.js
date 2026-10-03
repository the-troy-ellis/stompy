import { NAMES } from './names.js';

const n = NAMES.weapons;
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
  // The autocannon is the opposite: big individual hits, little heat, ammo.
  ac:     { name: n.ac, kind: 'shell',  dmg: 11,  heat: 2,  cd: 1.1, range: 650, speed: 340, ammo: 30, tons: 8, fp: 10 },
  // A slow blue bolt: a shell with `bolt` set (drawn as a bolt, fired with the
  // energy weapons). Its hit scrambles the target's HUD for `scramble` s and
  // gives it a hard wobble (FEEL.bolt).
  ppc:    { name: n.ppc, kind: 'shell', bolt: true, dmg: 14, heat: 11, cd: 3.5, range: 600, speed: 420, scramble: 1.5, col: [0.45, 0.7, 1], tons: 7, fp: 4 },
  // Dumb-fire spread that pops: no homing (`homing: false`), no lock or minimum
  // range for the AI, hold-to-guide still works, and each hit shoves (`knock`, m/s).
  srm:    { name: n.srm, kind: 'missile', homing: false, dmg: 2.6, heat: 4, cd: 3, range: 260, speed: 160, ammo: 18, count: 6, knock: 1.2, spread: 0.035, lift: 0.02, tons: 3, fp: 5.2 },   // tighter and flatter than a homing volley: it cannot correct
  lrm:    { name: n.lrm, kind: 'missile', dmg: 1.9, heat: 6,  cd: 4.5, range: 850, speed: 120, ammo: 14, count: 10, tons: 6, fp: 4.2 },
  // Hold a targeting laser on one mech for `scan` seconds -- any break and it
  // starts over -- and the reactor discharges at the target's resonant
  // frequency: an outright kill. The price: heat jumps to `overload` (a
  // deep shutdown, ~5 s) and the cannon needs `cd` seconds to recharge.
  // Lock help, so it's hard but possible: the laser counts within `slack` m
  // of a mech, a slip shorter than `grace` s pauses the scan rather than
  // resetting it, and while locked the torso is drawn gently toward the
  // target (`assist`, per second).
  fusion: { name: n.fusion, kind: 'fusion', scan: 3, cd: 25, overload: 140, range: 600, scanHeat: 2, col: [0.78, 0.5, 1],
    slack: 1.5, grace: 0.5, assist: 2.2,
    // Reactor feedback: firing costs this share of your own torso's max
    // armour -- enough to kill you if it's already low. The discharge is a
    // pulse of sine waves travelling the targeting beam at `pulseSpeed` m/s;
    // the target dies when it arrives.
    feedback: 0.35, pulseSpeed: 350 },
};

// Three fire controls, one per kind of weapon: lasers are energy (no ammo,
// lots of heat), the autocannon is ballistic, LRMs are missiles.
export const CATS = ['energy', 'ballistic', 'missile', 'fusion'];
export const CAT_OF = { laser: 'energy', mlaser: 'energy', ppc: 'energy', plaser: 'energy', ac: 'ballistic', lrm: 'missile', srm: 'missile', fusion: 'fusion' };
export const CAT_LABEL = NAMES.cats;
export const CAT_KEY = { energy: 'LMB 1', ballistic: 'RMB 2', missile: 'SPC 3', fusion: 'G 4' };
