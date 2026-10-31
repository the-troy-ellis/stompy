# The builder: command places, builders build

| | |
|---|---|
| Status | ready. The owner, 2026-10-31: "I don't think the mech should be the ones placing buildings, that should be done from the command view. The mechs should be constructing the buildings on the sites placed from command view. I want there to be a building gameplay loop as well and we'll need to add additional mechs for that". Then picked: slam pieces in; only builders build; one new builder mech |
| Milestone | M10 (command and construction), a follow-on |
| Size | L, in two parts: the builder and its loop (sim, data, inputs, AI); its look and feel (the crane's swing, the piece dropping in, the finish) |
| Depends on | [22-command-view.md](22-command-view.md) (the map, BUILD); [23-construction-sites.md](23-construction-sites.md) (sites, ore carried in); [25-hold-to-dig.md](25-hold-to-dig.md) (a tool on the primary button); [28-dig-feel.md](28-dig-feel.md) (a run that builds to a finish) |
| Touch parity | Full: BUILD is the primary button, held, as DIG is; placing is the map's BUILD, as now |

## Summary

Sites are placed only from the command view, never from a cockpit. A new
mech, the **builder**, builds them: drive one to a site and hold BUILD, and
its crane swings a piece up off the site's ore pile and slams it in place,
piece after piece, each a thunk, until the building is up. Left alone, a
builder goes to work on its own. Diggers dig, haulers carry, builders
build: each crew mech has one job.

## Player experience

### Placing (command view only)

- The map's BUILD (spec 22) is the one way to put down a site: FACTORY,
  BAY or WALL, the footprint green where it fits. Unchanged.
- In a digger's cockpit there's no BUILD or NEXT any more. Its buttons are
  DIG and DUMP.

### The builder (placeholder name: BIG STACKER)

- A tall, slow mech in the crew's safety yellow with a crane: one long arm
  with a hook, a cab low on the front. No guns, no punch.
- Its primary button is **BUILD**, held, as the digger's is DIG.

### Building, driving one

- Walk up to a site and face it. Its next piece glows, a ghost on top of
  what's built.
- **Hold BUILD:** the crane swings round, a block rises off the ore pile
  on the hook, and slams down where the ghost was. A thunk you feel, a
  puff of dust, and the building is one piece taller. Keep holding and the
  next piece comes, about one a second (the old swing's pace).
- **A run builds up:** each piece in a row hits a little harder and sounds a
  little lower (spec 28's run), and the last piece of a building is the
  big one: a landing-sized thump, a ring of dust, and the voice,
  `Factory up.` (as now).
- No ore delivered for the next piece: the crane swings empty and the
  cockpit says `NEEDS ORE`. Let go and the crane finishes its swing.
- Facing nothing to build: `NOTHING TO BUILD`.

### Builders on their own

- A parked builder with no order goes to the nearest site with work it can
  do (ore delivered beyond what's built), builds until the work catches up
  with the ore, and waits by the site or goes to the next one. The crew
  strip reads `BUILDING`.
- From the map, a builder picked plus BUILD on a site sends it there.

### Who does what

- **Diggers** dig ore and dirt. They no longer build. A digger with ore
  passing a site that needs ore still tips it in (spec 23).
- **Haulers** fetch silo ore to sites, as now.
- **Builders** build.

### Text (new, for a tone check)

- Button: `BUILD`.
- Cockpit: `NOTHING TO BUILD`. (`NEEDS ORE` and `BUILDING` as now.)
- Role line: `IT BUILDS.` Kit line: `A CRANE · A HOOK`.

## Design

- **Chassis `builder`** (`data/chassis.js`): forward legs, `tool: 'build'`,
  no hardpoints, about the digger's size and speed, slower turning. Its
  look in `mesh/mechParts.js` (style `builder`): the cab, a crane arm, a
  hook. Name in `data/names.js` (placeholder).
- **The loop** (`sim/tools.js`, beside DIG): BUILD held swings the crane,
  one swing per `TOOL.build.swing` s (1.2: the pace a digger built at,
  three scoops a swing). Each swing at a site in reach that has work does
  one piece: `buildSwing`, as now, which counts work against ore. A piece
  per swing, so a building's pieces are its `swings` (`PLACE`: factory 12,
  bay 8, wall 6). The pace of building is unchanged.
- **The run:** pieces in a row at one site count up, as a dig run does,
  and set the feel row's k (`slam`), the last piece of a building its own
  row (`built`).
- **Feel rows** (`data/feel.js`): `slam` (a punch's size, k by the run),
  `built` (a landing's), and `swingEmpty` (a whiff). Sounds: `sfx.slam`,
  `sfx.built`.
- **Diggers stop building:** `sim/tools.js` scoop no longer builds a site in
  reach; `sim/miner.js` no longer sends a parked digger to a site's work
  (it still tips ore in).
- **No cockpit placing:** `buildTrigger` and `pickNext` go from the digger's
  missile and ballistic buttons (`sim/update.js`, `input/input.js`, the HUD's
  footprint). `placeSite` from the map stays.
- **Parked builders** (`sim/miner.js`, the site half of today's digger
  logic): to the nearest site with work, square on, hold BUILD.
- **Missions:** FIRST FACTORY and THE YARD get a builder in the crew; the
  range's CREW picker offers it.
- Single player, as building is now; online the factory and sites aren't
  built yet (spec 20).

## Part 2: the look and feel

- The crane's arm swings round on BUILD, the hook drops to the site's pile
  and lifts.
- A block (a cube in the building's colours) rides the hook up and drops
  onto the building's top, landing as the piece goes in, with its dust.
- The ghost of the next piece glows over the site.
- From the cockpit, the crane is drawn as the digger's arms are (spec 30's
  view model).

## Code touchpoints

- `src/data/chassis.js`, `src/data/names.js`, `src/mesh/mechParts.js`: the builder.
- `src/data/tools.js`: `TOOL.build`.
- `src/sim/tools.js`: BUILD's swing; DIG no longer builds.
- `src/sim/base.js`: `buildSwing` reused; `buildTrigger` and `pickNext` out.
- `src/sim/miner.js`: parked builders build; parked diggers don't.
- `src/sim/update.js`, `src/input/input.js`, `src/render/hud.js`: the
  digger's BUILD and NEXT removed; the builder's BUILD.
- `src/data/feel.js`, `src/audio/sound.js`: `slam`, `built`.
- `src/data/missions.js`, `src/data/range.js`: builders in crews.

## Acceptance criteria

- No cockpit can place a site; the map can.
- Driving a builder at a site with ore, held BUILD raises it a piece a
  swing, at the old pace, and the last piece finishes it.
- A parked builder builds a site with ore delivered; a parked digger does
  not.
- Diggers still dig at the 80-seed pace; their parked digging and hauling
  work as before.
- FIRST FACTORY can still be won: dig, haul, build the factory with the
  builder.
- Tried on a real phone.

## Tests

`test/builder.test.js`: placing is map-only; a held BUILD at a site raises
it a piece a swing; no ore, no piece; the last piece finishes it; a parked
builder builds on its own; a parked digger leaves sites alone. The tests
that had diggers build (`test/tools.test.js`, `test/sites.test.js`, the
base mission's) move to builders.

## NAMING

The builder ships as BIG STACKER (a placeholder in `names.js`); its PR
carries screenshots and candidates.
