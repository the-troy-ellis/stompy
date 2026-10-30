# The ground on a 4 m grid

| | |
|---|---|
| Status | built (see As built). The owner, 2026-10-30, after side-by-side screenshots of a throwaway 4 m branch (`experiment/grid-4m`): "the 8m map was built when this was just a combat game, since adding construction and mining elements, I think we need to move to 4m. The remeshing from 2m to 8m distorted the ground changes too much and 2m to 4m remeshing will look more natural" |
| Milestone | M12 (hold to dig), a follow-on |
| Size | L. One PR for the grid, since the tests can't pass halfway; a second for perf if phones need it |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md) (the ground); [21-mining.md](21-mining.md) (ore and dirt by the corner); [27-fine-dig.md](27-fine-dig.md) (fine patches, the settle); [14-look-and-performance.md](14-look-and-performance.md) (budgets) |
| Touch parity | Nothing new to press |

## Summary

The voxel ground goes from 8 m cells to 4 m. Craters come out as round
bowls and bites along a face as separate scallops, everywhere and for good,
and a fine patch (2 m) settles into ground only twice as coarse, so the
slump keeps the hole's shape instead of flattening it into an 8 m block.
Everything measured in metres stays the same size; everything counted in
corners is rescaled so ore, dirt, falls and the dig's pace are as today.

## Player experience

