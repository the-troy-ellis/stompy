// Mission 1's silent tutorial (docs/specs/11-release.md § Silent tutorial):
// each prompt in the house voice, at most three words plus the key, button or
// gesture, for the keyboard and mouse (kb), the touch controls and a gamepad.
// `at` is the instrument it sits by (render/hud.js). Steps come in order, each
// once its prompt is done; events break in when they happen (sim/tutorial.js).
export const TUT_STEPS = [
  { id: 'go', at: 'throttle', kb: 'W: GO. S: LESS GO.', touch: 'STICK UP: GO. DOWN: LESS GO.', pad: 'LEFT STICK UP: GO.' },
  { id: 'legs', at: 'compass', kb: 'A / D: LEGS', touch: 'DRAG TOP LEFT: LEGS', pad: 'LEFT STICK SIDEWAYS: LEGS' },
  { id: 'torso', at: 'centre', kb: 'MOUSE: TORSO', touch: 'STICK SIDEWAYS: TORSO', pad: 'RIGHT STICK: TORSO' },
  { id: 'melt', at: 'weapons', cat: 'energy', kb: 'HOLD LMB: MELT IT', touch: 'HOLD ENERGY: MELT IT', pad: 'HOLD RT: MELT IT' },
  { id: 'thump', at: 'weapons', cat: 'ballistic', kb: 'RMB: THUMP', touch: 'BALLISTIC: THUMP', pad: 'RB: THUMP' },
  { id: 'missiles', at: 'weapons', cat: 'missile', kb: 'SPACE: MISSILES (HOLD TO FLY)', touch: 'MISSILE (HOLD TO FLY)', pad: 'LT: MISSILES (HOLD TO FLY)' },
  { id: 'jump', at: 'centre', jets: true, kb: 'J: UP', touch: 'JUMP: UP', pad: 'A: UP' },
];
export const TUT_EVENTS = [
  { id: 'punch', at: 'centre', kb: 'E: PUNCH', touch: 'TAP PUNCH', pad: 'RIGHT STICK CLICK: PUNCH' },
  { id: 'heat', at: 'heat', kb: 'HEAT: TOO MUCH', touch: 'HEAT: TOO MUCH', pad: 'HEAT: TOO MUCH' },
  { id: 'target', at: 'target', kb: 'T: NEXT ONE', touch: 'TGT: NEXT ONE', pad: 'X: NEXT ONE' },
];
export const TUT = {
  gap: 1.2,        // s between one prompt fading and the next
  fade: 0.6,       // s a done prompt takes to go
  giveUp: 25,      // s an undone step waits before the next takes its place
  eventFor: 6,     // s an event's prompt stays if the pilot doesn't do it
  heatAt: 60,      // the first time heat passes this: HEAT: TOO MUCH
  turned: 0.6,     // rad of leg turn that counts as A / D done
  twisted: 0.35,   // rad of torso twist that counts as MOUSE done
  melted: 0.4,     // s of energy held that counts as LMB done
  going: 0.25,     // throttle that counts as W done
  pair: 300,       // m: a second hostile this close is "a second one"
};
