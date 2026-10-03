import { NAMES } from './names.js';

// Hit points per section: T(orso), L/R A(rm), L/R L(eg). Losing the torso kills.
// `legs` names a body plan in geo.js; `pref` is the AI's preferred range and
// `acc0` its aim error per metre.
export const CHASSIS = {
  kestrel: { name: NAMES.chassis.kestrel, legs: 'reverse', speed: 15, turn: 1.05, sink: 10, scale: 1, pref: 300, acc0: 0.03,   // acc0 so a KESTREL enemy aims at all (NaN otherwise)
    hp: { T: 72, LA: 32, RA: 32, LL: 42, RL: 42 }, col: [0.55, 0.58, 0.62], acc: [0.85, 0.6, 0.15],
    weapons: [['laser', 'LA'], ['laser', 'RA'], ['ac', 'T'], ['lrm', 'T'], ['fusion', 'T']] },
  jackal: { name: NAMES.chassis.jackal, legs: 'forward', speed: 19, turn: 1.6, sink: 9, scale: 0.85, pref: 140, acc0: 0.035,
    hp: { T: 30, LA: 13, RA: 13, LL: 18, RL: 18 }, col: [0.62, 0.26, 0.2], acc: [0.2, 0.2, 0.22],
    weapons: [['mlaser', 'LA'], ['mlaser', 'RA'], ['fusion', 'T']] },
  warden: { name: NAMES.chassis.warden, legs: 'quad', speed: 9, turn: 0.7, sink: 10, scale: 1.15, pref: 330, acc0: 0.025,
    hp: { T: 58, LA: 28, RA: 28, LL: 34, RL: 34 }, col: [0.36, 0.4, 0.3], acc: [0.75, 0.7, 0.2],
    weapons: [['lrm', 'T'], ['ac', 'RA'], ['laser', 'LA'], ['fusion', 'T']] },
};

// The selectable mechs, in selector order, with what the menu says about them.
export const MECH_ORDER = ['kestrel', 'jackal', 'warden'];
export const MECH_INFO = NAMES.roles;

export const HPK = ['T', 'LA', 'RA', 'LL', 'RL'];
export const SECT_NAME = NAMES.sections;
