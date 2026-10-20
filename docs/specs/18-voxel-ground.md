# Voxel ground (canyons, caves, overhangs, and craters you dig)

| | |
|---|---|
| Status | ready: approved by the owner, with the open questions' defaults (the battle dig table and crush numbers to tweak after play; construction mechs dig more; unsupported ground falls) |
| Milestone | M8 (proposed; after M7.5) |
| Size | L (split into six issues; see the end) |
| Depends on | [14-look-and-performance.md](14-look-and-performance.md) (chunks, budgets, the bench); [15-mission-editor.md](15-mission-editor.md) (the editor it extends); [16-body-plans.md](16-body-plans.md) (feet on the ground); [09-coop.md](09-coop.md) and [10-internet-play.md](10-internet-play.md) (sync) |
| Touch parity | Full. Play needs nothing new. The editor's brushes paint with one finger, as its other tools do |

## Summary

The ground stops being a height map and becomes a grid of solid and empty
cells, drawn flat-shaded like everything else. That buys canyons with steep
walls, caves and tunnels, arches and overhangs. Also ground that weapons dig
into: a shell leaves a dent, a missile volley leaves a crater, and a mech
that dies on a ridge takes a bite out of it. Mission authors sculpt it in the
editor, and every client sees the same holes.

The prototype is the evidence: <https://claude.ai/artifact/X39sRnKzUYvvPtJc2EVKe9>.
On the owner's phone it held 60 fps through 343 blasts. A chunk rebuilt in
2.8 ms on average (10 ms at worst). Upload to the GPU cost 0.06 ms, and the
first build of its 768 m square took 63 ms.

## Player experience

- **The look.** The same palettes, flat shading and chunky pixels. Steep
  faces are banded rock; flat tops are sand, coloured by height as today.
  Under an overhang or inside a tunnel the ground is darker, so a cave reads
  as a cave without lights or shadows. The hills of every existing mission
  keep their shape. They are cut into cells now, so they look a little more
  faceted.
- **Digging.** Every explosion bites the ground. Shells dent it, missile
  volleys leave craters, a fusion shot digs a pit, and a mech's death blast
  digs the biggest hole of all. The bits fly out as debris coloured like the
  ground they came from, with the existing dust and thump.
- **Falling.** If the ground under a mech is blown away, it drops, landing
  with the thump and squash it has today. You can dig a hole under an enemy,
  and they can do it to you.
- **Walking in tight spaces.** Walls stop a mech and it slides along them.
  Jets bump a ceiling. A tunnel too low for your mech stops it at the mouth.
  Every chassis fits the authored tunnels; a dug one has to be big enough.
- **Shooting and seeing.** Overhangs, arches and tunnel roofs block shots,
  missiles, beams and line of sight, the same as hills do today.
- **The editor.** New tools: DIG, BUILD and SMOOTH brushes, and landmarks
  (TUNNEL, ARCH, MESA, CAVE) placed like any other thing. A slice slider
  cuts the top-down view at a height to see under overhangs.
- **New text,** all in the editor:
  - Tool labels: `DIG`, `BUILD`, `SMOOTH`, `TUNNEL`, `ARCH`, `MESA`, `CAVE`,
    `SLICE`.
  - Help lines: `DIG MAKES A HOLE.` · `BUILD MAKES A LUMP.` ·
    `SMOOTH MAKES IT NICE.` · `SLICE LOOKS UNDER THINGS.`
  - Problem strip: `THIS FOE IS INSIDE A ROCK.` · `THE START IS INSIDE A ROCK.`
    · `THIS ROUTE GOES THROUGH A WALL.`
  - No new voice lines or HUD text in play.

## Design

### The grid

| | Value | Why |
|---|---|---|
| Cell size | 8 m | The prototype tested 8 m and 4 m. 8 m suits the chunky look and fits a phone. A mech-sized tunnel is two to three cells |
| Extent | 2304 × 256 × 2304 m (288 × 32 × 288 cells) | Today's map and more height than any terrain uses (the highest today is ~135 m) |
| Density | one byte per corner (above 128 is solid) | 289 × 33 × 289 ≈ 2.8 MB, plus 167 KB of column tops |
| Chunk | 16 cells a side, 648 chunks | As in the prototype |
| Bedrock | the two bottom layers never change | Nothing digs through the floor |
| Edges | air outside `BOUND` | As today, the play area ends; the slab's sides close in the fog |

