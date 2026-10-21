// Build and fight (docs/specs/20-build-and-fight.md): the construction
// numbers. Starting values, to tweak in play.
//   bucket        the digger's bite, a radius in metres: rock digs at full
//                 size (a construction tool, not a battle blast)
//   hopper        the ore a digger carries
//   orePerCorner  ore per rock corner a bite turns to air (rock: below the
//                 soft band, world/voxels.js SOFT). At 8 m corners a 6 m
//                 bite in solid rock turns two to four, so 4 each: a full
//                 hopper is about four bites
export const CONSTRUCT = { bucket: 6, hopper: 40, orePerCorner: 4 };
