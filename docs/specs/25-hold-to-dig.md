# Hold to dig

| | |
|---|---|
| Status | parts 1 and 2 built (#360 and the clods; spec merged in #359; the owner, 2026-10-28: "the punch to dig mechanic gets old fast and the way the polygons change isn't very satisfying"; asked for holding a button to dig, and for digging to look and feel better without costing too much; then: "It should get its own dig button. We will have specialized construction mechs for different tasks"; then: "No punch for the digger. Also its arms should spin when digging.") |
| Milestone | M12 (proposed) |
| Size | L, split in three: the tool button and the scoop; the sliding face and the clods; the bucket's load and the pour |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md) (the ground, digs, chunks); [20-build-and-fight.md](20-build-and-fight.md) and [21-mining.md](21-mining.md) (the digger, ore, dirt, DUMP); [13-thunk.md](13-thunk.md) (feel) |
| Touch parity | DIG is a button you hold, like a gun's |

## Summary

Digging stops being a punch. The digger gets a **DIG** button: hold it and
its arms spin like a wheel, each bucket biting the ground as it comes
round, scoop after scoop. Each scoop
is felt. The face slides back as you dig instead of popping, and chunky clods
tumble out, roll and then sink into the ground. DIG is the first **tool**:
the button is the same for every construction mech, and what it does is the
chassis's own.

## Player experience

### Digging

- **Hold DIG** and the arms **spin**:
  - both arms turn full circles at the shoulders, half a turn apart, like a
    paddle wheel;
  - each time a bucket comes round into the ground it bites: one **scoop**
    every 0.4 s for as long as you hold it;
  - they get up to speed in a moment;
  - let go and they finish their turn and stop, buckets down;
  - a tap is one turn of a bucket: one scoop.
- **Each scoop:**
  - a bucket comes round and bites;
  - a small thunk: the camera nudges, there's a short sub-bass knock, and on
    a phone a tick;
  - the face moves back a little;
  - four to six clods come out of it;
  - ore and dirt come in, as now.
- **While you hold it:** a low grinding rumble under the scoops. It's
  brighter and clinks when the bucket is in a seam.
- **The face slides.** The ground moves back smoothly as you dig, and doesn't
  jump in big steps.
- **Clods:**
  - small, flat-shaded lumps in the ground's own colours: soil, rock, or a
    seam's colour;
  - they tumble out, bounce once and come to rest in front of the face;
  - after a few seconds they sink into the ground and are gone.
  - You walk through them. They're for looking at, not for standing on.
- **Nothing in reach:** the arms spin in the air, and the line under the
  crosshair says `NOTHING TO DIG`.
- **Hopper full:** it still digs (dirt still comes in), and says
  `HOPPER FULL` as now.
- **At one of your sites:** holding DIG builds it, a bit each scoop, instead
  of digging (spec 23). `NEEDS ORE` when the work has caught up with the
  ore.

### The bucket's load and DUMP

- **The bucket fills:** the dirt in it rises in a heap you can see, from
  empty to six piles' worth.
- **DUMP pours:** a stream of clods for half a second, and the pile grows
  where they land, instead of popping up whole.

### The buttons (a digger)

The primary button digs. DUMP moves to the fourth button, which a digger
didn't use (it has no fusion cannon).

| | primary (DIG) | BUILD | NEXT | DUMP |
|---|---|---|---|---|
| touch | the main fire button | missile's | ballistic's | fusion's |
| keyboard and mouse | left button, `1` | `Space`, `3` | right button, `2` | `G`, `4` |
| gamepad | RT | LT | RB | LB |

- **No punch.** A digger can't punch. `E`, the touch double tap and the
  right stick's click do nothing in it, and the fist never shows.
- **By the crosshair:** where other mechs show a fist and `PUNCH` with
  something in reach, a digger with ground in reach shows `DIG`.

New text, in full: `DIG` (the button, and by the crosshair) ·
`NOTHING TO DIG`.

## Design

### The tool

- **`ch.tool`** in `data/chassis.js`: the digger's is `'dig'`. A chassis with
  a tool has its primary button run the tool instead of firing.
- **`data/tools.js`** (new) holds each tool's numbers. Its display name lives
  in `names.js` `NAMES.tools`, so the button reads `DIG` and later tools
  bring their own.
- The sim sees one input, `input.tool` (held). `update.js` hands it to
  `sim/tools.js` `stepTool(G, m, held, dt)`, which runs the chassis's tool.
- A parked digger at work (`miner.js`) holds the same input, and the same
  scoop does the work.

### The spin

- **`m.spin`:** `{ a, w }`, the arms' angle and how fast they turn.
  - Held, `w` eases up to a full turn every `TOOL.dig.turn` (0.8 s) within
    `TOOL.dig.spinUp` (0.15 s).
  - Let go, the arms keep turning to their rest angle (buckets down) and
    stop.
- **The two arms are half a turn apart,** so a bucket comes round every
  0.4 s. **The scoop fires as a bucket passes its bite angle** (low and
  ahead), so the knock, the dirt and the picture land together.
- **Drawn** in `scene.js`: a chassis with the dig tool sets each arm's
  shoulder angle from `m.spin.a` (and half a turn on for the other arm),
  instead of from the aim and the melee pose. The wheel turns in the torso's
  pitch, so it follows where you look.
- **A tap** gives one bucket's pass: the arms turn until the next bite
  angle, scoop, then come to rest.

### The scoop

`sim/tools.js` `scoop(G, m)`, as each bucket passes its bite angle while
held (every `TOOL.dig.every` seconds at full speed):

1. **Aim** as the bite does now (`melee.js` `bucketBite`'s rays, moved here):
   level first (a face), then tipped down (a pit). Parked diggers look only
   ahead.
2. **Carve** with `dig()` (spec 18), so the network, falls and
   `G.pendingDigs` stay as they are. The scoop is centred `TOOL.dig.into`
   metres past the surface, radius `TOOL.dig.r`. Each scoop at the same face
   goes `TOOL.dig.step` further in than the last, so held scoops eat back
   into the face instead of re-cutting the same hole. The run of scoops
   resets when the aim moves more than `TOOL.dig.drift` metres.
3. **Count** ore and dirt as `bite()` does now: corners turned to air,
   seams, and dirt into the bucket. Only the amounts per scoop change.
4. **Feel:** `feel(G, 'scoop', …)`, a new row in the feel table: smaller
   than `punch`, with a camera nudge, a short bass knock and a tick.
5. **Clods:** `TOOL.dig.clods` of them, coloured by what was cut (§ Clods).

**The pace stays.** A scoop every 0.4 s, sized so a held DIG takes ore and
dirt out at today's rate: one 6 m bite per 1.2 s cycle. Any change to that
rate is a balance issue. The numbers below are the starting point, set by
measuring against today's bite in the headless test.

| | value | why |
|---|---|---|
| `turn` | 0.8 s | a full turn of the arms at speed |
| `every` | 0.4 s | half a turn: two buckets, three scoops in the time of one punch cycle |
| `spinUp` | 0.15 s | up to speed |
| `r` | 4.5 m | a smaller bite, three times as often |
| `into` | 2 m | centred just past the surface, so it reaches the corners behind |
| `step` | 0.8 m | how far each scoop goes further in |
| `drift` | 3 m | aim moved this far: a new face |
| `clods` | 4 to 6 | |
| `heat` | today's bite heat ÷ 3 per scoop | |

### Why the face slides

Each corner of the ground holds a density (spec 18), and the mesher places
the surface where it crosses the middle, smoothly between corners. A carve
lowers densities toward the hole's edge without needing to empty a corner.
So small scoops, each a bit further in, move the surface back smoothly. It
changes no rule of the ground: feet, ground queries, falls and the network
see one 8 m grid as now. The one cost is rebuilding the chunk more often
(§ Performance).

### Clods

- **`G.clods`**, beside `G.debris`. Each clod has a position, velocity, spin,
  size (0.6 to 1.4 m), colour, life and a landed flag.
- **They tumble, bounce once and land** on `G.ter.groundBelow`, the way
  `stepDebris` does it. They lie for `TOOL.clodLife` (4 s), then sink over
  1 s and are removed.
- **They're only for looking at:** no collision with mechs, never part of
  the ground, never sent over the network. A clod under a fresh dig drops
  onto the new ground, as debris does now.
- **Capped** at `TOOL.clodMax` (60); the oldest goes first.
- **Their shape:** a few lumpy flat-shaded polyhedra (8 to 12 faces) built
  once in `mesh/props.js`. They're drawn instanced like props, so 60 clods
  are one draw call per shape.
- **Their colours:** the ground's soil and rock from the palette, or the
  seam's colour, by what the scoop cut.

### The bucket's load

- `mechParts.js`: the digger's bucket gets a heap mesh inside it, scaled
  with `m.dirt / CONSTRUCT.dirtMax`. A scale on the part, so nothing is
  rebuilt.
- **DUMP:** `dump()` starts a pour (`m.pour`, 0.5 s). The clods stream from
  the bucket, and the pile is stamped (`G.ter.pile`, as now) when the pour
  ends. Same pile, same cost; only the timing and the look change.

### Building with DIG

- A scoop with one of your own sites in reach does the site's work instead
  of digging: `buildSwing`, scaled so a held DIG builds at today's pace (a
  third of a swing per scoop, or swings per scoop counted to match).
- `PLACE.swings` stays as it is.

### Online

- The base and diggers are single player today (spec 20), so nothing goes
  over the network yet.
- The scoop's digs go through `dig()`, which already syncs.
- A remote digger's scoop animation would need a state flag and a
  `PROTOCOL` bump. That waits for a spec that puts diggers online.

### Edge cases

- **SWAP or the command view mid-scoop:** the hold ends; the arms finish
  their turn and stop.
- **An arm shot off:** the other still spins, so a scoop every 0.8 s. With
  both gone, it can't dig.
- **Heat:** a scoop adds its heat. At shutdown the bucket stops as the guns
  do.
- **A scoop that frees an overhang:** it falls as any dig's does (spec 18).
- **Bedrock:** the bucket scrapes: a dull clank, no clods, and
  `NOTHING TO DIG` after three scoops that cut nothing.

## Code touchpoints

- `src/data/tools.js` (new): `TOOL.dig` and the clods' numbers.
- `src/data/chassis.js`: `tool: 'dig'` on the digger, which replaces
  `tools: true`; everything that asks `ch.tools` asks `ch.tool`. The
  digger's `melee: BUCKET_MELEE` goes.
- `src/data/names.js`: `NAMES.tools.dig = 'DIG'`.
- `src/data/feel.js`: the `scoop` row.
- `src/sim/tools.js` (new): `stepTool`, `scoop`, the aim (moved from
  `melee.js` `bucketBite`), and the run of scoops into a face.
- `src/sim/melee.js`: the bucket goes. The digger has no `melee`, so
  `canPunch` is false for it, and finding your own sites moves to
  `sim/tools.js`.
- `src/render/scene.js`: the digger's arms turn with `m.spin`.
- `src/sim/dig.js`: `bite` takes a radius; `dump` pours.
- `src/sim/effects.js`: `G.clods`, `spawnClods` and `stepClods`.
- `src/sim/miner.js`: parked diggers hold the tool instead of punching.
- `src/sim/update.js`: `input.tool` to `stepTool`. DUMP moves to the
  fusion button.
- `src/input/input.js`, `src/input/gamepad.js`: the primary button is DIG
  for a chassis with a tool, the touch button labels, and the controls
  lines.
- `src/mesh/props.js`: the clod shapes. `src/render/scene.js` draws them
  instanced.
- `src/mesh/mechParts.js`: the heap in the bucket.
- `src/audio/sfx.js`: the scoop's knock, the grind loop and the seam's
  clink.
- `src/render/hud.js`: `DIG` by the crosshair with ground in reach, and
  `NOTHING TO DIG`.

## Acceptance criteria

1. Holding DIG spins the arms. At a face they scoop every 0.4 s, each scoop
   as a bucket comes round, until you let go. Then they stop, buckets down.
   A tap is one scoop.
2. Over 30 s of held DIG, ore and dirt come in within 10% of today's punch
   at full pace, at the same face.
3. The face moves back smoothly. Screenshots every scoop show it creep, not
   jump.
4. Each scoop throws clods in the ground's colours, or a seam's. They land,
   lie, sink and are gone, and never more than 60 are alive.
5. A digger has no punch. DUMP is on the fourth button and pours.
6. Holding DIG at your own site builds it at today's pace.
7. Parked diggers dig and build with scoops, as before.
8. On a phone held sideways: DIG under the right thumb, held while the left
   thumb walks.
9. The frame budget holds while digging on the phone budget (§ Performance).

## Tests

- `test/tools.test.js` (headless):
  - A held scoop's rate.
  - Ore and dirt per 30 s against today's bite at the same face.
  - The face's run of scoops and its reset.
  - `NOTHING TO DIG`.
  - Building a site with DIG.
  - The clod cap and life.
- Update `test/miner.test.js`, `test/sites.test.js` and the digger's tests:
  the bucket digs by scoop, and a digger has no punch.
- `test/tools.test.js` also: the spin's speed and rest, and a scoop at each
  bucket's pass.
- Smoke: the digger run holds the primary button for 3 s at the mesa and
  checks ore came in and clods are alive. The touch run holds DIG the same
  way.
- `npm run perf`: a new bench, `bench-scoop`: 10 s of held DIG, frame time
  and chunk rebuilds.

## Performance

- **Chunk rebuilds:** a held DIG dirties one or two chunks two and a half
  times a second. The mesher already runs in the worker (spec 18); today a
  punch dirties them once every 1.2 s. If a phone can't keep up, scoops
  queue their carve and the chunk rebuilds at most `TOOL.rebuildHz` (4) times
  a second. The face still slides, in slightly bigger steps.
- **Clods:** at most 60, instanced, a few hundred triangles in one or two
  draw calls. Their step is a short loop over the array.
- The budget is spec 14's phone frame time, measured with `bench-scoop`.

## Build order

1. **The tool button and the scoop:**
   - `ch.tool`, `data/tools.js`, `sim/tools.js` and the scoop at today's
     pace;
   - DIG on the primary button and DUMP on the fourth;
   - the arms spin, and the digger's punch goes;
   - parked diggers and sites use the scoop;
   - the feel row and the sounds.
2. **The sliding face and the clods:** the run of scoops into a face, the
   clods (sim, shapes, drawing), and `bench-scoop`.
3. **The bucket's load and the pour:** the heap in the bucket, and DUMP
   pouring.

## As built

### Part 1: the tool button, the spin and the scoop

- **The tool:**
  - `ch.tool: 'dig'` on the digger replaces `tools: true`. The digger has
    no `melee`, and `canPunch` is false for a chassis with a tool.
  - `data/tools.js` holds `TOOL.dig`, and `NAMES.tools.dig` is `DIG`.
  - `update.js` sets `P.toolHold` from the primary button. A parked
    digger's job sets its own (`miner.js`).
  - `sim/tools.js` `stepTool` runs every tool mech each frame.
- **The spin** is as the spec says: 0.8 s a turn, the right arm setting off
  as the left passes half a turn, and a scoop as a bucket passes 1 rad
  forward of hanging down. One rule the spec didn't have: an arm finishing
  its turn keeps spinning up, so a tap is a whole bucket's pass at speed.
  `scene.js` turns the shoulders forward with `m.spin`.
- **The scoop: a run into the face.** The spec's single small scoops didn't
  work on the 8 m ground. A point can be up to about 7 m from the nearest
  corner, so a scoop much smaller than that often turns nothing to air, and
  a slope's foot never dug. Instead each scoop belongs to a run:
  - the first is centred `into` (2 m) past the surface the aim finds,
    `r0` (3 m) across;
  - each next one keeps that centre and reaches `grow` (1 m) further, for
    `steps` (6) scoops, so the last ones always take a corner;
  - the run starts again when it's done, the aim's line leaves the centre
    by more than `drift` (4 m), the digger moves, or the aim finds no
    ground.
  - The hole widens one scoop at a time, which part 2's sliding face builds
    on.
- **The pace.** Over 80 seeds at the range's mesa face, held DIG brings in
  2% more ore than the punch did (`test/tools.test.js` keeps it within 10%).
  - **Dirt comes in at about 70% of the punch's.** The punch's big bite
    took the soft top (no ore) as well as rock; the scoops cut deeper rock.
    So the same ore is fewer corners, and fewer corners is less dirt.
  - Matching ore and dirt both would need a change to `dirtPerCorner`,
    which is a balance number, so it's left to a balance issue.
- **Sites:** a scoop with your own site in reach (35° either side, 11 m)
  builds instead of digging; three scoops make one swing of work
  (`perSwing`), the punch's pace. `buildSwing` takes a `work` flag, so the
  scoops in between only say `BUILDING` or `NEEDS ORE`.
- **Parked diggers** hold DIG square on to their site. Three dry scoops in a
  row (`dry`) count as one dry bite did before.
- **The buttons:** DIG on the energy button (`DIG` on touch, `LMB 1  DIG`
  on the desktop panel, lit while held), and DUMP on the fusion button
  (`G 4  DIRT`). `DIG` shows by the crosshair with ground or a site in reach
  (`G.digReady`).
- **Feel and sound:** the `scoop` feel row, `sfx.scoop` (a crunch and a low
  knock, a clink in a seam), and `dig_loop`: the servo's clip, low, with
  the arms' speed.
- **Tests:** `test/tools.test.js`. The digger, sites, miner, command, dirt
  and voxel-walk tests now dig by holding DIG. Smoke: the digger run holds
  `1`, FIRST FACTORY digs and builds with `1` held, and the touch run holds
  DIG with a finger.
- **Not yet (part 3):** the bucket's load and the pour.

### Part 2: the sliding face and the clods

- **The sliding face** came with part 1's runs: each scoop of a run reaches
  further from the same centre, so the hole widens scoop by scoop.
- **Clods are particles,** a new kind `clod` in `sim/particles.js`, not a
  `G.clods` list of their own.
  - So they're drawn with every other effect, instanced and coloured per
    instance, and add no draws.
  - The particle step gives them their rules: they fly and bounce off the
    ground as debris does. Under about 2.4 m/s after a bounce they're at
    rest and stop turning; dig the ground from under one and it falls again.
    Over their last second (`CLOD_SINK`) they sink and are gone.
  - Their shape, `clod` in `mesh/effects.js`, is a lopsided octahedron:
    eight facets.
- **`spawnClods`** (`sim/effects.js`): a scoop throws 4 to 6 (`TOOL.dig.clods`)
  out of the face toward the digger and up, 0.6 to 1.4 m.
  - Colour: the seam's, the palette's rock, or its low ground, by what the
    run last cut (`bite` notes `m.biteRock`), each a little lighter or darker.
  - They live 3.5 to 4.5 s, shorter than the spec's 4 s lying plus 1 s
    sinking, so a held DIG (some 12 a second) settles near 50 at once.
  - Past `CLOD_MAX` (60) not yet sinking, the oldest start to sink.
- **`npm run perf` scene `scoop`:** the range's mesa, DIG held 10 s at the
  face: 15 draws (16 at most), 31.9k triangles, 45 KB a frame, and 53
  particles at most.
- **Tests:** `test/tools.test.js` checks the clods' colours, that they land
  and lie, that they're gone in time, and the cap, alone and with DIG held.
  Smoke: the digger run sees clods alive.

## Room to grow: other tools

The tool button is the same for every construction mech; each chassis
brings its own. Some candidates, each its own spec, with names the owner's:

- a mech that **pushes**: holds a blade down and shoves dirt and clods into
  berms and ramps, and levels ground for building;
- a mech that **drills**: slow in soft ground, fast in rock, deep narrow
  shafts to seams;
- a mech that **builds up**: pours dirt from its hopper into walls and
  ramps, the opposite of digging.

## Open questions

- **A finer ground near the dig.** Picked by the owner (2026-10-29): it's
  [27-fine-dig.md](27-fine-dig.md). The literal version of "higher poly that
  settles": a finer grid in a patch round the face that later merges back to
  8 m cells. Default: not now. It touches the feet rule, falls and the
  network, and the settle would move ground under anything standing on it.
  Revisit after playing the sliding face and the clods.
- **Clods that matter.** Default: only for looking at. They could become
  dirt you can scoop up again, or pile into a berm if enough land in one
  place.
