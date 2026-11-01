# The base loop from above: grow, defend, spread out

| | |
|---|---|
| Status | draft (the owner, 2026-11-01: "I want to work on command view game loop"; picked all three loops in parts, and both missions and an endless mode) |
| Milestone | M14 (proposed) |
| Size | L, split in three: grow the crew; defend from above (and ENDLESS); spread out |
| Depends on | [20-build-and-fight.md](20-build-and-fight.md) (silo, factory, raids, salvage); [21-mining.md](21-mining.md) (seams, haulers); [22-command-view.md](22-command-view.md) (the map and its orders); [23-construction-sites.md](23-construction-sites.md) and [31-builder.md](31-builder.md) (sites, builders) |
| Touch parity | Full: everything is a tap on the map or a button on its bar, as spec 22 |

## Summary

The map can already place sites and give orders, but the base runs itself:
the factory makes BARRYs on its own, and a raid is called three seconds
before it lands. This gives the map a loop of its own: **spend** ore on the
mechs you want (more diggers means more ore), **see a raid coming** and get
ready for it from above, then drop in for the loud part, and **spread out**
to richer ground with an outpost when the rock round the silo runs thin.
Missions get objectives about building; Free Play gets ENDLESS, a base that
holds out as long as it can.

The rhythm of spec 20 stays (quiet, warning, loud, after). The map is where
the quiet and the warning happen; the cockpit is where the loud happens.

## Player experience

### Part 1: grow the crew

> **Changed by [33-production.md](33-production.md):** in missions with an
> assembly line, MAKE is on the line, and mechs are put together from parts
> and a core, not bought with ore. The line, the cap and the objectives
> below still hold; the prices become recipes. Missions with the factory
> keep it as today.

