// AI numbers that are not balance (docs/specs/05-ai.md). Difficulty scales
// skill, never stats; `G.diff` picks the row (#21 adds the setting; NORMAL
// until then).
export const DIFF = {
  easy: { sight: 400 },
  normal: { sight: 600 },
  hard: { sight: 800 },
};
export const diffOf = G => DIFF[G.diff] || DIFF.normal;

export const PERCEPTION = {
  lookEvery: 0.15,    // s between line-of-sight checks per enemy (staggered)
  lostAfter: 8,       // s without line of sight before an aware enemy goes searching
  shoutRange: 200,    // m: allies this close hear a contact call
  shoutDelay: 1,      // s before the call lands
  extrapolate: 2,     // s of velocity extrapolation applied to a stale belief, at most
  searchFor: 20,      // s spent searching around the last known position
  searchRadius: 80,   // m around it
};
