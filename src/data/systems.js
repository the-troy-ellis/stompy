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
export const JETS = [null,
  { charge: 0.9, vy: [14, 30], fwd: 14, recharge: 3, heat: [4, 12], tap: 0.2 },
  { charge: 0.75, vy: [15, 33], fwd: 16, recharge: 2, heat: [4, 12], tap: 0.2 }];
export const KNUCKLES_MULT = 1.5;                       // melee dmg and knock with KNUCKLES fitted
