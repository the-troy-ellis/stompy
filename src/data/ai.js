// AI numbers that are not balance (docs/specs/05-ai.md). Difficulty scales
// skill, never stats; `G.diff` picks the row (#21 adds the setting; NORMAL
// until then).
export const DIFF = {
  easy: { sight: 400, heatCap: 60, aimErr: 1.4, sections: false },
  normal: { sight: 600, heatCap: 72, aimErr: 1.0, sections: false },
  hard: { sight: 800, heatCap: 85, aimErr: 0.7, sections: true },
};

export const FIRE = {
  coolBelow: 15,      // heat under the cap before it opens up again after overheating
  alphaTorso: 0.25,   // target torso fraction under which everything that is ready fires at once
  lockFace: 0.3,      // rad: facing this well, for lockFor seconds, is a missile lock
  lockFor: 1,
  lrmMin: 120,        // m: missiles never closer than this
  armOffset: 1.9,     // m x scale: the aim offset toward a damaged arm (section targeting)
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

export const GROUP = {
  range: 200,   // m: enemies this close to one another form a group
  every: 0.5,   // s between group passes
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
