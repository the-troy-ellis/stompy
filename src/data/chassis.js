import { NAMES } from './names.js';
import { FIST_MELEE } from './melee.js';

// Hit points per section: T(orso), L/R A(rm), L/R L(eg). Losing the torso kills.
// `legs` names a body plan in geo.js; `pref` is the AI's preferred range,
// `acc0` its aim error per metre and `ai.profile` how it fights
// (src/sim/ai/profiles.js; docs/specs/05-ai.md § Profiles).
// Mechlab (docs/specs/02-mechlab.md): `tons` is the budget, `frame` the fixed
// weight of everything that is not a weapon or a system (set so the stock
// loadout uses about 85% of the budget), `hardpoints` the slots in HUD order,
// each locked to a fire category, and `systems` the stock levels. The fusion
// cannon is not a hardpoint: every chassis carries it, after the rest.
// `sysMax` caps a system below its usual top level for this chassis.
// `unlock`: how many campaign missions must be cleared before it can launch.
// M2 adds (docs/specs/06-chassis-and-weapons.md): `geo` overrides the body
// plan (geoFor), `style` picks the torso and arms (mesh/mechParts.js), and
// `melee` gives a chassis fists (data/melee.js).
export const CHASSIS = {
  kestrel: { name: NAMES.chassis.kestrel, legs: 'reverse', speed: 15, turn: 1.05, sink: 10, scale: 1, pref: 300, acc0: 0.03, ai: { profile: 'baseline' },
    hp: { T: 72, LA: 32, RA: 32, LL: 42, RL: 42 }, col: [0.55, 0.58, 0.62], acc: [0.85, 0.6, 0.15],
    tons: 45, frame: 12.5, systems: { sinks: 0, armour: 0, jets: 1 },
    hardpoints: [{ id: 'la', loc: 'LA', cat: 'energy', stock: 'laser' }, { id: 'ra', loc: 'RA', cat: 'energy', stock: 'laser' },
      { id: 't1', loc: 'T', cat: 'ballistic', stock: 'ac' }, { id: 't2', loc: 'T', cat: 'missile', stock: 'lrm' }] },
  jackal: { name: NAMES.chassis.jackal, legs: 'forward', speed: 19, turn: 1.6, sink: 9, scale: 0.85, pref: 140, acc0: 0.035, ai: { profile: 'harass' },
    hp: { T: 30, LA: 13, RA: 13, LL: 18, RL: 18 }, col: [0.62, 0.26, 0.2], acc: [0.2, 0.2, 0.22],
    tons: 25, frame: 15.5, systems: { sinks: 0, armour: 0, jets: 1 },
    hardpoints: [{ id: 'la', loc: 'LA', cat: 'energy', stock: 'mlaser' }, { id: 'ra', loc: 'RA', cat: 'energy', stock: 'mlaser' }] },
  warden: { name: NAMES.chassis.warden, legs: 'quad', speed: 9, turn: 0.7, sink: 10, scale: 1.15, pref: 330, acc0: 0.025, ai: { profile: 'line' },
    hp: { T: 58, LA: 28, RA: 28, LL: 34, RL: 34 }, col: [0.36, 0.4, 0.3], acc: [0.75, 0.7, 0.2],
    tons: 60, frame: 30.5, systems: { sinks: 0, armour: 0, jets: 1 }, unlock: 4,
    hardpoints: [{ id: 't1', loc: 'T', cat: 'missile', stock: 'lrm' }, { id: 'ra', loc: 'RA', cat: 'ballistic', stock: 'ac' },
      { id: 'la', loc: 'LA', cat: 'energy', stock: 'laser' }] },
  // The one with fists. Slow enough to kite, ruinous if it reaches you.
  puncher: { name: NAMES.chassis.puncher, legs: 'forward', style: 'puncher', speed: 9, turn: 0.6, sink: 12, scale: 1.3, pref: 20, acc0: 0.03, ai: { profile: 'brawler' },
    hp: { T: 110, LA: 50, RA: 50, LL: 60, RL: 60 }, col: [0.45, 0.22, 0.6], acc: [0.95, 0.75, 0.2],
    geo: { hip: 5.0, l1: 2.6, l2: 2.6, stride: [3.0, 3.4], girth: 1.35, radius: 3.0, armX: 2.95, armY: 1.55, eye: [0, 1.8, 1.75], acY: 0.9, rackY: 2.55 },
    melee: FIST_MELEE, unlock: 11, lockedInColour: true,
    tons: 80, frame: 57, systems: { sinks: 0, armour: 0, jets: 0 }, sysMax: { jets: 1 },
    hardpoints: [{ id: 't1', loc: 'T', cat: 'ballistic', stock: 'ac' }, { id: 't2', loc: 'T', cat: 'missile', stock: 'srm' }] },
  // A light reverse-joint skirmisher: long shins, boosted jets stock, and
  // light enough to be shoved a very long way.
  light1: { name: NAMES.chassis.light1, legs: 'reverse', style: 'light1', speed: 22, turn: 1.9, sink: 8, scale: 0.8, pref: 170, acc0: 0.035, ai: { profile: 'skirmish' },
    hp: { T: 28, LA: 12, RA: 12, LL: 16, RL: 16 }, col: [0.26, 0.58, 0.56], acc: [0.95, 0.45, 0.18],
    geo: { hip: 4.5, l1: 2.4, l2: 2.9, stride: [4.2, 5.2], swing: 0.46, radius: 2.2, height: 7.6, armX: 1.45, armY: 1.6, eye: [0, 1.55, 1.1], acY: 0.8, rackY: 2.2 },
    tons: 25, frame: 12.5, systems: { sinks: 0, armour: 0, jets: 2 }, unlock: 6,
    hardpoints: [{ id: 'la', loc: 'LA', cat: 'missile', stock: 'srm' }, { id: 'ra', loc: 'RA', cat: 'energy', stock: 'mlaser' },
      { id: 't1', loc: 'T', cat: 'ballistic', stock: 'mg' }] },
  // A medium sniper on stilts: tall legs, a narrow stance, a long gun arm.
  sniper1: { name: NAMES.chassis.sniper1, legs: 'forward', style: 'sniper1', speed: 13, turn: 0.9, sink: 11, scale: 1, pref: 450, acc0: 0.02, ai: { profile: 'sniper' },
    hp: { T: 60, LA: 26, RA: 26, LL: 36, RL: 36 }, col: [0.72, 0.7, 0.62], acc: [0.2, 0.45, 0.75],
    geo: { hip: 5.4, l1: 3.0, l2: 2.8, radius: 2.2, armX: 1.9, armY: 1.9, eye: [0, 2.0, 1.4], acY: 1.3, rackY: 2.6,
      legs: [{ hx: 0.7, hz: 0, fx: 0.8, fz: 0, ph: 0 }, { hx: -0.7, hz: 0, fx: -0.8, fz: 0, ph: 0.5 }] },
    tons: 50, frame: 21.5, systems: { sinks: 0, armour: 0, jets: 0 }, sysMax: { jets: 1 }, unlock: 8,
    hardpoints: [{ id: 'ra', loc: 'RA', cat: 'ballistic', stock: 'gauss' }, { id: 'la', loc: 'LA', cat: 'energy', stock: 'ppc' },
      { id: 't1', loc: 'T', cat: 'energy', stock: 'mlaser' }] },
};

// The selectable mechs, in selector order. Locked ones are in the list too:
// the selector shows them as silhouettes, and they cannot launch.
export const MECH_ORDER = ['kestrel', 'jackal', 'warden', 'light1', 'sniper1', 'puncher'];
export const isUnlocked = (key, cleared) => (CHASSIS[key]?.unlock || 0) <= cleared;
// A locked chassis on show: a near-black silhouette, except the one that
// stays purple (on purpose: it is the game's set piece).
const SILHOUETTE = [0.07, 0.07, 0.08];
export function lockedLook(ch) {
  if (ch.lockedInColour) { const c = ch.col.map(v => v * 0.7); return { col: c, acc: c }; }
  return { col: SILHOUETTE, acc: SILHOUETTE };
}   // #75 makes this unlock-aware
export const MECH_INFO = NAMES.roles;   // what the menu says about each one

export const HPK = ['T', 'LA', 'RA', 'LL', 'RL'];
export const SECT_NAME = NAMES.sections;
