// Melee numbers per chassis (docs/specs/12-melee.md). Every mech can shove;
// a chassis with fists (M2's PURPLE PUNCHER) overrides these with a real
// punch via CHASSIS[key].melee. Reach is in metres times chassis scale.
export const DEFAULT_MELEE = {
  dmg: 8, reach: 9, arc: 30 * Math.PI / 180, windup: 0.3, recover: 0.7, cd: 1.5, heat: 2, knock: 12,   // knock: a KESTREL sends a JACKAL about 6 m in the first second
  stompDmg: 6, stompKnock: 6, stompAir: 0.6,   // stompAir: airborne this long before a landing counts as a stomp
};
export const meleeOf = m => m.ch.melee || DEFAULT_MELEE;

// The AI's taste for it (docs/specs/12-melee.md § AI): the chance per second
// of opportunity that an enemy in reach and facing throws the punch, by
// difficulty (`G.diff`; #21 adds the setting, NORMAL until then), and how
// far outside the player's reach it keeps otherwise.
export const AI_PUNCH = { chance: { easy: 0.3, normal: 0.6, hard: 0.9 }, keepOut: 1.3 };