4 m cells were measured and rejected: the full map would need about 22 MB,
and the prototype drew four times the triangles at half the frame rate.

### Building a map's ground

1. **The base** is today's height function (`makeTerrain`: seed, flat zones
   and pads), turned into density as "height minus y". Every mission keeps
   its hills.
2. **Landmarks** from the mission add shapes, each a distance field, in
   order:
   - `{ kind: 'tunnel', from: [b, d, y], to: [b, d, y], r }`
   - `{ kind: 'arch', at: [b, d], r, thick, face }`
   - `{ kind: 'mesa', at: [b, d], r, top, lip }`, a flat top whose lip hangs out
   - `{ kind: 'cave', at: [b, d], r, depth }`, a hollow with a mouth facing the
     open side

   Positions are polar `[bearing°, dist]`, as everything else in a mission is.
3. **Strokes** are the editor's brush work, replayed in order:
   `[op, x, y, z, r]`, with op 0 dig, 1 build, 2 smooth, in metres rounded to
   0.5. A mission keeps its brush work as a short list. Replay makes the same
   bytes on every device.
4. **Pockets**: small noise caves under the surface, per biome, from the
   seed (`pockets: false` turns them off).

### Asking the ground

`G.ter` keeps its name and gains three questions. Each call site picks the
one it means:

| Function | Answers | Used by |
|---|---|---|
| `ter.height(x, z)` | the top surface, under the sky (kept) | props and scenery at load, the editor's map, spectate, the HUD's altitude, spawns and respawns |
| `ter.groundBelow(x, y, z)` | the first surface going down from y | mech movement and landing, feet (from hip height, so a foot in a tunnel never snaps to its roof), debris, particles, entities settling after a dig |
| `ter.solid(x, y, z)` / `ter.ray(o, d, max)` | inside rock? where a ray meets rock? | shots, missiles, beams, sight (`sight.js` `blocked`), walls and ceilings for mechs, the editor's brush aim |

All three read the density by trilinear blend. The mesh comes from the same
density (surface nets: one vertex per crossed cell, one quad per crossed
edge), so the two can differ by up to a fraction of a cell. The invariant
changes to match:

> **Ground queries match the mesh.** `ter.groundBelow` and `ter.ray` read the
> same density the mesher reads, and lie within 0.6 m of the drawn triangles
> at 8 m cells. If you change the mesher or the blend, keep the test that
> samples both.

### Mechs on 3D ground

- **Standing:** `groundBelow(x, y + step, z)` with step = 1.5 m × scale. A
  rise higher than that is a wall.
- **Walls:** density sampled at knee and chest height, a radius ahead. A hit
  on one axis stops that axis, so a mech slides along a wall.
- **Ceilings:** jets stop at a solid sample above the head. A torso that would
  enter rock stops the walk, which is how a too-low tunnel turns you back.
- **Falling** is the existing air and landing path (`m.air`, `m.vy`, the
  landing feel). A fall caused by digging is the same as walking off a ledge.
- **Feet:** `restFoot` asks `groundBelow` from the hip. The gait's "feet
  never slide" rule holds: a dig under a planted foot makes that leg step,
  then plant on the new ground.
- **Slopes:** `gradeFactor` reads the same surface (`groundBelow` ahead and
  behind), so climbing works as today, quads included.

### Digging in play

Carving takes the smaller of the ground and the hole, so blasts give the same
ground whichever lands first. That makes sync cheap. In this spec, building
only happens in the editor, so play only ever carves.

**Battle mechs dig less than construction mechs.** The owner plans
construction-oriented mechs later. So how much something digs is its own
number, `dig` (a radius in metres) on each weapon in `data/weapons.js`. It is
not worked out from damage. Battle weapons stay in a modest band; construction
gear (below) gets the big numbers. A gun can roughen the ground and open a
bunker with patience. A construction mech reshapes it.

| Tier | Dig radius | On rock | Builds |
|---|---|---|---|
| Battle weapons | 0 to 4 m: dents and small craters | half | no |
| Big battle events (FUSION, deaths, cook-offs) | 6 to 7 m: a crater, one cell deep | half | no |
| Construction gear (later) | 8 to 16 m | full | yes |

