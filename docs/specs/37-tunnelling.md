# Tunnelling in

| | |
|---|---|
| Status | in progress: part 1 built (navigation). Approved with the defaults (the owner merged it, then "Go ahead", 2026-11-04); first asked for 2026-11-03: "Tunneling into an enemy base could be a fun mechanic. You would need to be able to navigate while underground" |
| Milestone | M15 (proposed) |
| Size | M, in four parts (navigation; tunnels on the map; undermining; being heard) |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md), [22-command-view.md](22-command-view.md), [25-hold-to-dig.md](25-hold-to-dig.md), [33-production.md](33-production.md) (foe bases) |
| Touch parity | every readout is on the HUD as it is on desktop; MARK is a button on the map's bar, tapped like the rest |

## Summary

A digger can reach a base without walking through its front door: dig in
out of sight, follow a mark through the rock, and come up under the walls,
or under a building, which drops into the hole. This gives digging by hand
a job the command view can't do for you (the owner, 2026-11-03: is digging
by hand fun enough to do over automating it?), and it keeps the cockpit
the place where the ground is shaped.

## What's there today

- Digging goes down and sideways; a parked digger keeps to the face it was
  given (`sim/miner.js`). A tunnel stays a tunnel: the ground is voxels
  (spec 18) and unsupported rock falls (`dig.js`).
- Foes can't see through ground: `sim/sight.js` `blocked` rays the
  terrain, so a mech underground is already out of sight.
- From the cockpit, the eye is kept out of rock (`render/scene.js`), so the
  view underground is clean: rock walls, the bucket, dark.
- **Missing:** knowing where you are and where the target is; any record
  of a tunnel on the map; buildings reacting to the ground under them
  (today a building over a hole simply stands on air; only vehicles follow
  the ground down, `entities.js`).

## Player experience

You drive a digger to a spot out of the foe's sight, open the map, tap
their silo and press **MARK**. Back in the cockpit, a marker sits on the
HUD over the silo, through the hills: `MARK 410 M`. You dig down. The HUD
reads `DEPTH 9 M`. You dig toward the mark. As you pass under the base,
outlines of what's above show through the rock: the wall, a TOWER, the
silo. Under the silo, you dig up into its footing. The ground gives, the
silo drops into the hole and tips over with a thunk, smoking. Or you come
up behind the wall instead and the fight starts on your terms.

On the map, your tunnels are thin lines under the ground, so you can see
the route you took and plan the next one.

### New text (for the tone check)

- HUD: `DEPTH 9 M`, `MARK 410 m` (the distance as every HUD marker writes it),
  `SURFACE 3 M` (the last only while digging up, under 4 m to go).
- Map bar: `MARK` (and `UNMARK` on what's marked).
- Voice (deadpan, once each): `Mark set.` when marking; `It fell over.` when
  a building you undermined comes down (a joke after the fact).
- Part 4: `They heard you.` when a foe starts hunting for you underground.

## Design

### Part 1: navigation

- **Underground** means ground above the cab: `G.ter.solid` at the cab's
  top plus `UNDER.above` (1 m). Only then do DEPTH and the outlines show,
  so the HUD stays as it is on the surface.
- **DEPTH** is metres from the cab's top to the ground's surface straight
  above (the first air going up, `groundAbove`), rounded to whole metres,
  under the radar like the heat readout.
- **SURFACE** replaces DEPTH while the bucket is aimed upward and under
  `UNDER.surface` (4 m) is left: a warning, flat, in amber.
- **MARK**: in the command view, with one thing picked (a foe's or anyone's
  building, a foe mech, or a spot on the ground with nothing picked and a
  long press), the bar shows `MARK`. One mark at a time; marking again
  moves it; `UNMARK` clears it. It's `G.mark = { x, z, id }`: a thing (it
  follows the thing, and goes when the thing does) or a spot. The HUD draws
  it with the existing marker code (`hud.js drawMarker`/`edgePoint`, as the
  nav points), through ground, with `MARK` and the flat distance.
