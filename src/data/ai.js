// AI numbers that are not balance (docs/specs/05-ai.md). Difficulty scales
// skill, never stats; `G.diff` picks the row (#21 adds the setting; NORMAL
// until then).
export const DIFF = {
  easy: { sight: 400 },
  normal: { sight: 600 },
  hard: { sight: 800 },
};
export const diffOf = G => DIFF[G.diff] || DIFF.normal;

export const BEHAVIOUR = {
  coverHeat: 60, coverTorso: 0.4, coverLeave: 35,   // enter cover hot or hurt; leave cool
  coverDists: [40, 80, 120], coverEvery: 2, coverArrive: 8, coverMaxWait: 12, coverRetry: 20,
  ridgeAbove: 15, ridgeRadii: [80, 120, 160, 200, 240, 300], ridgeEvery: 4, ridgeArrive: 10,
  harassBand: [140, 200], jumpWithin: 60, jumpFor: 1.2, jumpCooldown: 6,
  lineRange: 150,     // m: holdLine matches the slowest ally this close
  allyGap: 6,         // m of clearance avoidAllies steers for
};

export const PERCEPTION = {
  lookEvery: 0.15,    // s between line-of-sight checks per enemy (staggered)
  lostAfter: 8,       // s without line of sight before an aware enemy goes searching
  shoutRange: 200,    // m: allies this close hear a contact call
  shoutDelay: 1,      // s before the call lands
  extrapolate: 2,     // s of velocity extrapolation applied to a stale belief, at most
  searchFor: 20,      // s spent searching around the last known position
  searchRadius: 80,   // m around it
};