How the sizes read at 8 m cells: under about 3 m the surface drops by up to a
metre (a **dent**); from about 6 m a corner clears and you get a **crater**.

The battle radii are balance numbers. The owner approved this table as the
starting point, to tweak after play:

| What blows up | Hit today | Dig radius | Reads as |
|---|---|---|---|
| PEASHOOTER burst | 0.8 × 6 | 0 | dust and scorch; a hose of fire shouldn't plane the map |
| AUTOCANNON shell | 11 | 2.5 m | a dent; a sustained stream gouges a groove |
| BIG BONKER slug | 20 | 3.5 m | a deep dent |
| THUNDERCLAP bolt | 14 | 4 m | a shallow crater |
| FIRECRACKERS, each missile | 2.6 × 6 | 2 m | a salvo leaves a rough ~5 m crater |
| LRM-10, each missile | 1.9 × 10 | 1.5 m | spread wide, so it peppers an area |
| a guided volley set off by hand | (10 m splash) | 4 m | a crater where you set it off |
| FUSION CANNON | | 6 m | a pit |
| a mech's death blast | | 5 m × scale, at most 7 m | WARDEN 7 m, PIPSQUEAK 4 m |
| ammunition cooking off in a wreck | | 7 m | the biggest hole a battle makes |
| lasers, TOASTER, punches | | 0 | scorch, as today |
| a stomp landing | | 0 (open question) | |