- **What's above**: underground, every structure and mech within
  `UNDER.sense` (60 m) is drawn as an outline through the rock: its box's
  edges in the HUD's colour (foes in red), no fill. It's how you know
  you're under the wall, not the silo.
- Keys and pads: nothing new in the cockpit; MARK is on the map's bar
  (keys 1–9 as every bar button, spec 22).

#### As built (part 1)

- `sim/under.js`: `depthOf` is the top surface (`G.ter.height`) over the
  cab's top (`cabTop`); `underground` at `UNDER.above` or more;
  `nearSurface` when the cockpit's pitch is over `UNDER.up` (0.15 rad).
  `setMark`/`clearMark`/`markAt` (`G.mark`, cleared each match);
  `above` lists the boxes for the outlines.
- MARK is on the map's bar with nothing picked: press it, then tap a foe,
  anyone's building, or the ground (a tap stands in for the long press).
  With a mark set the button reads `UNMARK`. The map shows the mark as a
  white ring with `MARK`.
- On the HUD the mark is white (apart from the objectives' amber and green
  in every colour mode); DEPTH sits over the ring; outlines are cut to the
  screen as the map's lines are (#412).

### Part 2: tunnels on the map

- While a crew mech is underground, its position goes into a trail every
  `UNDER.trail` (6 m) moved, `G.tunnels = [[x, y, z], ...]` per mech,
  one polyline each, broken where it surfaces. At most `UNDER.points`
  (4,000) points in all; past that, the oldest go.
- The map view draws them as thin lines (dashed, cut to the screen like
  every map line since #412), under the markers; a crew mech underground
  has its chevron drawn hollow.
- A tunnel dug before a save isn't kept (no save mid-mission today).

### Part 3: undermining

- After any dig, structures whose footprint is within `UNDER.check` (12 m)
  of it are tested: the ground under the footprint's corners and middle
  (five points, just below its base). If fewer than `UNDER.hold` (3 of 5)
  are solid, it **falls**:
  - it drops to the ground below its middle (`groundBelow`) and tips over
    (`e.fall`, as a punch fells one, toward the side with least support);
  - it takes `UNDER.dropHp` (40%) of its full hp, plus `UNDER.perM` (5%)
    for every metre it fell, at most all of it;
  - the thunk: `feel(G, 'land')` scaled by its size, dust, the camera
    shake if you're within 40 m (spec 13);
  - a building of the base's that falls is DOWN (spec 33), so it can be
    stolen like any knocked-down building.
- Scenery with `hp: Infinity` doesn't fall (it's decoration).
- **Your own buildings fall too.** The map shows `UNDER YOUR SILO` in
  amber on a crew digger whose site is under a building of yours, so
  automation can't quietly sink the base (open question 2).
- Arena and co-op: digs are already sent and confirmed (spec 18); a fall
  is decided where the dig is confirmed (the host in co-op), and sent as
  the building's state like any other knock-down. No new message: if one
  turns out to be needed, `PROTOCOL` goes up with it.

### Part 4: being heard

- A digger digging underground makes noise: foes within `UNDER.hear`
  (120 m) of the bucket hear it, with the point blurred by `UNDER.blur`
  (25 m).
- What a foe does with it goes by difficulty (`DIFF`): EASY ignores it;
  NORMAL turns toward it and is aware; HARD sends the nearest foe to stand
  over the blurred point and wait for you to come up (`They heard you.`,
  once per tunnel).
- Foe diggers tunnelling into *your* base are **not** in this spec (open
  question 4).

### Numbers (`src/data/construct.js` `UNDER`, starting values to tune in play)

