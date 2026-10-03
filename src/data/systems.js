// The three system slots of mechlab-lite (docs/specs/02-mechlab.md § Data).
// Each has levels from 0; `tons` is per level. KNUCKLES (PURPLE PUNCHER only)
// arrives with that chassis in #76.
export const SYSTEMS = {
  sinks: { label: 'HEAT SINKS', max: 3, tons: 1, show: L => (L ? `+${L * 2}` : 'NONE') },
  armour: { label: 'ARMOUR', max: 2, tons: 2, show: L => (L ? `+${L * 10}%` : 'NONE') },
  jets: { label: 'JUMP JETS', max: 2, tons: 1.5, show: L => ['NONE', 'STOCK', 'BOOSTED'][L] },
};
export const SYSTEM_KEYS = Object.keys(SYSTEMS);
export const SINK_PER_LEVEL = 2;
export const ARMOUR_HP = 0.1, ARMOUR_SPEED = 0.04;     // per level: hp up, speed down
export const JETS_FUEL = [0, 1, 1.5], JETS_CLIMB = [0, 1, 1.2];
