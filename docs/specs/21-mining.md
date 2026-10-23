# Mining and building: seams, dirt, and more to build

| | |
|---|---|
| Status | in progress (the owner picked these three from spec 20's Room to grow, 2026-10-23: "Do 1-3") |
| Milestone | M9 |
| Size | L, split in three: seams, dirt, buildings |
| Depends on | [20-build-and-fight.md](20-build-and-fight.md) (the digger, the base, BUILD); [18-voxel-ground.md](18-voxel-ground.md) (digging, building ground, the mesher) |
| Touch parity | Full. A digger has no guns, so its fire buttons are its tools: MISSILE is BUILD (as now), ENERGY is DUMP, BALLISTIC picks what BUILD puts down. Nothing new to learn on a phone |

## Summary

Spec 20 proved the loop: dig, haul, build, fight. Playing it, the owner
dug the mesa "assuming the mesa is where you are supposed to dig": every
rock gave the same ore, so where you dug didn't matter. This spec gives
digging a goal and a payoff. **Seams** are bands of ore you can see in the
rock, richer the deeper they run; plain rock gives little. **Dirt** the
bucket bites out of soft ground stays in the bucket and tips out as ramps
and berms, so the quiet phase shapes the loud one. **More to build**: a
repair bay and walls, picked with the BUILD button.

## Player experience

### 1. Seams

- Cliffs and the walls of your own holes show **seams**: thick wavy bands
  in a bright mineral colour (teal in the desert, amber on the glacier,
  green on the volcanic plain), running through the plain rock bands.
- A bite into a seam fills the hopper fast, with a sparkle of the seam's
  colour and `ORE SEAM` on the HUD. Deeper seams (further under the ground
  as built) give more. A bite into plain rock gives a little.
- So you look for colour, then dig toward it. A seam in a mesa's foot is
  worth more than one near its top.

### 2. Dirt

- A bite into soft ground (the top few metres) was worth nothing. Now the
  bucket keeps it: the hopper panel shows **DIRT** under ORE.
- **DUMP** (the ENERGY button; Mouse 1 on a desktop) tips a load out in
  front of you: a mound of ground. Tip again on top to raise it; tip along
  a line for a berm; tip against a slope for a ramp. A load is about one
  bite's worth. With none, the HUD says `NO DIRT`.
- A berm in front of the silo stops shots like any ground. Blasts dig it
  like any ground.

### 3. More to build

- **BALLISTIC** (Mouse 2) picks what BUILD puts down: FACTORY, BAY, WALL.
  The BUILD button reads `BUILD BAY` and so on; the footprint and its price
  show while BUILD is held, as now.
- **The repair bay** (placeholder name; `bay`): a low platform with a
  gantry. A crew mech standing on its pad gets its armour back, a little
  each second, with `REPAIRING` on the HUD. More than one can be built.
- **A wall** (`wall`): a slab of armour 12 m long, cheap and quick. It
  stops mechs and shots until it is shot down. Raiders don't hunt walls;
  they go round or through.

New text, in full: `ORE SEAM` · `DIRT` · `NO DIRT` · `DUMP` · `BUILD BAY` ·
`BUILD WALL` · `BUILD FACTORY` · `BAY` · `WALL` · `REPAIRING` · voice
`Bay up.` · `Wall up.`

## Design

### Seams (`src/world/seams.js`, pure)

`seamAt(seed, x, y, z)` is true where a seam runs: wavy layers
`SEAM_PITCH` (26 m) apart and `SEAM_THICK` (36%, about 9 m) thick, so
the 8 m corner grid always catches a layer; a sideways pattern from the
seed thins them to patches. Nothing is stored: every client and the
mesher get the same seams from the seed. Only rock shows them (below the
soft band; the mesher's stand-in is a face more than `SOFT` under its
column's top).

Ore per rock corner a bite turns to air (`CONSTRUCT`):

| | |
|---|---|
| plain rock | `orePerCorner` 1 (was 4) |
| a seam | `orePerSeam` 8 × (1 + depth ÷ `seamDeep` 40 m), capped at 2.5× |

Depth is below the ground as built (`ground.base`), so a seam at a mesa's
foot pays 2 to 3 times one at its rim. A 6 m bite turns two to four
corners: plain rock fills a 40 ore hopper in ten bites or more, a seam in
two or three.

### Dirt

- A bite counts the **soft** corners it turns to air (the top `SOFT`
  metres, which gave nothing): each is a unit of dirt, up to `dirtMax` 12.
- DUMP spends `dumpCost` 4 and builds a mound: a build stroke of radius
  `dumpR` 4.5 m centred on the ground `dumpAt` 9 m ahead (the voxel
  `build` op the editor uses). It lands on what's there, so mounds stack.
- Single player, as bites' ore is: online a bite still digs, and DUMP is
  off (building ground over the wire is a later `PROTOCOL` change).

### Buildings

| | price | going up | hp | footprint | how many |
|---|---|---|---|---|---|
| factory | 60 ore | 6 s | 400 | 24 m square, flat to 2 m | one |
| bay | 30 ore | 5 s | 300 | 16 m square, flat to 2 m | any |
| wall | 10 ore | 2 s | 300 | 12 × 3 m across your view, flat to 3 m | any |

- The bay repairs a crew mech within its pad (6 m) by `bayRate` 10 armour
  a second, to the most damaged section first, up to each section's full.
- A wall is a structure entity; it blocks mechs and shots as structures do.
  `raidTarget` hunts the silo, factory and bays, not walls.

### As built: seams

- `world/seams.js` `seamAt(seed, x, y, z)`: layers 26 m apart and 36% thick, leaning and rolling a few metres across the map, thinned to patches; about a quarter of the rock.
- `voxels.js` `dig`'s tally counts soft corners too, and tells `corner(x, y, z, depth)` of each rock one.
- `dig.js` `bite`: plain rock 1 ore a corner, a seam `seamOre(depth)` = 8 × (1 + depth ÷ 40) up to 2.5×; `m.seamBite` when a seam paid. `melee.js`: a sparkle in the seam's colour and `ORE SEAM`.
- The mesher colours a face in `pal.ore` where `seamAt` says, if it is more than 6 m under its column's top; the palette carries the ground's seed to the worker. Desert teal, glacier amber, volcanic green.
- On FIRST FACTORY the mesa's foot shows a wide seam band from the start.

## Code touchpoints

- `src/world/seams.js` (new): `seamAt`, `SEAM_PITCH`, `SEAM_THICK`.
- `src/world/voxels.js` `dig`: the tally gets a per-corner callback for
  rock and counts soft corners.
- `src/world/mesher.js`: seam faces in `pal.ore`; `pal.seed` comes with the
  palette. `src/data/palettes.js`: `ore` per biome. `src/render/ground.js`:
  the seed in the mesher's palette.
- `src/sim/dig.js` `bite`: ore by seam and depth; dirt. `src/sim/melee.js`:
  the sparkle and `ORE SEAM`.
- `src/sim/base.js`: `dump`, the building pick, footprints by kind, the bay.
  `src/data/construct.js`: the new numbers and buildings.
- `src/mesh/props.js`: the bay and the wall. `src/input/input.js`: the
  digger's ENERGY and BALLISTIC buttons. `src/render/hud.js`: DIRT, the
  pick, REPAIRING.

## Acceptance criteria

1. Seams show on a mesa's faces in the palette's ore colour, the same on
   every client for a seed.
2. A bite into a seam gives at least four times a bite into plain rock;
   deeper seams give more.
3. A soft-ground bite fills DIRT; DUMP raises the ground in front by a
   mound; repeated dumps stack.
4. BALLISTIC cycles FACTORY, BAY, WALL; BUILD places the picked one if
   there is ore and room.
5. Standing on a bay's pad brings armour back; raiders don't target walls.
6. All of it on a phone: the three buttons, nothing else.

## Tests

`test/seams.test.js` (pure seams; ore by seam and depth; the mesher's
colour), `test/dirt.test.js` (dirt from soft ground, a dump raises the
ground), `test/buildings.test.js` (the pick, prices, the bay's repair,
raids skip walls). The smoke test's base run builds a bay.

## Performance

Seams are a few sines per mesh triangle and per bitten corner: nothing a
frame. A wall or bay is one more entity.