| key | value | what |
|---|---|---|
| `above` | 1 m | rock over the cab that counts as underground |
| `surface` | 4 m | SURFACE shows under this much to go, digging up |
| `sense` | 60 m | what's above shows as outlines within this |
| `trail` | 6 m | a tunnel point every this many metres |
| `points` | 4,000 | tunnel points kept in all |
| `check` | 12 m | buildings this near a dig are tested for support |
| `hold` | 3 of 5 | footprint points that must stay solid |
| `dropHp` | 40% | of full hp, taken when a building falls |
| `perM` | 5% | more per metre fallen |
| `hear` | 120 m | foes this near a digger at work underground hear it |
| `blur` | 25 m | how far off what they hear can be |

These are new numbers, so this spec is the balance issue for them.

## Code touchpoints

- `src/data/construct.js`: `UNDER`.
- `src/sim/under.js` (new): `underground(G, m)`, `depthOf(G, m)`,
  `stepTunnels(G)` (the trails), `undermine(G, at, r)` (the support test
  and the fall), `heard(G, m)` (part 4). Pure sim, with a headless test.
- `src/sim/dig.js`: after `confirmDig`, `undermine` round the dig.
- `src/sim/entities.js`: a fallen building's drop (its `y` to the ground
  below, then `e.fall`).
- `src/world/voxels.js`: `groundAbove(x, y, z)` if it isn't there (the
  first air going up).
- `src/render/hud.js`: DEPTH / SURFACE, the MARK marker, the outlines.
- `src/ui/command.js`: MARK / UNMARK on the bar; `G.mark`; tunnel lines;
  hollow chevrons; `UNDER YOUR SILO`.
- `src/sim/ai/*`: part 4's hearing, by difficulty.
- `docs/architecture.md`: `under.js` in the module list.

## Acceptance criteria

1. Underground, the HUD shows DEPTH; on the surface it doesn't.
2. A mark set on the map shows on the HUD through the ground, with its
   distance, and goes when the marked thing does.
3. Within 60 m underground, structures and mechs above show as outlines.
4. The map draws a crew digger's tunnel as a line where it dug.
5. Digging out the ground under most of a building's footprint drops it,
   tips it and damages it; scenery doesn't fall.
6. On NORMAL a foe near a digger at work underground turns toward it; on
   HARD one goes to wait over it.
7. Each part works on a phone held sideways (checked on a real phone).

## Tests

- `under.test.js`: underground and depth from the voxels; the trail adds
  a point every 6 m and breaks on surfacing; the cap; `undermine` drops a
  building with 2 of 5 points solid and not with 3; the damage by metres
  fallen; scenery stays.
- `objectives.test.js` (or `raid.test.js`): a building dropped by
  undermining counts as destroyed or DOWN as a punch's fall does.
- `ai` tests for part 4 by difficulty.
- Smoke: `tunnel`: mark a foe silo from the map, dig toward it, see DEPTH
  and MARK on the HUD, undermine it, see it fall.

## Performance

- Underground checks: one or two voxel lookups a frame for the player.
- Outlines: a few dozen line segments while underground.
- Undermining: five voxel lookups per building within 12 m, only when a
  dig happens.
- Tunnel lines: at most 4,000 points on the map, cut to the screen.

## Build order

1. **Navigation:** underground, DEPTH and SURFACE, MARK, what's above.
2. **Tunnels on the map.**
3. **Undermining.**
4. **Being heard** (by difficulty).

One PR each.

## Open questions

1. **Should a building drop at all, or only take damage?** Dropping and
   tipping is the thunk; damage alone is quieter. *Default: drop, tip and
   damage.*
2. **Your own buildings: fall too, or not?** Both ways are defensible; a
   rule that only foe buildings fall is a special case that surprises later.
   *Default: they fall, and the map warns.*
3. **How much does a fall hurt?** A silo at 40% plus 5% a metre dies from a
   12 m drop. *Default: as in the table, tuned in play.*
4. **Foe tunnellers.** Raiders digging into your base give the walls and
   the TOWER a new job, but they need an AI that digs with a purpose.
   *Default: a later spec.*
5. **Mark more than one thing?** *Default: one mark; marking again moves it.*
