import { NAMES } from './names.js';

// Hit points per section: T(orso), L/R A(rm), L/R L(eg). Losing the torso kills.
// `legs` names a body plan in geo.js; `pref` is the AI's preferred range,
// `acc0` its aim error per metre and `ai.profile` how it fights
// (src/sim/ai/profiles.js; docs/specs/05-ai.md § Profiles).
// Mechlab (docs/specs/02-mechlab.md): `tons` is the budget, `frame` the fixed
// weight of everything that is not a weapon or a system (set so the stock
// loadout uses about 85% of the budget), `hardpoints` the slots in HUD order,
// each locked to a fire category, and `systems` the stock levels. The fusion
// cannon is not a hardpoint: every chassis carries it, after the rest.
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
    tons: 60, frame: 30.5, systems: { sinks: 0, armour: 0, jets: 1 },
    hardpoints: [{ id: 't1', loc: 'T', cat: 'missile', stock: 'lrm' }, { id: 'ra', loc: 'RA', cat: 'ballistic', stock: 'ac' },
      { id: 'la', loc: 'LA', cat: 'energy', stock: 'laser' }] },
};

// The selectable mechs, in selector order, with what the menu says about them.
export const MECH_ORDER = ['kestrel', 'jackal', 'warden'];
export const MECH_INFO = NAMES.roles;

export const HPK = ['T', 'LA', 'RA', 'LL', 'RL'];
export const SECT_NAME = NAMES.sections;
