import { NAMES } from './names.js';

// Build and fight (docs/specs/20-build-and-fight.md): the construction
// numbers. Starting values, to tweak in play.
//   bucket        the digger's bite, a radius in metres: rock digs at full
//                 size (a construction tool, not a battle blast)
//   hopper        the ore a digger carries; haul, the ore a hauler carries
//                 (docs/specs/21-mining.md § The hauler), and handover, m: a
//                 crew digger this near a crew hauler tips its hopper into it
//   orePerCorner  ore per plain rock corner a bite turns to air (rock: below
//                 the soft band, world/voxels.js SOFT). At 4 m corners a 6 m
//                 bite in solid rock turns some sixteen to thirty, so each
//                 is an eighth of the 8 m grid's (docs/specs/29-ground-4m.md):
//                 the same ore per cubic metre
//   orePerSeam    the same in a seam (world/seams.js, docs/specs/21-mining.md),
//                 times 1 + depth / seamDeep below the ground as built, up to
//                 seamMax times: a seam fills the hopper in two or three bites,
//                 plain rock in ten or more
//   dirtPerCorner dirt for each corner a bite turns to air, soft ground or rock
//                 (docs/specs/21-mining.md § Dirt), an eighth as for ore
//   dirtMax       dirt a digger's bucket keeps: six piles
//   dumpCost      dirt one DUMP tips out: a pile dumpH metres high and dumpR
//                 across its foot. About one bite's worth: a four-corner bite
//                 digs out some 600 m³ and its pile is some 900 (loose dirt
//                 bulks up, and a pile you can see beats a pile that adds up)
//   dumpAt        metres ahead of the digger it lands
//   startOre      in the silo at the start
//   factory       the factory's price in ore; buildTime, seconds going up
//   mechCost      one fighting mech from the factory; mechTime, seconds
//   salvage       what a wreck gives, by chassis (part 4)
//   siloHp, factoryHp  their hit points
//   unload        m: a digger this near the silo's pad empties its hopper
//   footprint     m: the factory's square, which wants ground `flat` to
//                 within that many metres and no mech on it
//   bayRate       armour a second a repair bay gives a crew mech on its pad
//                 (bayPad m from it), most damaged section first (docs/specs/21-mining.md)
export const CONSTRUCT = {
  bucket: 6, hopper: 40, haul: 160, handover: 16, orePerCorner: 0.127, orePerSeam: 1.02, seamDeep: 40, seamMax: 2.5,
  dirtPerCorner: 3 / 8, dirtMax: 24, dumpCost: 4, dumpH: 6, dumpR: 9, dumpAt: 13,
  startOre: 20, factory: 60, buildTime: 6, mechCost: { ore: 50, salvage: 30 }, mechTime: 30,
  salvage: { jackal: 10, light1: 10, kestrel: 20, sniper1: 20, warden: 35, puncher: 50 },
  siloHp: 600, factoryHp: 400, unload: 14, pickup: 8, footprint: 24, flat: 2,
  bayRate: 10, bayPad: 6,
};
// What BUILD puts down (docs/specs/21-mining.md § Buildings), in the order
// BALLISTIC picks them: the price in ore, seconds going up, hit points, the
// footprint (w across your view, d along it, in metres, wanting ground flat
// to `flat` metres), and whether there can be only one. A wall goes up as
// `segs` slabs side by side, each its own entity. It goes down as a site
// (docs/specs/23-construction-sites.md): `ore` carried to it and `swings` of
// a digger's bucket build it (for a wall, shared among its slabs); `time`
// is no longer used.
export const PLACE = {
  factory: { ore: CONSTRUCT.factory, time: CONSTRUCT.buildTime, swings: 12, hp: CONSTRUCT.factoryHp, w: CONSTRUCT.footprint, d: CONSTRUCT.footprint, flat: CONSTRUCT.flat, one: true },
  bay: { ore: 30, time: 5, swings: 8, hp: 300, w: 16, d: 16, flat: 2 },
  wall: { ore: 10, time: 2, swings: 6, hp: 300, w: 12, d: 3, flat: 3, segs: 3, snap: 5 },   // snap: how near a wall's free end a new one snaps on (m)
};
export const PLACE_ORDER = ['factory', 'bay', 'wall'];
// The buildings, as mission entities (sim/entities.js): unit meshes in mesh/props.js.
// A bay is a gantry with a pad in front, like the silo; a wall slab is 4.2 m wide.
const B = NAMES.buildings;
export const BUILDINGS = {
  silo: { kind: 'structure', mesh: 'silo', radius: 7, height: 18, team: 0, tags: ['silo'], label: B.silo },
  factory: { kind: 'structure', mesh: 'factory', radius: 12, height: 11, team: 0, tags: ['factory'], label: B.factory },
  bay: { kind: 'structure', mesh: 'bay', radius: 6, height: 8, team: 0, tags: ['bay'], label: B.bay },
  wall: { kind: 'structure', mesh: 'slab', radius: 2.2, height: 6, team: 0, tags: ['wall'], label: B.wall },
};