- **Cover lasts a fight against small guns.** Two mechs trading AUTOCANNON
  fire through a hill groove it within a minute, but it stays a hill. Big
  guns and deaths can break it. Digging through cover is a choice ("bring the
  big gun"), not background noise. The bench checks this (`bench-dig`).
- **Material:** soft ground digs at full radius. The rock band under each
  biome's surface digs at half for battle weapons, and at full for
  construction gear. Bedrock doesn't dig at all.
- **Scorches** sit on the dug surface at the blast point.
- **Props and structures** whose base loses its ground settle onto the new
  ground; a prop with nothing under it breaks.

### Falling ground

Ground that loses its support falls. Blow out the base of a ridge, an arch's
leg or the stem under a mesa's lip, and what was resting on it comes down.
Buildings are destroyable too (they are entities with hit points, as today),
so a fight can bring both down.

- **What counts as supported:** a solid cell is supported if a chain of solid
  cells, touching face to face, links it to bedrock. After each carve, the
  solid cells around the hole (its box plus one cell) are flood-filled. The
  fill stops at bedrock (supported), or at 4,096 cells (big enough to be
  part of the land, so supported). This bounds the cost at well under 1 ms.
- **What falls:** each unsupported island is cut out of the grid and becomes a
  falling chunk. It is meshed from its own cells by the same mesher and
  drawn as one moving piece. It drops straight down under gravity, with a
  slight tumble that is drawn only.
- **Where it lands:** the first ground below it, in the column under each of
  its cells. A small piece (under 8 cells, about 4,000 m³) shatters into
  debris and dust, like a blast's bits. A bigger one is stamped back into the
  grid where it lands, as a heap: a build, so the new ground is real.
- **The thunk:** a landing is a feel event scaled by the chunk's size:
  camera shake by distance, the landing squash on mechs nearby, sub-bass and
  dust ([13-thunk.md](13-thunk.md)).
- **What it hits:** a mech under a falling chunk takes a crush hit to the
  torso, and a prop or structure under it breaks. The crush numbers are
  balance (open question below). Default: 3 per cell, at most 40.
- **Mechs standing on it** fall with it, through the existing air and landing
  path, and land on (or with) the heap.
- **Buildings** keep the rule above: one whose ground falls away settles onto
  the new ground or breaks. They don't hold ground up in this spec.

### Construction mechs (later, not in this spec)

Their mechs, tools and names come after this spec, with their own. This spec
only makes room for them:
- **Data.** A weapon's `dig` (and a `build` radius, unused until then) lives
  in `data/weapons.js`. A construction tool is a weapon-slot item with
  `kind: 'tool'` (a drill, a scoop, a piler), so the mechlab, slots and
  sync carry it like any other.
- **Rock at full strength, and building in play.** These are what set
  construction gear apart, beyond size.
- **Sync, once building happens in play.** Carving alone gives the same ground
  in any order; carving mixed with building does not. So the `dig` message
  carries its operation from the start: `[op, x, y, z, r]`, op 0 carve, 1 build.
  The relay stamps each one with a room sequence number, and late joiners
  replay the list in that order. With carving only (this spec), the order is
  free; the stamp costs nothing and is there when building arrives.

### Sync

- **Single player:** the sim carves directly.
- **Who digs:** the client that owns the explosion decides it. That's the
  shooter's client for its own shots (shooter scores, as hits do), and the
  co-op host for enemies, turrets and wrecks. The owner carves at once and
  sends `dig`. Everyone else applies `dig` when it arrives; their local
  copy of a remote shell explodes but doesn't dig.
- **Message:** `dig { op, p: [x, y, z], r }`, op 0 carve, positions
  rounded to 0.25 m, r to 0.5 m. Batched with hits at 15 Hz as
  `digs: [[op, x, y, z, r], ...]`. The relay adds a room sequence number to
  each and echoes it back to everyone, the sender included.
- **Falls are data, in the relay's order.** Carving alone gives the same
  ground in any order; a fall (cells cut out here, stamped back there) does
  not. So the client that owns the triggering dig works the fall out and
  sends it as `fall { seq, cells, drop }`. That's the triggering dig's
  sequence number, the island's cells (run-length coded), and how far it
  dropped. Everyone applies digs and falls in the relay's sequence order.
  A client re-carves its own not-yet-echoed digs after applying a fall, so
  its predicted holes are never filled back in. Single player has no relay:
  the sim applies falls as they happen.
- **Late joiners:** the relay keeps each room's list of digs and falls, in
  sequence order, capped at 4,000 entries (a few hundred KB at most), and
  sends it in `welcome`. Replaying it in that order gives the same ground. A
  round's new map starts a new list. The server clamps r to the largest
  battle value (7 m), drops digs outside the map and any op but carve until
  construction gear exists, and caps a fall's cells at 4,096.
- **Version:** this is a network message change, so `PROTOCOL` goes to 21 and
  `docs/architecture.md` lists `dig`/`digs` and `fall`.

### The AI in canyons and caves

There is no pathfinding today: behaviours steer locally. Voxel ground keeps
that, and adds:
- **Feelers.** Wall and clearance samples ahead and to the sides, so a mech
  turns along a canyon wall instead of grinding into it.
- **A coarse nav grid.** 32 m squares, each marked open or blocked, plus the
  clearance height and slope. Squares are re-marked after digs near them, and
  A* runs on the grid for moves past a feeler's reach, such as finding the way
  around a mesa or into a tunnel. The grid is per match, built at load in
  about 2 ms.
- **Sight from above:** `blocked` already ray-tests the ground. With
  `ter.ray` it counts overhangs, so a foe on a mesa can't see under its own
  lip.

### Rendering

- **Chunks and culling:** each chunk is a buffer with its box, culled by the
  frustum and the fog's end, as the terrain chunks are now (#278).
- **Rebuilding:** dirty chunks rebuild nearest first in a worker. The main
  thread only sends a chunk's corners plus a one-cell margin (18³ bytes) and
  uploads the triangles that come back. If a browser has no worker, it falls
  back to the prototype's per-frame budget.
- **Level of detail:** chunks past 300 m are meshed from every other corner
  (16 m cells, about a quarter of the triangles). They're rebuilt when a dig
  touches them, like any chunk. This keeps a 1150 m fog inside the phone's
  triangle budget.
- **Colour:** flat tops by height (`low`, `mid`, `high`), steep faces as
  banded `rock`, and darker under cover (a column-top test). Lighting is
  baked per triangle, as the terrain is now.

### Mission data

```js
ground: {
  landmarks: [{ kind: 'tunnel', from: [80, 600, 40], to: [100, 900, 40], r: 15 }],
  strokes: [[0, 120.5, 44, -310, 10], [2, 118, 44, -305, 14]],
  pockets: true,
}
```

The block is optional; a mission without one is today's ground. `missionIO`
round-trips it, and `check` gains the three problems above.

## Code touchpoints

- `src/world/voxels.js` (new): the density grid; `makeGround(seed, def)`
  built from `makeTerrain`'s height, the landmarks, strokes and pockets;
  `sample`, `groundBelow`, `solid`, `ray`, `carve`, `build`, `smooth`; the
  column tops; the dirty-chunk set. No DOM.
- `src/world/mesher.js` (new): surface nets for one chunk (and its far,
  every-other-corner version). Pure, so it runs in the worker and in tests.
- `src/render/groundWorker.js` (new) and `src/render/scene.js`: chunk buffers,
  rebuilds through the worker with a budgeted fallback, LOD, culling. This
  replaces `uploadWorld`'s single terrain mesh and #278's runs.
- `src/world/terrain.js`: the height function stays, as the voxel base and
  for flat zones. `G.ter` becomes the voxel ground with `height` kept.
- `src/world/terrainMesh.js`: rocks and outposts become props or landmarks;
  the height mesh goes.
- `src/sim/mech.js`, `src/sim/gait.js`: standing, walls, ceilings, falling;
  feet from the hip.
- `src/sim/geom.js` (`rayTerrain` → `ter.ray`), `src/sim/sight.js`,
  `src/sim/effects.js`, `src/sim/particles.js`: the 3D questions.
- `src/sim/missiles.js` `blast`, `src/sim/combat.js` (rounds, deaths,
  wrecks): digs, scaled by the table.
- `src/sim/entities.js`: settle or break after a dig.
- `src/sim/ai/behaviours.js`, `src/sim/ai/nav.js` (new): feelers, the nav
  grid, A*.
- `src/net/protocol.js` (`PROTOCOL` 21, `dig`/`digs`), `src/net/client.js`,
  `src/net/coop.js`, `server/server.py` (the room's dig list, clamps).
- `src/ui/editor.js`, `src/ui/missionIO.js`: brushes, landmarks, slice,
  the `ground` block, problems.
- `docs/architecture.md`: invariants, protocol, module map.
- `scripts/perf.mjs`: new budgets on the bench; a `bench-dig` segment.

## Acceptance criteria

1. Every mission loads with its hills where they were: the top surface is
   within 2 m of today's `ter.height` at 1,000 sample points per mission,
   except where its landmarks change it.
2. On a reference phone, the bench's fight segment on the largest map holds
   the frame budget in spec 14, with no more than 70k ground triangles drawn.
3. A big blast (a fusion shot into a hill) never takes more than 2 ms of
   main-thread time; rebuilding happens in the worker. Shown by the bench's
   `bench-dig` segment and its timings.
4. Planted feet are within 0.6 m of the drawn ground. A foot under a tunnel
   roof stands on the tunnel floor (headless test).
5. A mech walks through an authored tunnel and stops at one too low for it.
   Its jets stop at a ceiling, and it drops when the ground under it is dug
   out (headless tests).
6. An overhang blocks a shot and a line of sight that its open top would not
   (headless tests).
7. Two clients that apply the same carves in different orders end with
   identical bytes; with falls in the mix, replaying the relay's order gives
   identical bytes (tests). In the smoke test, two arena clients and a late
   joiner end a fight, with a fall in it, holding the same ground hash.
8. The editor's brushes, landmarks and slice work with one finger and with a
   mouse. The `ground` block round-trips through export and import, and the
   problem strip catches the three new cases.
9. `npm run perf` passes with the new budgets. Each budget's reason is
   written above it, as the existing ones are.
10. `docs/architecture.md` states the new invariant and lists `dig`/`digs`
    and `fall` under PROTOCOL 21.
11. Blowing out an arch's leg drops the rest of the arch. The pieces under 8
    cells shatter, and the larger ones land as heaps in the grid, with the
    landing's thunk. A mech under one takes the crush hit; a mech standing
    on one rides it down. The flood fill costs under 1 ms on the bench's
    `bench-dig` segment (headless tests and the bench).

## Tests

- `test/voxels.test.js`:
  - generation matches today's heights (criterion 1);
  - carving is order-free, and bedrock and edges hold;
  - stroke replay is deterministic;
  - `groundBelow` under an overhang;
  - `ray` against an arch.
- `test/mesher.test.js`:
  - every triangle within 0.6 m of the density's surface;
  - a closed chunk has no holes at its borders;
  - the far version stays inside its near version's box.
- `test/voxelWalk.test.js`: tunnel through and too low, walls slide,
  ceilings, digging under a mech, feet in a tunnel.
- `test/dig.test.js`: the radius table, materials, scorch placement, props
  settling.
- `test/falls.test.js`: an arch losing a leg falls; supported ground
  doesn't; the 4,096-cell limit counts as supported; shatter versus heap by
  size; the crush hit; a rider falls with it.
- `test/digSync.test.js`: the owner digs and others apply; dig lists in any
  order; relay clamps (also in `server/test_server.py`).
- `test/nav.test.js`: a path around a mesa and into a tunnel; re-marking
  after a dig.
- `test/missionIO.test.js`: the `ground` block round trip and the three
  problems.
- Smoke: a tunnel mission played through; an arena fight with a late joiner,
  comparing ground hashes.
- Playtest (phone): walk the canyon and tunnel, dig under a foe, fight in the
  bench, and read the frame time.

## Performance

| | Today (height map, #278) | Voxel ground (estimate from the prototype) |
|---|---|---|
| Ground memory | ~37 KB | ~3 MB |
| Ground triangles drawn | 11k–16k | 40k–70k with LOD (the prototype drew 46k in a third of the area at 60 fps on the owner's phone) |
| Load | ~20 ms | ~600 ms for 648 chunks, nearest first in the worker; the briefing screen covers it |
| A blast | a scorch | 1–4 chunks rebuilt in the worker; main thread under 2 ms |
| Shots and sight | one 4 m height march | a density march at 4 m with bisection, about the same |

The prototype's 10 ms worst chunk on a phone is why the worker is part of the
spec, not an option.

## Open questions

- **Dig radii.** Decided: the battle table above, to tweak after play.
  Battle mechs dig; construction mechs (later) dig more.
- **Do lasers dig?** Default: no; they scorch.
- **Unsupported ground.** Decided: it falls (see Falling ground).
- **Crush damage from a falling chunk** (balance, the owner's). Default: 3
  per cell to the torso, at most 40, tried in the bench first.
- **A stomp landing dents the ground?** Default: no; a 2 m dent under the
  feet would add thunk, and is cheap if the owner wants it.
- **Damage from falling into a dug hole.** Default: none beyond the landing
  feel. A leg hit on long falls would be a balance issue.
- **Digging in the arena.** Default: on, with no cap.
- **Caves in the campaign.** Default: none until the missions are reworked in
  the editor (spec 15's open question). This spec only makes them possible.
- **WebAssembly for the mesher, if JavaScript is too slow.** Default: no.
  The game stays JavaScript: its own JS is ~2-3.5 ms of a 16.6 ms frame,
  and what a phone runs out of is draws, fill and garbage, which no language
  changes. The one hot loop this spec adds is the chunk mesher (surface
  nets: pure arithmetic over a byte grid, ~200 lines, no side effects), and
  it runs in the worker. Revisit only if, on a reference phone, the bench's
  `bench-dig` segment shows a chunk costing more than 10 ms in the worker
  (blasts visibly lag behind their craters), or the fallback path takes more
  than the 2 ms main-thread budget. Then port just `mesher.js` to
  WebAssembly, keep the JavaScript one as the reference and the fallback,
  test that both give the same triangles, and compare them on the bench.
  It would be the first build step beyond esbuild, so it needs the owner's
  yes (`docs/architecture.md` limits the tooling).
- **Spec 15's "height painting".** Superseded by this spec. Its default
  ("no") is replaced by sculpting here.

## Issues, in order (filed as #281 to #286)

1. **The ground as voxels.** #281. `voxels.js`, `mesher.js`, the worker, chunks,
   LOD, colour; `G.ter` with `height` kept. Every mission looks right and
   plays as today. Budgets on the bench.
2. **Mechs and shots on 3D ground.** #282. Standing, walls, ceilings, falling, feet
   from the hip; `ter.ray` for shots, missiles, beams and sight; debris and
   particles; the invariant rewritten.
3. **Digging and its sync.** #283. The radius table, materials, scorches, props
   and structures settling; `dig`/`digs`, the relay's sequence and list,
   PROTOCOL 21; the smoke test with a late joiner.
4. **Falling ground.** #284. The support fill, falling chunks, shatter or heap,
   the landing thunk, crush hits and riders; `fall` in the relay's order.
5. **The AI in canyons and caves.** #285. Feelers, clearance, the nav grid and A*,
   re-marking after digs and falls.
6. **Sculpting in the editor.** #286. Brushes, landmarks, slice, the `ground`
   block in `missionIO`, the new problems.