- The same maps, hills, mesas, arches, tunnels and caves, in the same places
  and sizes, with smaller facets: smoother rims and slopes, still faceted
  and flat-shaded (spec 14's look).
- Craters, bites and dug faces keep a round shape at any distance.
- A fine patch's settle slumps 2 m into 4 m: the hole stays a hole.
- Digging pays as today: the same ore and dirt for the same time at a face.
- Falls and overhangs behave as today: the same sizes hold, snap and shatter.
- No new text.

## Design

### The grid

| | 8 m (today) | 4 m |
|---|---|---|
| `VS` cell | 8 m | 4 m |
| `NY` layers (same 304 m of height from `Y0` −44) | 38 | 76 |
| `NX`, `NZ` | 288 | 576 |
| corners | 3.3 M (3.3 MB) | 26 M (26 MB; online, twice, with the confirmed copy) |
| `DS` density scale (`2 × VS`) | 16 m | 8 m |
| bedrock (corners `j <= BEDROCK`), 8 m thick | 1 | 2 |
| `CS` chunk, corners | 16 (128 m) | 16 (64 m) |
| `G2` render group, chunks (256 m) | 2 | 4 |
| far mesh past `LOD_AT` (300 m) | 16 m (step 2) | 16 m (step 4) |

### Corner-counted rules, rescaled to the same metres

| | today | 4 m | why |
|---|---|---|---|
| `ISLAND_MAX` (land, not a falling island) | 4096 | 32768 | ×8 corners per volume |
| `SHATTER` | 8 | 64 | the same |
| `TORQUE_GROW` (cells round a dig) | 6 | 12 | ×2 cells per metre |
| torque K (load against section) | set by test | re-fit to today's arch, mesa lip and pillar results | |
| `orePerCorner`, `orePerSeam` | 1, 8 | 1/8, 1 | the same ore per cubic metre |
| `dirtPerCorner` | 1 | 1/8 | the same dirt per cubic metre |
| the hopper and silo (`hopper`, `dirtMax`, costs) | unchanged | unchanged | they're in ore, not corners |

Ore is summed as a fraction and rounded when it lands in the hopper, as now.

### Digging

- A scoop run (`TOOL.dig`: `r0`, `grow`, `steps`) is re-fit so a held DIG at
  a face brings ore at the punch's pace again (the 80-seed test, within 5%).
  At 4 m a smaller scoop already takes a corner, so the run can be shorter.
- Blast digs (`DIG` in `data/weapons.js`) keep their radii in metres.
- These are rescalings to keep today's balance, decided by the owner with
  this spec; no balance number changes its effect.

### Fine patches (spec 27)

- `FS` stays 2 m: a patch is now 2 fine cells per coarse cell (was 4).
- `PATCH.maxSide` 8 → 16 cells and `margin` 1 → 2, so a patch is the same
  size in metres. `settleAfter` and the rest unchanged.
- The settle slumps the fine ground toward the 4 m ground.

### What else reads the grid

- The AI's nav (`sim/ai/nav.js`), falls drawing (`render/falls.js`) and the
  dig log read `VS` and follow it; anything that assumed 8 m in a constant
  is found and given metres.
- Online: digs are spheres and are sent as now, but two builds on different
  grids would carve different ground, so `PROTOCOL` goes to 22 (a mismatch
  is refused, as for any bump).
- Missions, the editor's strokes and landmarks are shapes in metres: no data
  changes.

## Code touchpoints

- `src/world/voxels.js`: `VS`, `NY`, `BEDROCK`, `ISLAND_MAX`, `SHATTER`,
  `TORQUE_GROW`, `LIST_MAX`, the far mesh's step, torque K.
- `src/render/ground.js`: `G2`.
- `src/world/finePatch.js`: `PATCH`.
- `src/data/construct.js`: per-corner ore and dirt.
- `src/data/tools.js`: the run.
- `src/net/protocol.js`: `PROTOCOL` 22, and `docs/architecture.md`.
- `scripts/perf.mjs`: budgets re-measured, with a history note.
- Tests that count corners or cells are rescaled; tests about metres stay.

## Acceptance criteria

- `npm test`, lint, build, smoke and perf pass; budgets moved only with the
  numbers recorded beside today's.
- The 80-seed ore pace is within 5% of the punch's; the parked digger fills
  up on seeds 4 to 7 in about today's times.
- The arch, mesa lip and pillar tests hold and snap as today.
- Load time on a mid phone is noted in the PR, and frame time in a dig scene.
- Tried on a real phone: a crater, a dug face and a settle.

## Open questions

- If the phone's frame time or load time is too high: the far mesh at 32 m,
  a shorter `LOD_AT`, or building the grid in the worker. Measure first.

## As built

- **The grid** is as the table says. `ISLAND_MAX` 32768, `SHATTER` 64,
  `TORQUE_GROW` 12, `LIST_MAX` 1 << 22, `BEDROCK` 2, `G2` 4, the far mesh
  at `FAR_STEP` (16 m / `VS`), fine patches `margin` 2 and `maxSide` 16.
- **Torque K** is 500, re-fitted: on the 8 m grid with K 50 what should hold
  measured up to 34 and what should break from 110; on 4 m, up to 326 and
  from 894. K 500 keeps both margins.
- **Ore and dirt per corner are fitted to the pace, not to volume.** The 8 m
  grid counted more corners per bite than its volume gave, so an eighth was
  too little. `orePerCorner` 0.127 and `orePerSeam` 1.02 bring the 80-seed
  pace to the punch's (10380); `dirtPerCorner` 3/8 keeps a pile about a
  bite's hole. A bite's ore is summed as a fraction and the remainder
  carried to the next (`m.oreCarry`), so it's the same in any order.
- **A flat-bottomed bite.** A face's scoop (aimed within 15° of level) clears
  its sphere and, below the centre, a cylinder of the same radius down to a
  floor (`dig(p, r, rock, tally, fl)`, the fine patches too): the digger's
  feet where the run began, or for a parked digger its tunnel's mouth. On
  4 m a round scoop left a toe of rock at the face's foot and gouged the
  floor, and mechs couldn't walk the tunnel. Aimed down at the floor, a
  scoop is round and digs a pit, as before. Single player, as a bite's ore
  is: online a bite is a plain dig.
- **The crack** (spec 28) is now the scoop that tips a whole ore into the
  hopper: nearly every rock scoop turns a 4 m corner.
- **The scoop run** is unchanged (r0 3, grow 1, steps 6); the aim's height
  is `TOOL.dig.lift` (4, as before).
- **Walking on 4 m ground** (`sim/ai/nav.js`): a walk is checked every 2 m
  (a wall can rise inside one 4 m cell) with slack scaled to the step, and a
  crew mech's feelers use its own climb (torso height over radius, × 0.85:
  the digger's 1.2) and look no further than where it's going. A parked
  digger walks by its tunnel's mouth when the straight way to the silo or
  back isn't one it can walk, and when a dig cycle comes up dry it steps up
  to 8 m off the face (`MINER.stand`) instead of a fixed 4 m.
- **BIG DIGS** went from 3× to 4×: at 3× an AUTOCANNON only chipped an
  arch's leg on 4 m.
- **The parked digger** on seeds 4 to 7 fills its hopper in 206, 213, 69 and
  69 s (241, 154, 91 and 91 on 8 m). On 4 and 5 it unloads at the silo.
- **Not yet, and open:**
  - On seeds 6 and 7 the test's opening dig (you, aiming at the floor
    before you park) leaves a pit 8 m deep across the tunnel, and the
    parked digger can't climb out of it to haul. On the 8 m grid that dig
    barely took a corner. A pit you dig is now a real pit: diggers may need
    a way out (a ramp they dig, or jets).
  - `PROTOCOL` is 22: the same digs carve other ground on the two grids.
