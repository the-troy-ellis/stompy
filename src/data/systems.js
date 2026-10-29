// The system slots of mechlab-lite (docs/specs/02-mechlab.md § Data).
// Each has levels from 0; `tons` is per level. `needs: 'fists'` means only a
// chassis with fists has the slot (KNUCKLES: PURPLE PUNCHER).
export const SYSTEMS = {
  sinks: { label: 'HEAT SINKS', max: 3, tons: 1, show: L => (L ? `+${L * 2}` : 'NONE') },
  armour: { label: 'ARMOUR', max: 2, tons: 2, show: L => (L ? `+${L * 10}%` : 'NONE') },
  jets: { label: 'JUMP JETS', max: 2, tons: 1.5, show: L => ['NONE', 'STOCK', 'BOOSTED'][L] },
  knuckles: { label: 'KNUCKLES', max: 1, tons: 3, needs: 'fists', show: L => ['NONE', 'FITTED'][L] },
};
export const SYSTEM_KEYS = Object.keys(SYSTEMS);
export const SINK_PER_LEVEL = 2;
export const ARMOUR_HP = 0.1, ARMOUR_SPEED = 0.04;     // per level: hp up, speed down
// Blast-off jets (docs/specs/26-blast-off.md), by JUMP JETS level (0 none,
// 1 STOCK, 2 BOOSTED): hold to charge, let go to blast off.
//   charge    s from empty to full
//   vy        m/s up at blast-off, [a tap's, a full charge's]
//   fwd       m/s added along the legs' heading at a full charge, times the throttle
//   recharge  s for the jets to be ready again after a blast
//   heat      added at blast-off, [a tap's, a full charge's]
//   tap       a charge under this is a hop
//   steer     m/s² the movement controls push a flight along and across
//   tilt      rad the view tips down at a flight's height of `tiltAt` m and up
//   reach     m the jets lock a foe from while charging (sim/jets.js jetLock)
//   aimFwd    m/s the most speed along an aimed blast may take to reach its lock
//   assist    m/s² the auto-steer's pull toward the lock in the air
//   assistMax m/s the most the auto-steer may add over one flight
//   letGo     s of steering away from the lock that drops it
//   stompFall m fallen from a blast's top that makes a stomp an insta-stomp
export const JETS = [null,
  { charge: 0.9, vy: [14, 40], fwd: 14, recharge: 3, heat: [4, 12], tap: 0.2, steer: 6, tilt: 0.3, reach: 80, aimFwd: 20, assist: 4, assistMax: 10, letGo: 0.5, stompFall: 8 },
  { charge: 0.75, vy: [15, 44], fwd: 16, recharge: 2, heat: [4, 12], tap: 0.2, steer: 7, tilt: 0.3, reach: 90, aimFwd: 22, assist: 4, assistMax: 10, letGo: 0.5, stompFall: 8 }];
// steerOver: m/s the steering may add over a blast's own speed along; cone:
// rad off the view a lock may be (the missiles' lock); escape: m a locked
// flight may miss by before the lock lets go (it got away); lockTilt: rad
// the view may tip down to keep a locked target in sight (render/scene.js).
export const JETS_FLIGHT = { steerOver: 6, tiltAt: 40, cone: 0.3, escape: 35, lockTilt: 1.1 };
export const KNUCKLES_MULT = 1.5;                       // melee dmg and knock with KNUCKLES fitted
