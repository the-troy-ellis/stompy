// Melee numbers per chassis (docs/specs/12-melee.md). Every mech can shove;
// a chassis with fists (M2's PURPLE PUNCHER) overrides these with a real
// punch via CHASSIS[key].melee. Reach is in metres times chassis scale.
export const DEFAULT_MELEE = {
  dmg: 8, reach: 9, arc: 30 * Math.PI / 180, windup: 0.3, recover: 0.7, cd: 1.5, heat: 2, knock: 12,   // knock: a KESTREL sends a JACKAL about 6 m in the first second
  stompDmg: 6, stompKnock: 6, stompAir: 0.6,   // stompAir: airborne this long before a landing counts as a stomp
};
// PURPLE PUNCHER's fists: the real punch (docs/specs/12-melee.md § Numbers).
export const FIST_MELEE = {
  dmg: 30, reach: 14, arc: 25 * Math.PI / 180, windup: 0.45, recover: 0.9, cd: 2, heat: 4, knock: 22,
  stompDmg: 18, stompKnock: 14, stompAir: 0.6, fists: true,
};
// A mech with fists punches with whichever arm it still has, at full
// strength; with both arms gone it falls back to the shove.
export const meleeOf = m => {
  const f = m.ch.melee;
  if (!f) return DEFAULT_MELEE;
  if (f.fists && m.hp && m.hp.LA <= 0 && m.hp.RA <= 0) return DEFAULT_MELEE;
  return m.fistMelee || f;   // KNUCKLES fitted (loadout.js builds it)
};
// Which fist throws this punch: they take turns, skipping a lost arm.
export function punchArm(m) {
  const want = m.lastArm === 'RA' ? 'LA' : 'RA', other = want === 'RA' ? 'LA' : 'RA';
  return m.hp[want] > 0 ? want : m.hp[other] > 0 ? other : null;
}

// The AI's taste for it (docs/specs/12-melee.md § AI): the chance per second
// of opportunity that an enemy in reach and facing throws the punch, by
// difficulty (`G.diff`; #21 adds the setting, NORMAL until then), and how
// far outside the player's reach it keeps otherwise.
export const AI_PUNCH = { chance: { easy: 0.3, normal: 0.6, hard: 0.9 }, keepOut: 1.3 };