- **Tap the factory** on the map (nothing picked): the order bar becomes the
  **MAKE** bar, one button a mech, with its price:

  | button | price | it |
  |---|---|---|
  | `BIG SCOOPER · 30 ORE` | 30 ore | digs |
  | `HAULER · 30 ORE` | 30 ore | carries |
  | `BIG STACKER · 40 ORE` | 40 ore | builds |
  | `BARRY · 50 ORE 30 SALVAGE` | 50 ore, 30 salvage (today's) | fights |

  (Names from `names.js`; the fighters offered are those the mission lets
  you make, `base.make`. Prices are starting values, see § Numbers.)
- A tap on one **puts it in the factory's line** (up to `CONSTRUCT.line`, 3).
  The line shows over the factory on the map as small chevrons, the first
  with a ring filling as it's made. A tap on a chevron takes it out (its
  price comes back only if it hadn't started).
- The factory takes the price when it **starts** a mech, not when you queue
  it. With too little, the first in line waits and its chevron says
  `NEEDS ORE` (or `NEEDS SALVAGE`).
- **An empty line makes nothing.** Today's missions start with BARRY in
  the line on repeat (`REPEAT` on the MAKE bar, lit), so FIRST FACTORY plays
  as now until you change it.
- The new mech walks out of the factory's door and **joins the crew,
  parked**: a digger digs, a hauler hauls, a builder builds, a fighter
  stands by the silo. The voice: `New digger.` `New hauler.` `New builder.`
  `New mech ready.` (today's line, for fighters).
- **The crew has a cap**, `CONSTRUCT.crewMax` (8), shown on the MAKE bar as
  `CREW 5/8`. At the cap the line waits: `CREW FULL`.
- **Ore coming in shows**: each unload at the silo floats `+6` over it on the
  map for a second (the HUD's `ORE 20 SALVAGE 0` stays where it is).
- Missions can ask for it (§ Objectives): `BUILD TWO WALLS`, `MAKE A HAULER`,
  `CREW OF FIVE`.

### Part 2: defend from above

- **A raid is seen coming.** A raid is called `RAID_WARN` (20 s) ahead, not
  three: the voice as now (`Raid west. Two JACKALs.`), and on the map a red
  arrow on the screen's edge toward where it comes from, with the count down
  (`RAID · 18`). When it lands, the arrow turns into its red foe markers.
- **FIGHTERS** on the bar with nothing picked picks every fighting crew mech
  at once, so rallying is two taps: FIGHTERS, then the ground (GO) or a
  building (GUARD).
- **When the shooting starts**, the map says where: a red ring pulses where
  your crew or a building was last hit, and the crew strip's hit mech
  flashes. A tap on the ring with nothing picked looks there.
- **Drop in:** DRIVE as now. A fighter you left keeps its order.
- **Walls matter:** a raider whose way to its target is blocked by a wall
  stops and shoots the wall (it's a building, so it already can) rather than
  walking round a long way. A wall with a raider shooting it shows on the map
  as hit.
- **A defence building** (placeholder key `tower`, placeholder name
  `TOWER`): a small site from BUILD, after WALL in the cycle, with a gun on a
  post that shoots raiders in range on its own. Its own price and hp in
  `PLACE`. NAMING in its PR.
- **ENDLESS** (Free Play, MAP: `BASE · ENDLESS`): the base mission's ground
  with no objectives but the silo. Raids come every `ENDLESS.every` from a
  random side, each a little bigger than the last (§ Numbers). It ends when
  the silo falls: `THE SILO FELL. YOU LASTED 12:40. SEVEN MECHS MADE. NINE
  RAIDS.` Best time is saved, as Free Play's other bests are.

### Part 3: spread out

- **The rock near the silo runs thin.** Ore per cut falls off slowly with
  distance from the silo over the first ~150 m, then rises past it (`seams`
  get a `lode` term): the rich ground is out there.
- **Lodes:** a few rich patches per map (`ORE_LODES`, 3), each a ring on the
  map once any crew mech has come within 60 m of it: `ORE`. Before that,
  nothing shows. Found: the voice says `Ore found.`
- **OUTPOST** (placeholder key `outpost`; **now a second silo**, spec 33:
  silos are all one kind, ore is one pool, and each silo is a beacon): a small silo, a site from BUILD.
  Diggers and haulers unload at the nearest silo or outpost; its ore goes
  straight into the base's ore (one pool, no carrying between). Raiders go
  for outposts as for any building. NAMING in its PR.
- **Haul routes show** on the map as faint lines from a digger to where it
  unloads, so a long route reads, and a raid across it does too.

### Desktop and gamepad

As spec 22: keys 1–9 press the bar's buttons, so with the factory tapped
1–4 queue mechs. On a gamepad, A on the factory opens MAKE, the D-pad walks
it, Y presses. FIGHTERS is on the bar like any button.

### New text (for the tone check)

`MAKE`, `REPEAT`, `NEEDS ORE`, `NEEDS SALVAGE`, `CREW FULL`, `CREW 5/8`,
`New digger.` `New hauler.` `New builder.`, `RAID · 18`, `FIGHTERS`,
`Ore found.`, `ORE`, `BASE · ENDLESS`, `THE SILO FELL. YOU LASTED 12:40.
SEVEN MECHS MADE. NINE RAIDS.`, objective lines `BUILD TWO WALLS`, `MAKE A
HAULER`, `CREW OF FIVE`. Placeholders: `TOWER`, `OUTPOST`.

## Design

### Numbers (`src/data/construct.js`, starting values to tune in play)

| key | value | what |
|---|---|---|
| `CONSTRUCT.make` | `{ digger: { ore: 30 }, hauler: { ore: 30 }, builder: { ore: 40 }, kestrel: { ore: 50, salvage: 30 } }` | prices; `kestrel` (BARRY) is today's `mechCost` |
| `CONSTRUCT.makeTime` | 20 s (workers), 30 s (fighters, today's `mechTime`) | |
| `CONSTRUCT.line` | 3 | the factory's line |
| `CONSTRUCT.crewMax` | 8 | the crew's cap, you included |
| `RAID_WARN` | 20 s | raids only; other waves keep `WAVE_WARN` |
| `PLACE.tower` | ore 40, swings 8, hp 400, range 120 m | part 2 |
| `ENDLESS` | first at 90 s, every 120 s, foes `2 + floor(n / 2)`, chassis by `pickFoes` with the raid number as difficulty | part 2 |
| `ORE_LODES` | 3 a map, 25 m across, 3× ore, 200–400 m from the silo | part 3 |
| `PLACE.outpost` | ore 40, swings 8, hp 300 | part 3 |

These are new numbers, so this spec is the balance issue for them; later
changes go through balance issues as usual.

### State

- `G.base.line = [{ kind, t }]` (t: seconds in, or null while waiting) and
  `G.base.repeat` (bool). `stepBase` takes the price when the first item
  starts. Replaces `factory.job`; `job` stays as a getter-free alias only if
  a test needs it (it doesn't today, so it goes).
- `G.base.made` (count by kind) for objectives and ENDLESS's line.
- Part 3: `G.base.lodes = [{ x, z, r, found }]`, from the map's seed
  (`seams.js`, pure); `G.base.outposts`.
- The base is single player (spec 20), so no network message changes and no
  `PROTOCOL` bump.

### Objectives (`objectives.js`)

New types, each `{ type, kind, n }`:

- `build`: `n` standing buildings of `kind` (walls count slabs ÷ 3, i.e.
  sites). Line: `BUILD TWO WALLS`, done when built.
- `make`: `n` mechs of `kind` made by the factory this mission. `MAKE A
  HAULER`.
- `crew`: a live crew of `n`. `CREW OF FIVE`.

Board-book numbers through `missions.js` `count`.

### Raids from above

- The warning time is the wave's own `warn` or `RAID_WARN` for raids.
  `objectives.js` already calls each wave ahead; it reads that per wave.
- The map's edge arrow comes from the wave's `from` bearing, drawn by
  `command.js` from `G.raidsDue` (a list the sim keeps: `{ from, at, n }`).
- Hit rings: the sim already raises `feel`/fx on hits; `G.base.hits` keeps
  the last few `{ x, z, t }` on team-0 things for the map to draw (sim-side,
  so it's testable and the sim still knows nothing of the DOM).
- Raiders and walls: in `raidTarget`, if the straight line to the target
  crosses a wall slab within 30 m, the wall is the target until it falls.

### Edge cases

- **The factory falls** with a line: the line is lost, and any started
  mech's price with it.
- **No silo** (it fell, in a mission that goes on): ore can't come in; the
  MAKE bar still shows, greyed by price.
- **Crew cap and the factory's own fighters in old missions:** FIRST FACTORY
  starts with BARRY on repeat, and the cap is above its numbers, so it
  plays as now.
- **ENDLESS on a phone:** the same budgets as the base mission; the crew cap
  and raid size cap (`ENDLESS.most`, 8 foes) keep it inside them.

## Code touchpoints

- `src/data/construct.js`: `CONSTRUCT.make`, `makeTime`, `line`, `crewMax`;
  `PLACE.tower`, `PLACE.outpost`; `RAID_WARN`, `ENDLESS`, `ORE_LODES`.
- `src/data/names.js`: the new lines and placeholders.
- `src/sim/base.js`: the line, `queueMake`, `unqueue`, `made`; spawning a
  mech of any kind into the crew; outposts as unload points.
- `src/sim/crew.js`: adding a made mech to the crew, parked, with its job.
- `src/sim/objectives.js` / `waves.js`: `build`, `make`, `crew`; per-wave
  warning; `G.raidsDue`; ENDLESS's raid maker.
- `src/sim/raid.js`: walls in the way.
- `src/sim/miner.js`: unload at the nearest silo or outpost.
- `src/world/seams.js`: the distance term and lodes (pure).
- `src/ui/command.js`: the MAKE bar, the line's chevrons, `+6` floaters, the
  raid arrow, hit rings, FIGHTERS, lodes and haul lines.
- `src/ui/screens.js`, `src/data/missions.js`: `BASE · ENDLESS` and its
  end screen; `ENDLESS_MISSION`.

## Acceptance criteria

1. Tapping the factory on the map shows MAKE with each mech and its price; a
   tap queues it, up to three, and the factory makes them in order, taking
   the price at the start.
2. A made digger, hauler or builder joins the crew parked and does its job
   with no orders.
3. With an empty line the factory makes nothing; FIRST FACTORY plays as
   before (BARRY on repeat).
4. The crew stops growing at 8: `CREW FULL`.
5. A raid shows on the map 20 s early as an edge arrow with a count, and
   lands where the arrow pointed.
6. FIGHTERS picks every fighting crew mech.
7. A raider with a wall between it and its target shoots the wall.
8. A TOWER site, once built, shoots raiders in range.
9. ENDLESS runs until the silo falls and shows how long, how many mechs and
   how many raids; the best time is kept.
10. Ore per cut is lower near the silo than out at a lode; a lode shows on
    the map only once found; diggers unload at an outpost.
11. Each part works on a phone held sideways (checked on a real phone).

## Tests

- `base.test.js`: the line (order, price at start, waits for ore, unqueue
  refunds only unstarted, repeat, crew cap, factory falling).
- `crew.test.js` or `sites.test.js`: a made digger digs, a made hauler
  hauls, a made builder builds, with no orders.
- `objectives.test.js`: `build`, `make`, `crew`.
- `raid.test.js`: the 20 s warning and `G.raidsDue`; a wall in the way is
  shot; a tower shoots raiders.
- `endless.test.js`: raids grow, the end comes with the silo, the numbers on
  the end screen.
- `seams.test.js`: ore near the silo is less than at a lode, deterministic
  by seed; lodes found by distance.
- Smoke: `command-make` queues a digger from the map with the mouse and sees
  it join the crew; ENDLESS starts and ends.

## Performance

- Each made mech is an AI mech: the crew cap (8) is what keeps the base
  inside its budget. `npm run perf` gets a base run with a full crew and a
  raid; if it's over on the phone budget the cap comes down, not the budget.
- The map's new marks (chevrons, arrows, rings, lines) are a few dozen canvas
  strokes, only while the map is up.
- Lodes: a few distance checks per cut.

## Build order

1. **Grow the crew:** the line, MAKE, new crew, the cap, floaters, the
   `build`/`make`/`crew` objectives. One PR (or two: sim, then map).
2. **Defend from above:** raid warning and arrow, FIGHTERS, hit rings, walls
   in the way, TOWER; then ENDLESS. Two PRs.
3. **Spread out:** the seam distance term and lodes, OUTPOST, haul lines.
   One PR.

## Open questions

1. **Prices and times.** Workers at 30–40 ore with no salvage, so the first
   ten minutes are about growing; fighters still need salvage, so raids pay
   for fighters. *Default: as in § Numbers.*
2. **Raid warning: 20 s?** Enough to go up, look, rally and drop in; short
   enough to stay a surprise. *Default: 20 s for raids.*
3. **A defence building in part 2, or walls only?** A TOWER makes the map
   matter more in a raid; walls alone keep the fighting in the cockpit.
   *Default: TOWER, one kind, modest.*
4. **Should ore near the silo run thin (part 3)?** It's what makes spreading
   out worth it, but it changes how today's base mission feels to dig.
   *Default: yes, gently (no less than 60% of today's near the silo).*
5. **ENDLESS's score:** time lasted, or raids beaten? *Default: time, with
   mechs made and raids beaten on the end screen.*
