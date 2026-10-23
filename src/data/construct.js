// Build and fight (docs/specs/20-build-and-fight.md): the construction
// numbers. Starting values, to tweak in play.
//   bucket        the digger's bite, a radius in metres: rock digs at full
//                 size (a construction tool, not a battle blast)
//   hopper        the ore a digger carries
//   orePerCorner  ore per plain rock corner a bite turns to air (rock: below
//                 the soft band, world/voxels.js SOFT). At 8 m corners a 6 m
//                 bite in solid rock turns two to four
//   orePerSeam    the same in a seam (world/seams.js, docs/specs/21-mining.md),
//                 times 1 + depth / seamDeep below the ground as built, up to
//                 seamMax times: a seam fills the hopper in two or three bites,
//                 plain rock in ten or more
//   dirtPerCorner dirt for each soft corner a bite turns to air (docs/specs/21-mining.md
//                 § Dirt): a bite turns one or two, about one DUMP's worth
//   dirtMax       dirt a digger's bucket keeps
//   dumpCost      dirt one DUMP tips out; dumpR, metres: the mound's radius;
//   dumpAt        metres ahead of the digger it lands
//   startOre      in the silo at the start
//   factory       the factory's price in ore; buildTime, seconds going up
//   mechCost      one fighting mech from the factory; mechTime, seconds
//   salvage       what a wreck gives, by chassis (part 4)
//   siloHp, factoryHp  their hit points
//   unload        m: a digger this near the silo's pad empties its hopper
//   footprint     m: the factory's square, which wants ground `flat` to
//                 within that many metres and no mech on it
export const CONSTRUCT = {
  bucket: 6, hopper: 40, orePerCorner: 1, orePerSeam: 8, seamDeep: 40, seamMax: 2.5,
  dirtPerCorner: 2, dirtMax: 12, dumpCost: 4, dumpR: 4.5, dumpAt: 9,
  startOre: 20, factory: 60, buildTime: 6, mechCost: { ore: 50, salvage: 30 }, mechTime: 30,
  salvage: { jackal: 10, light1: 10, kestrel: 20, sniper1: 20, warden: 35, puncher: 50 },
  siloHp: 600, factoryHp: 400, unload: 14, pickup: 8, footprint: 24, flat: 2,
};
// The buildings, as mission entities (sim/entities.js): unit meshes in mesh/props.js.
export const BUILDINGS = {
  silo: { kind: 'structure', mesh: 'silo', radius: 7, height: 18, team: 0, tags: ['silo'], label: 'SILO' },
  factory: { kind: 'structure', mesh: 'factory', radius: 12, height: 11, team: 0, tags: ['factory'], label: 'FACTORY' },
};
