// Build and fight (docs/specs/20-build-and-fight.md): the construction
// numbers. Starting values, to tweak in play.
//   bucket        the digger's bite, a radius in metres: rock digs at full
//                 size (a construction tool, not a battle blast)
//   hopper        the ore a digger carries
//   orePerCorner  ore per rock corner a bite turns to air (rock: below the
//                 soft band, world/voxels.js SOFT). At 8 m corners a 6 m
//                 bite in solid rock turns two to four, so 4 each: a full
//                 hopper is about four bites
//   startOre      in the silo at the start
//   factory       the factory's price in ore; buildTime, seconds going up
//   mechCost      one fighting mech from the factory; mechTime, seconds
//   salvage       what a wreck gives, by chassis (part 4)
//   siloHp, factoryHp  their hit points
//   unload        m: a digger this near the silo's pad empties its hopper
//   footprint     m: the factory's square, which wants ground `flat` to
//                 within that many metres and no mech on it
export const CONSTRUCT = {
  bucket: 6, hopper: 40, orePerCorner: 4,
  startOre: 20, factory: 60, buildTime: 6, mechCost: { ore: 50, salvage: 30 }, mechTime: 30,
  salvage: { jackal: 10, light1: 10, kestrel: 20, sniper1: 20, warden: 35, puncher: 50 },
  siloHp: 600, factoryHp: 400, unload: 14, pickup: 8, footprint: 24, flat: 2,
};
// The buildings, as mission entities (sim/entities.js): unit meshes in mesh/props.js.
export const BUILDINGS = {
  silo: { kind: 'structure', mesh: 'silo', radius: 7, height: 18, team: 0, tags: ['silo'], label: 'SILO' },
  factory: { kind: 'structure', mesh: 'factory', radius: 12, height: 11, team: 0, tags: ['factory'], label: 'FACTORY' },
};
