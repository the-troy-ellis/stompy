# Bigger maps

| | |
|---|---|
| Status | in progress (parts 2–3) |
| Milestone | M14 |
| Size | L (in five parts) |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md), [29-ground-4m.md](29-ground-4m.md), [34-big-fights.md](34-big-fights.md) |
| Touch parity | the point of it: a bigger map that still fits in a phone's memory |

## Summary

A mission can choose a bigger map: room to spread a base out, longer marches
for raids, more ground to find things in. Today every map is 2.3 km square.
Everything that holds the map grows with its area, so a map twice as wide
needs four times the memory, and a phone's browser tab can't hold it. This
spec makes memory follow what has been dug and what is near you, not the
map's size. It then lets each mission pick its size. Today's maps stay as
they are.

## Where it stands

The map is fixed at 2,304 m square (`terrain.js`: `N` 96 × `CELL` 24 m). Its
size is a module constant that 18 files import (`HALF`, `BOUND`, `N`, and
`voxels.js`'s `NX`, `NZ`, `PX`, `PZ`). What is sized to the whole map:

| what | where | today (2.3 km) | 4.6 km | 9.2 km |
|---|---|---|---|---|
| the ground's density, one byte a corner | `voxels.js` `D` | 25.6 MB | 102 MB | 410 MB |
| the falling-ground check's scratch, made at the first fall | `voxels.js` `MARK` | 25.6 MB | 102 MB | 410 MB |
| the far ground on the GPU, every 256 m square | `render/ground.js` | ~20 MB* | ~80 MB | ~320 MB |
| tops, nav floors, the mech grid, heights | `top`, `nav.js`, `near.js`, `terrain.js` | < 2 MB | < 8 MB | < 30 MB |

\* All the ground meshes the perf scenes hold, near and far (`gpuMB`, spec 34).

A phone tab gets a few hundred MB in all. The perf scenes already hold about
100 MB of heap at today's size. 4.6 km doesn't fit without changes, and 9.2
km is far out of reach.

The ground is built from the heightfield, one column of corners at a time
(`makeGround`). Below a band 2 × `DS` (16 m) deep round the surface, every
byte is 255 (rock). Above it, every byte is 1 (air). Of a column's 77
corners, only three or four carry anything the heights don't already say.
Landmarks, pockets, mission strokes and digs are the only changes from that.

## Player experience

On a map the mission makes big, there's more of it: the map view zooms out
further, and raids walk further. Nothing else changes. The cockpit, the fog,
the feel and the controls are all as today. A phone holds the bigger map
without the view going out.

No new text.

## Design

Five parts, each its own PR, measured as spec 34 did. The memory parts come
first and change nothing a player sees. Only part 5 makes a map bigger.

### Part 1: measure a big map

- A `big-map` perf scene: the 3 km test canyon (part 5), walked along its
  length and swept in the map view. It reports `gpuMB` and `heapMB` with
  budgets, like `map-sweep`.
- The map's size is a module constant until part 5, so this scene lands
  with part 5. Parts 2–4 were measured on today's map instead.

### Part 2: the falling-ground check without a map-sized scratch

- What falls after a dig is found by a flood fill, which marks each corner
  it visits in `MARK`. `MARK` is one byte for every corner of the map
  (25.6 MB), but a fill stops at `ISLAND_MAX` (32,768) corners.
- The marks move to a small open-addressing hash of corner indices, sized
  to `ISLAND_MAX`: about 256 KB, the same at any map size.
- The same ground falls in the same order: a test runs today's fall cases
  both ways.

This halves the ground's memory today, with nothing else changed.

### Part 3: the ground in chunks, shared where all rock or all air

Built (`world/grid.js`). It's simpler than first planned, and close enough
in memory:

- The corners are held 16 × 8 × 16 at a time. A chunk that is all rock or
  all air is one shared array, so it costs nothing. It is copied the first
  time anything writes a different byte to it: a landmark, a pocket, a
  stroke, a dig, a fall or a heap.
- The ground is built chunk by chunk from each column's height, rock top and
  air bottom. A chunk wholly under every column's rock, or over every
  column's ramp, is known without working out its bytes. So the whole box is
  never held, and the build takes as long as before.
- `voxels.js` reads and writes through `at`/`put` (corner i, j, k: the hot
  paths, such as `csample`, column tops and blocks for the mesher) and
  `get`/`set` (corner indices: the fall checks, shaping and digging).
- The first plan, answering untouched chunks from the heights on every read,
  would have held only the changed chunks. Measured, the shared chunks get
  most of the way with no branch on the hot path: the chunks that cross the
  surface take 5 MB at today's size. That grows with the map's area (about
  20 MB at 4.6 km), which fits S, M and L.

Measured on today's map:
- A ground holds **8 MB instead of 27 MB**. The perf scenes hold 37–43 MB
  of heap instead of 55–62.
- A million samples near the surface cost the same either way (about 90–110
  ns each, the noise between runs larger than any difference).
- The crowd and dig scenes don't move.
- Fourteen grounds (two seeds and twelve missions), each dug 40 times with
  its falls, hash the same as before, corner for corner. So does the smoke
  test's arena ground across clients.

### Part 4: the far ground by distance

- Today every 256 m square's far mesh is built at load and kept on the GPU
  for the whole match.
- Far meshes are now built for squares within the fog's end plus a margin
  (`FAR_AT`, about 1.4 km) of the eye. They are let go past a larger
  distance (`FAR_GO`), as the near meshes are since #392.
- The map view (fog off) draws the far meshes of squares on screen. While
  the view is moving, a square without its mesh yet draws a flat stand-in at
  its height.
- GPU memory then follows what is near you, not the map's size. At today's
  size it barely changes, because the fog reaches most of the map.

### Part 5: a size per map, any width and length

Maps needn't be square. A combat mission can be a long canyon you fight
your way through; a base mission wants room all round. Memory follows area
(parts 2–4), so a 1 km × 3 km canyon costs about what today's square does.

- **The size is width × length.** `def.size: [w, l]` in metres (x across, z
  along), or one of the square presets in `SIZES` (`data/maps.js`): **S**
  2.3 km (today, and the default), **M** 3.5 km, **L** 4.6 km.
- **Two half-sizes, not one.** `G.map = { hx, hz, ... }` replaces the module
  constants `HALF`, `BOUND`, `N`, `NX`, `NZ`, `PX`, `PZ` that 18 files
  import. `terrain.js`, `voxels.js` and its grid, `nav.js`, `near.js`,
  `render/ground.js`, `render/falls.js`, `dig.js`, the map view's camera and
  the other importers read them from the game. Each axis keeps today's
  cells, so a size is rounded to whole 24 m cells and 4 m corners.
- **A canyon is ground, not a fence.** The heights already come from a
  function, so a mission can ask for a shape: `def.ground.shape: { canyon:
  { width, walls, wind } }`. It gives a floor about `width` m across that
  winds along the length, rising to walls `walls` m high on both sides, with
  the usual hills folded in. The map's edge, beyond the walls, still stops
  you. Landmarks (mesas, arches) sit on top as today.
- **Placements need no change.** Polar `[bearing°, dist]` from the centre
  reach either end of a long map. The editor keeps them inside the
  rectangle and shows its outline.
- **The test canyon** is 3 km long and 900 m across (`data/maps.js`
  `CANYON`): a floor about 200 m wide winding along it, with walls 80 m
  high. It is the `big-map` perf scene (part 1, which waited for this), a
  range in the debug menu, and a Free Play map to try.
- The arena and co-op carry the size and shape in the room's settings, so
  every client builds the same map. This is a network message change:
  `PROTOCOL` 23, and `docs/architecture.md` is updated.

### Not in this spec

- **More hills and features for bigger maps.** The heights already tile at
  any size. A big map may want more landmarks; that's mission work.
- **Fog of war.** Bigger maps make it more worth having. It's its own spec.
- **The sim on a worker thread.** Spec 34 found it isn't needed.

## Code touchpoints

- `scripts/perf.mjs`: the `big-map` scene and its budgets.
- `src/world/voxels.js`: the fill's hash (part 2), chunked storage and the
  column table (part 3), sizes from the ground (part 5).
- `src/world/mesher.js`, `src/render/groundWorker.js`: corners copied out
  through the same lookup (part 3).
- `src/render/ground.js`: far meshes by distance, and the map view's
  stand-ins (part 4).
- `src/world/terrain.js`, `src/sim/ai/nav.js`, `src/sim/near.js`,
  `src/render/falls.js`, `src/sim/dig.js` and the other importers of `HALF`
  and `BOUND`: the size from the game (part 5).
- `src/data/maps.js` (new): `SIZES`, `CANYON`. `src/world/terrain.js`:
  the canyon shape. `src/ui/editor.js`: the size and its outline.
- `src/net/protocol.js`, `server/server.py`: the room's size, `PROTOCOL` 23
  (part 5).

## Acceptance criteria

1. `npm run perf` has a `big-map` scene with GPU and heap budgets.
2. After part 2, a fall is the same as before (test), and no map-sized
   scratch is ever allocated.
3. After part 3, a fresh 2.3 km map holds under 8 MB of ground bytes, the
   arena's ground hash matches today's for the same digs, and the crowd and
   dig scenes cost no more than 5% more. (Done: 8 MB, the same hashes, no
   measurable change in either scene.)
4. After part 4, GPU memory in `big-map` stays within 25% of today's
   `map-sweep` while crossing the map.
5. After part 5, the 3 km canyon and a 4.6 km square both play on the
   reference phone without the view going out, with median and 95th
   percentile frame times reported. Today's maps play exactly as before
   (their grounds hash the same).

## Tests

- `test/voxels.test.js`: the fill's hash finds the same islands as the
  mark grid; a chunk never changed reads exactly as the dense ground did; a
  chunk changed then read back matches.
- `test/ground.test.js` (or the existing dig tests): digs, falls and heaps
  give the same ground and the same hash, chunked or dense.
- The smoke test's arena digs keep matching on every client (part 3), and
  across a room's size (part 5).

## Performance

This spec is memory work. Part 3 adds one lookup on the ground's hottest
paths, with a budget of about 5% in the crowd and dig scenes. Part 4 adds a
little work while moving: far meshes are built in the worker as squares come
near, as near meshes are today.

## Open questions

Settled by the owner:
- **Shapes, not just sizes.** Combat missions aren't limited to squares: a
  long canyon to fight through is the first case. Any width × length a
  mission sets, plus square presets S, M and L.
- **The test canyon is 3 km long.**

Still open, with defaults:
- **Which missions get which size.** Default: today's missions stay as they
  are. Base missions (spec 32, 33) and Free Play's BASE get a size picker,
  defaulting to M. Combat missions set their own shape.
- **The arena.** Default: stays square at S.
- **9.2 km.** It would fit after parts 2–4, but walking it takes minutes.
  Revisit after playing L.
