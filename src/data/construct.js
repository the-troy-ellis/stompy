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
//   siloRoom      ore each standing silo adds to the pool's room (docs/specs/33-production.md)
//   link          m: silos and beacons this near each other link; three
//                 linked to each other make a triangle of territory
//   crewMax       the crew's most, you included: an assembly line makes no
//                 more past it (docs/specs/32-base-loop.md)
//   isoPerCorner  isotopes a corner of an isotope seam gives (world/seams.js isoAt;
//                 docs/specs/33-production.md); isoHeat the heat each whole one puts
//                 in the digger; isoMax what one mech carries; isoRoom the pool's
//                 room for them a silo standing
//   repairOre     a builder's repairs: this share of a building's price mends
//                 it from nothing to full, a swing at a time
export const CONSTRUCT = {
  bucket: 6, hopper: 40, haul: 160, handover: 16, orePerCorner: 0.127, orePerSeam: 1.02, seamDeep: 40, seamMax: 2.5,
  dirtPerCorner: 3 / 8, dirtMax: 24, dumpCost: 4, dumpH: 6, dumpR: 9, dumpAt: 13,
  startOre: 20, factory: 60, buildTime: 6, mechCost: { ore: 50, salvage: 30 }, mechTime: 30,
  salvage: { jackal: 10, light1: 10, kestrel: 20, sniper1: 20, warden: 35, puncher: 50 },
  siloHp: 600, factoryHp: 400, unload: 14, pickup: 8, footprint: 24, flat: 2,
  bayRate: 10, bayPad: 6,
  siloRoom: 200, link: 200, repairOre: 0.5, crewMax: 8,
  isoPerCorner: 0.4, isoHeat: 4, isoMax: 20, isoRoom: 50,
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
  silo: { ore: 40, swings: 8, hp: CONSTRUCT.siloHp, w: 16, d: 16, flat: 2 },   // another silo: room for ore, and a beacon (spec 33)
  beacon: { ore: 10, swings: 3, hp: 150, w: 5, d: 5, flat: 3 },   // a post that makes territory (spec 33)
  shop: { ore: 60, swings: 10, hp: 500, w: 16, d: 12, flat: 2 },   // the machine shop: parts from ore (spec 33)
  line: { ore: 100, swings: 16, hp: 700, w: 12, d: 40, flat: 2 },   // the open assembly line: mechs from parts (spec 33)
  plant: { ore: 80, swings: 12, hp: 500, w: 14, d: 14, flat: 2 },   // the isotope plant: cores from isotopes (spec 33)
};
export const PLACE_ORDER = ['factory', 'bay', 'wall', 'silo', 'beacon', 'shop', 'line', 'plant'];
// The buildings, as mission entities (sim/entities.js): unit meshes in mesh/props.js.
// A bay is a gantry with a pad in front, like the silo; a wall slab is 4.2 m wide.
const B = NAMES.buildings;
export const BUILDINGS = {
  silo: { kind: 'structure', mesh: 'silo', radius: 7, height: 18, team: 0, tags: ['silo'], label: B.silo },
  factory: { kind: 'structure', mesh: 'factory', radius: 12, height: 11, team: 0, tags: ['factory'], label: B.factory },
  bay: { kind: 'structure', mesh: 'bay', radius: 6, height: 8, team: 0, tags: ['bay'], label: B.bay },
  wall: { kind: 'structure', mesh: 'slab', radius: 2.2, height: 6, team: 0, tags: ['wall'], label: B.wall },
  beacon: { kind: 'structure', mesh: 'beacon', radius: 2, height: 12, team: 0, tags: ['beacon'], label: B.beacon },
  shop: { kind: 'structure', mesh: 'shop', radius: 8, height: 10, team: 0, tags: ['shop'], label: B.shop },
  line: { kind: 'structure', mesh: 'line', radius: 15, height: 14, team: 0, tags: ['line'], label: B.line },   // 12 m across, 40 m along its local z
  plant: { kind: 'structure', mesh: 'plant', radius: 7, height: 16, team: 0, tags: ['plant'], label: B.plant },
};
// Production (docs/specs/33-production.md § The machine shop, § The assembly
// line): parts by size, not by mech, each with its price in ore and the mech
// whose mesh shows it on a pile (render only); what each mech takes, in its
// bays' order (legs, body, then arms or tools; the third bay takes a core,
// from the isotope plant); and the line's numbers.
export const PARTS = {
  'legs.light': { kind: 'legs', ore: 8, show: 'hauler' },
  'legs.heavy': { kind: 'legs', ore: 15, show: 'digger' },
  'body.light': { kind: 'body', ore: 8, show: 'hauler' },
  'body.heavy': { kind: 'body', ore: 15, show: 'digger' },
  bucket: { kind: 'arms', ore: 10, show: 'digger' },
  tub: { kind: 'arms', ore: 10, show: 'hauler' },
  crane: { kind: 'arms', ore: 10, show: 'builder' },
  core: { kind: 'core', iso: 10 },   // from the isotope plant, not the shop: every mech needs one
};
export const RECIPES = {
  digger: ['legs.heavy', 'body.heavy', 'bucket'],
  hauler: ['legs.light', 'body.light', 'tub'],
  builder: ['legs.heavy', 'body.light', 'crane'],
};
//   bays      the line's bays: legs, body, core, arms
//   wait      mechs that can wait for the first bay
//   bayTime   s a bay takes once its part is in
//   press     s the shop takes to press a part; core, s the plant takes for a core
//   pile      parts a shop's pile holds before it stops
//   things    parts on the ground, the whole base's most
export const LINE = { bays: 4, wait: 3, bayTime: 4, press: 6, core: 20, pile: 6, things: 80 };
// Ore spilled from a fallen silo (spec 33): a heap on the ground with no body
// (a nav point's kind, so nothing bumps into it or shoots it), drawn by its
// mesh, which a crew mech with room scoops up.
export const HEAP = { kind: 'nav', mesh: 'heap', team: 0, tags: ['heap'], trigger: 0, height: 2, label: 'ORE' };
