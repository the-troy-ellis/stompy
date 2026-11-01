# Production: parts, an open assembly line, territory, and stealing

| | |
|---|---|
| Status | parts 1 and 2 built (talked through with the owner, 2026-11-01; every rule below is theirs or a default they agreed) |
| Milestone | M14 (proposed), with [32-base-loop.md](32-base-loop.md) |
| Size | L, split in six (§ Build order) |
| Depends on | [20-build-and-fight.md](20-build-and-fight.md) (silo, factory, raids); [21-mining.md](21-mining.md) (seams, haulers); [22-command-view.md](22-command-view.md) (the map); [23-construction-sites.md](23-construction-sites.md) and [31-builder.md](31-builder.md) (sites, builders); [32-base-loop.md](32-base-loop.md) (raids from above, ENDLESS, lodes) |
| Touch parity | Full: every order is a tap on the map or a button on its bar (spec 22). Nothing here needs a keyboard |

## Summary

Mechs are made, not bought. A machine shop presses legs, bodies and arms out
of ore; an isotope plant turns glowing rock into reactor cores; a weapon lab
works out a gun and a weapon shop makes it; and an **open assembly line**
puts them together where you can watch, bay by bay, until the new mech
walks off the end. Haulers carry every made thing from building to building.
**Beacons** draw your border: inside it your buildings are safe; outside, a
building knocked down to a quarter can be picked up by haulers and carried
off, by you or by the foe. Missions start from nothing, from a full base, a
damaged one or a half-built one.

## The rules in one place

- **Resources are global, built things are physical.** Ore and isotopes go
  into a pool the moment a digger tips them into any silo. Parts, cores,
  guns, wrecks and buildings are things on the ground, and haulers carry
  them.
- **Silos are all one kind.** Each adds room to the pool and counts as a
  beacon. The one you start with is only special because a mission says so.
- **Territory is triangles of beacons.** Beacons link within range; any
  three linked to each other make a triangle; your territory is all your
  triangles. Three is the least; more overlap, so losing one beacon loses
  less.
- **Build anywhere.** Inside your territory is safe; outside is quicker and
  riskier. That choice is the player's.
- **Stealing:** a building at a quarter health or less, outside every one of
  its owner's triangles, can be lifted by haulers and carried into the
  thief's territory, where it becomes theirs at a quarter health.
- **Repairs cost ore.** A builder repairs with the same swing it builds with.
- **Difficulty decides how much foes steal:** EASY never, NORMAL now and then,
  HARD all the time.
- **Nothing carries over between missions.** A mission lays out its own base
  (`vision.md` § Non-goals: no persistent progression).

## Player experience

### Silos and the pool

- `ORE 120/400` on the HUD and the map: the pool and its room. Every silo
  adds `SILO_ROOM` (200). Diggers tip in at the nearest silo; anyone fetching
  ore fetches it from the nearest silo, whichever it is.
- A silo is placed from BUILD like any site.
- **A silo destroyed:** the pool drops to what the rest can hold, and what's
  over spills as an ore heap where it stood. A hauler or digger scoops it back
  in, yours or theirs.
- **A silo stolen:** it takes its share of the pool with it (the pool ÷ your
  silos), into the thief's pool when it's set down.
- **The last silo gone:** nothing can tip in. Missions that `keep` a silo
  name one; ENDLESS ends with the last.

### Beacons and territory

- A **beacon** (placeholder key `beacon`, name `BEACON`) is a cheap post with
  a blinking top: a site from BUILD, a few swings, little ore.
- On the map, linked beacons (and silos) are joined by thin lines in your
  colour, and every triangle is filled with a faint dither of it. Foe
  territory is the same in red.
- Placing a beacon, its ghost draws the links and triangles it would make,
  so you can see what it buys before you tap.
- A beacon destroyed: its lines and triangles go at once, with a flat
  `Beacon lost.` Buildings it left outside every triangle get a small red
  open-padlock mark on the map: `EXPOSED`.

### Physical things and haulers

- Every made thing is a chunky low-poly object on the ground: a **pile**
  beside the building that made it (its out pile) or that wants it (its in
  pile). Legs stand in pairs; bodies sit on their backs; cores glow; guns
  lie in racks.
- **Haulers carry them.** A parked hauler takes whatever the busiest
  building is short of, from the nearest pile that has it, one load at a
  time, the load sitting in its tub where you can see it. From the map,
  `CARRY` with haulers picked, then tap a thing (a pile, a wreck, a
  building), then where it goes.
- Haulers also bring home **wrecks**: a dead mech's core and its unbroken
  parts go to the piles they fit.
- **Haul lines** (spec 32) show each hauler's trip on the map.

### The machine shop (`shop`, placeholder `MACHINE SHOP`)

- Ore from the pool in; parts out. A press stamps each part: a big thunk you
  feel in the cockpit nearby, a puff, and the part slides onto the pile.
- It makes what the assembly line will need next, by itself. Tapped on the
  map it shows its pile (`LEGS 2 · BODIES 1 · ARMS 0`) and what it's making.
- Parts are by size, not by mech: **light** and **heavy** legs, bodies and
  arms, plus **tools** (bucket, tub, crane). One press feeds many mechs.

### The isotope plant (`plant`, placeholder `ISOTOPE PLANT`) and cores

- **Isotope seams:** some bands in the rock are a flat bright colour (the
  palette's `iso`), deeper than most ore. Dug, they go into the pool as
  isotopes (`ISO 12` beside ORE). Digging them heats the digger as a laser
  does (heat 100/45 still holds): dig too fast and the digger shuts down,
  `Reactor shutdown. Please hold.`
- The plant has a short cooling tower and a slow belt. Isotopes in; a
  **core** out every so often, glowing, onto its pile.
- **Every mech needs a core.** Cores are the scarce thing, so they are what
  keeps the crew small, not a number on a screen. A dead mech's core
  survives in its wreck until something carries it off.

### The weapon lab (`lab`, placeholder `WEAPON LAB`) and weapon shop (`armory`, placeholder `WEAPON SHOP`)

- **The lab** is a shed with an open test range. Tapped on the map, its bar
  lists the weapons the campaign has unlocked that it hasn't worked out yet;
  a tap starts one. You see it working: the gun on a stand firing at a
  target block, over and over. Done: `ANGRY BEES. Works.`
- One at a time, and it starts again from nothing each mission.
- **The weapon shop** makes worked-out guns from ore, onto a rack. Its bar
  says which guns it keeps on the rack.
- A mission says which guns are worked out at the start.

### The assembly line (`line`, placeholder `ASSEMBLY LINE`)

- A long concrete pad with a gantry crane over it and **four bays** in a
  row. No roof, no walls: you can watch from the cockpit or the map.
- **Tapped on the map,** its bar is MAKE (spec 32's, moved here): each mech
  it can make, with the parts it takes, not a price. A tap puts it in the
  line (up to three waiting).
- **Bay by bay,** each a felt beat:
  1. **Legs:** a pair stood up in the cradle.
  2. **Body:** the crane swings it over and drops it on. Thunk, dust, the
     legs give a little.
  3. **Core:** lowered in glowing; the hatch slams. `Reactor online.`
  4. **Arms, tools or guns:** bolted on one side, then the other. Clank,
     clank. It takes its first step off the end and joins the crew, parked,
     on its job.
- **A bay waits for its part.** A mech half built in bay 2 stands there with
  no body until one arrives, and the bay's mark on the map says what it's
  waiting for: `NEEDS A BODY`.
- The half-built mech is made of the mech's own parts (`mechParts.js`), so
  bay 2 looks exactly like a mech with its top missing.
- The crew's cap (spec 32's `crewMax`) still holds.

### The factory

Stays as it is: the simple building of the first missions, making a BARRY
on its own from ore and salvage. Missions with an assembly line don't give
you one.

### Repairs

- A builder on a damaged building of yours swings as it does on a site.
  Each swing puts back a share of the building's health and takes ore for it
  (`REPAIR_ORE`: half its price to mend it from nothing to full).
- Parked builders repair on their own, after sites. From the map, a builder
  picked plus a tap on a damaged building is `REPAIR`. Voice: `Fixing.`
- No ore: the swing whiffs, `NEEDS ORE`, as on a site.

### Stealing

- **Down:** a building at a quarter health or less stops working (sparks,
  smoke, a slow lean): `Building down.` It works again when repaired above a
  quarter.
- **Can it be lifted?** Down, and outside every triangle of its owner's.
  On the map it gets a lift mark (an up arrow) for whoever could take it.
- **Lifting:** haulers picked, `CARRY`, tap the building. Each walks to an
  edge and crouches under it. With enough of them there it heaves up, creaks
  and drops dust; with too few they strain (`TOO HEAVY`) and wait.

  | building | haulers to lift it |
  |---|---|
  | beacon, tower | 1 |
  | silo, shop, lab, armory | 2 |
  | plant | 3 |
  | line | 4 |

- **Walking it home:** slow, in step, the building riding on their tubs.
  More haulers than it needs go a little faster. A ramp a hauler can't climb
  stops them; dig one, or go round.
- **Setting it down:** a tap places it with the site ghost (snapping as
  walls do). Inside the thief's territory it lands with a big thunk and a
  dust ring and turns their colour piece by piece: `Taken. It's ours now.`
  Outside it, it lands but stays its owner's.
- **A hauler hit** hard or killed: the building drops where it is (thunk,
  dust; no harm to it) and waits for more haulers.
- **Neutral buildings:** some maps have abandoned ones, nobody's. They are
  down from the start and can be lifted at once. A reason to go out.
- **Losing one:** `Shop lost.` (its kind's name).

### What foes do

- **By difficulty** (`ai.js`, a new `steal` row):

  | | EASY | NORMAL | HARD |
  |---|---|---|---|
  | foe haulers with a raid | never | every third raid, at most 2 | every raid, as many as the biggest exposed building needs |
  | what they take | | an exposed building already down | an exposed building; the raid knocks it down first |
  | warning | | `Haulers with that raid.` | none; red haulers on the map |
  | haulers hit | | drop it and run | drop it and come back |
  | raids aim at | the nearest thing (today) | the nearest thing | exposed buildings first |

- A mission can turn stealing on at any difficulty (`steal: 'hard'`).
- **Foe bases** are buildings of team 1 with their own beacons, and the same
  rules: knock out the beacons, knock a building down, carry it home. A foe
  base doesn't build or grow (yet; § Open questions).

### Missions and their bases

- A mission's `base` lists what's there at the start, each building with its
  state: up, damaged (`hp`), half built (a site with `prog`), or rubble
  (a wreck to clear before a site can go there). Plus piles, the crew and
  their jobs, and the guns already worked out.
- So missions can start:
  - **from nothing:** a silo, a builder, a digger;
  - **with a full base:** everything up and the haulers on their rounds;
  - **with a damaged base:** fires, a beacon down, a raid on its way;
  - **with a half-built base:** `FINISH THE LINE.`
- The mission editor (spec 15) places buildings with a state, so these can be
  laid out by hand.
- The order of the acts is for later.

### New text (for the tone check)

`ORE 120/400`, `ISO 12`, `Beacon lost.`, `EXPOSED`, `CARRY`, `REPAIR`,
`Fixing.`, `LEGS 2 · BODIES 1 · ARMS 0`, `NEEDS A BODY` (and `NEEDS LEGS`,
`NEEDS A CORE`, `NEEDS ARMS`, `NEEDS A GUN`), `Reactor online.` (existing),
`ANGRY BEES. Works.`, `Building down.`, `TOO HEAVY`, `Taken. It's ours
now.`, `Shop lost.`, `Haulers with that raid.`, `FINISH THE LINE.`
Placeholders: `BEACON`, `MACHINE SHOP`, `ISOTOPE PLANT`, `WEAPON LAB`,
`WEAPON SHOP`, `ASSEMBLY LINE`. Each gets a NAMING section in the PR that
shows it.

## Design

### Numbers (starting values to tune in play)

| key | value | what |
|---|---|---|
| `SILO_ROOM` | 200 | ore each silo adds to the pool's room |
| `ISO_ROOM` | 50 | isotopes each silo adds |
| `BEACON.link` | 200 m | beacons (and silos) within this link |
| `PLACE.beacon` | ore 10, swings 3, hp 150 | |
| `PLACE.shop` | ore 60, swings 10, hp 500, 16 × 12 m | |
| `PLACE.plant` | ore 80, swings 12, hp 500, 14 × 14 m | |
| `PLACE.lab` | ore 60, swings 10, hp 400, 12 × 20 m (with its range) | |
| `PLACE.armory` | ore 60, swings 10, hp 500, 12 × 12 m | |
| `PLACE.line` | ore 100, swings 16, hp 700, 12 × 40 m | |
| `PARTS` | light legs/body/arms 8 ore each, heavy 15, tools 10; a press every 6 s | |
| `CORE` | 10 isotopes, every 20 s | |
| `GUNS` | by weapon: 10–25 ore, every 8 s | |
| `RESEARCH` | 60 s a weapon | |
| `BAY_TIME` | 4 s a bay once its part is there | |
| `RECIPES` | digger: heavy legs, heavy body, bucket; hauler: light legs, light body, tub; builder: heavy legs, light body, crane; fighters: their size's legs and body, two arms, their guns | |
| `REPAIR_ORE` | half the building's price, full mend | |
| `DOWN` | 0.25 of full health | |
| `LIFT` | the table in § Stealing | |
| `CARRY_SPEED` | 0.5 × hauler speed × min(1.3, haulers ÷ needed) | |
| `ai.steal` | § What foes do | |

New numbers, so this spec is their balance issue; later changes go through
balance issues as usual.

### State

- `G.base.pool = { ore, iso }`, room from the silos. `G.base.silos` (a list;
  `silo` stays as the mission's named one).
- `G.base.beacons`, and per team `G.teams[t].tris` (triangles, rebuilt when
  a beacon or silo comes or goes; `inTerritory(G, team, x, z)` in a pure
  `sim/territory.js`).
- `G.things`: every physical made thing `{ id, kind, size, x, z, at, by }`
  (`at`: a pile's building, or a hauler carrying it). Piles are where
  things with the same `at` sit.
- A building entity gains `team`, `down` (bool) and `carry` (`{ haulers,
  need }` while lifted). A lifted building moves with the haulers' middle
  and its footprint goes with it.
- `line.bays[4]`, each `{ mech, stage, t }`; `line.queue`.
- `lab.work`, `lab.known` (this mission only), `armory.keep`.
- The base is single player (spec 20), so no network message changes and no
  `PROTOCOL` bump.

### Haulers: what's next

A parked hauler picks a job in this order (`miner.js` `haul`, extended):

1. A carry it was ordered to.
2. A stolen or neutral building it's lifting (with others).
3. A wreck's core, then its parts.
4. The line's next missing part, from the nearest pile with one.
5. The plant's isotopes and the shop's ore come from the pool, so nothing to
   carry. Sites' ore: from the nearest silo, as now.
6. An ore heap from a fallen silo.

### Territory

- Nodes: your silos and beacons that are up and not down. Links: node pairs
  within `BEACON.link`. Triangles: three nodes all linked to each other.
- `inTerritory` is a point-in-triangle test over the team's triangles
  (dozens at most), cached per change.
- A building is `exposed` when its centre is outside every triangle of its
  team. Rebuilt with the triangles.

### Edge cases

- **A building lifted while it holds a pile:** its pile comes with it.
- **A lifted building set down overlapping something:** the ghost won't
  allow it (red), as for a site.
- **A line stolen with a half-built mech:** the thief finishes it, in their
  colour.
- **Haulers lifting, then ordered away:** the building drops.
- **Silo room shrinks below the pool (a silo lost):** the extra spills as a
  heap at that silo.
- **Missions from before this spec:** unchanged. A mission with no `line`
  keeps the factory, ore and salvage as today.
- **Perf:** things on the ground are capped (`THINGS_MAX`, 80); a pile past
  its cap stops the building that makes it.

## As built

### Part 1: silos, the pool and territory

- **Silos** (`base.js`): `G.base.silos` (the mission's own first), `isUp`,
  `silosUp`, `oreRoom` (`CONSTRUCT.siloRoom` 200 a silo standing),
  `nearestSilo`. BUILD's cycle is now FACTORY, BAY, WALL, SILO, BEACON
  (`PLACE.silo`: 40 ore, 8 swings, 16 × 16 m).
  - Any silo standing takes ore in, up to the room. Past it the rest stays
    in the hopper, and the player sees `SILO FULL`.
  - Parked diggers and haulers go to the nearest silo, and only while the
    pool has room. Haulers fetch a site's ore from the nearest silo.
  - The HUD and the map read `ORE 120/400`.
- **Spills:** a silo falling drops the pool to the room left. What's over
  lands as a heap where it stood (`addHeap`: a bodiless entity of the nav
  kind with the `heap` mesh, sized by its ore), and the voice says
  `Silo lost.`
  - Any crew mech with hopper room beside a heap scoops it (`ORE UP` for
    the player).
  - Parked haulers go for heaps when there's a silo with room.
  - The map labels a heap `ORE n`.
- **Beacons** (`PLACE.beacon`: 10 ore, 3 swings, 150 hp; a post with a
  glowing lamp, `beacon` mesh).
- **Territory** (`sim/territory.js`, pure): links within `CONSTRUCT.link`
  (200 m), triangles of three linked to each other, `inTerritory`.
  - `base.js` `survey` rebuilds `G.base.land` four times a second, and at
    once when a silo or beacon goes up or falls.
  - `survey` marks each of the base's buildings that's up `exposed` when
    it's outside every triangle.
  - `Beacon lost.` when a beacon falls.
  - Raids now count silos and beacons among the buildings they go for.
- **The map** (`command.js`):
  - Links are thin lines, and triangles a sparse dot screen in the crew's
    colour (a dither, no see-through).
  - BUILD BEACON or SILO's ghost draws, dashed, the links and triangles it
    would add.
  - An exposed building gets a small red open padlock and `EXPOSED`. These
    show **only once the base has some territory**: before the first
    triangle every building would be marked, which says nothing in today's
    one-silo missions.
  - A damaged building's label gives what's left (`BAY 40%`).
- **Repairs** (`repairSwing`, `repairCost`, `needsRepair`): a builder's
  BUILD on a damaged building of the base's mends a swing's share. A piece
  takes the swings it took to build, and a full mend costs
  `CONSTRUCT.repairOre` (half) of its price.
  - `siteInReach` finds a site first, then a building to mend.
  - Parked builders mend after sites, when the pool has ore for a swing;
    their job reads `FIXING`.
  - From the map, a builder picked plus a tap on a damaged building (or BUILD
    on it) is the order, and the voice says `Fixing.`
- **New text:** `SILO FULL`, `ORE UP`, `FIXING`, `Silo lost.`,
  `Beacon lost.`, `EXPOSED`, `ORE 120/400`. `BEACON` is a placeholder.
- **Tests:**
  - `territory.test.js`: links, triangles, overlap holding, edges.
  - `pool.test.js`: room, tipping in anywhere, the spill and scooping it,
    exposed and `Beacon lost.`, the repair swing and its price, a parked
    builder mending, the BUILD order on a damaged building.

### Part 2: parts, the machine shop and the open line

- **Data** (`construct.js`):
  - `PARTS`: light and heavy legs and bodies, and the bucket, tub and crane,
    each with its ore price and the mech whose mesh shows it on a pile.
  - `RECIPES` for the digger, hauler and builder.
  - `LINE`: 4 bays, 3 waiting, 4 s a bay, a press every 6 s, 6 parts to a
    shop's pile, 80 parts on the ground.
  - `CONSTRUCT.crewMax` is 8.
  - `PLACE.shop` and `PLACE.line`. BUILD's cycle ends SHOP, LINE.
- **`sim/production.js`** (new):
  - **The shop** presses, from the pool, the first part a line wants that
    nothing on the ground, on a hauler or in a press is there for yet
    (`nextPart`). The part goes onto the shop's pile, with a thunk.
  - **The line**: a mech in the queue goes into the first bay. Each bay
    takes its part off the line's pile, thunks (the body's drop is the big
    one), waits `bayTime`, then passes the mech on. The third bay, the
    core, wants nothing until part 3.
  - Off the last bay the mech walks out, parked, joins the crew on its own
    job, and the voice says `New digger.` / `New hauler.` /
    `New builder.`
  - With the crew at its cap, the line won't start one (`CREW FULL`).
  - The mech in the bays is a real mech kept off the field, drawn with
    only `show` of its parts (`render/scene.js` `drawMech`).
  - Thunks reach you within 40 m; past that only the half-built mech
    squashes.
- **Haulers** (`miner.js` `carry`): a parked hauler with an empty tub takes
  the part a line wants soonest (furthest-on bay first), the nearest such,
  and claims it so two don't go for one. It walks it to the line's pile
  (`CARRYING`) and puts it down. A hauler ordered to FOLLOW puts its part
  down where it is.
- **The look:**
  - `shop` mesh: a shed with an open press out front.
  - `line` mesh: a 12 × 40 m pad under a gantry, open on every side.
  - Parts drawn with the showing mech's own meshes: legs stood in a pair, a
    body on the ground, an arm laid down. On a hauler they ride its back.
- **The map:**
  - A tap on an assembly line, with nothing picked, swaps the order bar for
    MAKE: one button a mech (`BIG SCOOPER +1`: one waiting), and keys 1–3.
    A tap elsewhere puts it away. The voice says `Making.`
  - The line tapped is ringed, with `2 WAITING` or `CREW FULL`.
  - Each bay waiting says `NEEDS LEGS` / `NEEDS A BODY` / `NEEDS ARMS`.
  - Under a shop: `LEGS 1 · BODIES 0 · ARMS 2`.
- **Not yet:**
  - A tap on a waiting mech to take it out (`unqueue` is in the sim).
  - The map's CARRY order (it comes with stealing, part 4).
  - The player can't carry parts by hand; haulers do it parked.
- **New text:** `Making.`, `New digger.`, `New hauler.`, `New builder.`,
  `CARRYING`, `n WAITING`, `CREW FULL`, `NEEDS LEGS`, `NEEDS A BODY`,
  `NEEDS ARMS`, `LEGS n · BODIES n · ARMS n`. `MACHINE SHOP` and
  `ASSEMBLY LINE` are placeholders.
- **Tests** (`production.test.js`):
  - The bays' parts and wants.
  - The queue and its limit.
  - The shop pressing what's wanted, paid from the pool.
  - A hauler carrying the parts and the line making a digger that joins the
    crew.
  - A bay waiting for its part.
  - The crew's cap.

## Code touchpoints

- `src/data/construct.js`: the numbers above; `PLACE` for the new buildings.
- `src/data/names.js`: placeholders and lines.
- `src/data/ai.js`: the `steal` row per difficulty.
- `src/sim/territory.js` (new, pure): links, triangles, `inTerritory`.
- `src/sim/things.js` (new): made things, piles, carrying.
- `src/sim/production.js` (new): shop, plant, lab, armory, the line's bays.
- `src/sim/base.js`: the pool, silos, repairs, down, lifting and setting
  down.
- `src/sim/miner.js`: the hauler's jobs; builders repair.
- `src/sim/raid.js`: exposed targets, foe haulers by difficulty.
- `src/world/seams.js`: isotope bands (pure, by seed).
- `src/mesh/`: the new buildings, the parts (from `mechParts.js`), piles.
- `src/ui/command.js`: territory drawing, the buildings' bars, CARRY,
  REPAIR, EXPOSED and lift marks, the setting-down ghost.
- `src/data/missions.js` and the editor: base states, piles, known guns.

## Acceptance criteria

1. Ore tipped into any silo is spendable anywhere; a second silo raises the
   room; a silo destroyed spills what's over; a silo stolen takes its share.
2. Three linked beacons (a silo counts) draw a triangle on the map; a fourth
   overlapping one keeps the middle covered when one beacon falls.
3. The machine shop makes parts onto a pile; haulers carry them to the line;
   the line puts a digger together bay by bay, visible from the cockpit, and
   it walks off and digs.
4. A bay with no part waits and says which part.
5. Isotope seams show, dig into the pool and heat the digger; the plant makes
   cores; no core, no mech.
6. The lab works out a weapon in 60 s, the armory makes it, and a fighter
   comes off the line with it.
7. A builder repairs a damaged building, paying ore a swing.
8. A building down and outside its owner's territory is lifted by the right
   number of haulers, carried, and set down inside yours, where it turns
   yours at a quarter health.
9. EASY raids never steal; NORMAL every third raid takes an exposed building
   that's already down; HARD raids knock exposed buildings down and take
   them.
10. A mission can start full, damaged, half built or empty.
11. Every part works on a phone held sideways (checked on a real phone).

## Tests

- `territory.test.js`: links, triangles, inside/outside, overlap surviving a
  lost beacon, rebuilt on change.
- `pool.test.js`: room, tipping in anywhere, spill on loss, share on theft.
- `production.test.js`: shop, plant, lab, armory pace; recipes; bays wait for
  parts; the made mech joins the crew.
- `things.test.js`: piles, haulers' job order, wrecks' cores and parts.
- `steal.test.js`: down, exposed, lift counts, carry speed, set down inside
  and outside, dropping when hit, a stolen line's half mech.
- `raid.test.js`: the `steal` row by difficulty.
- `repair.test.js`: ore a swing, no ore, parked builders repair.
- Smoke: a full-base mission runs a mech down the line; a steal on HARD.

## Performance

- New buildings are a handful of props each; parts and piles reuse
  `mechParts.js` meshes and are capped (`THINGS_MAX`).
- Territory is rebuilt only on change; the map draws a few dozen lines and
  dithered triangles while it's up.
- More haulers moving: the crew cap (spec 32) and core scarcity bound it.
  `npm run perf` gets a full-base run.

## Build order

Each part is playable on its own, in this order:

1. **Silos, the pool and territory:** many silos, global ore with room,
   beacons, triangles, EXPOSED, repairs costing ore.
2. **Physical things, the machine shop and the open line:** piles, haulers
   carrying, recipes for the three workers, the bays. (Spec 32 part 1's MAKE
   bar moves to the line here.)
3. **Isotopes and cores:** the seams, the plant, cores on the line, cores
   from wrecks.
4. **Stealing:** down, lifting, carrying, setting down, neutral buildings,
   foe stealing by difficulty.
5. **Weapons:** the lab, the armory, fighters off the line.
6. **Mission bases:** full, damaged, half built; the editor's state slider.

Spec 32's parts 2 (defend from above, ENDLESS) and 3 (lodes, ore thinning,
haul lines) fit between these as they're ready; its OUTPOST is now just a
second silo.

## Open questions

1. **Salvage:** missions with a line have no salvage number; wrecks give
   parts and cores instead. Missions with the factory keep salvage. *Default:
   as said.*
2. **Foe bases that build and grow,** and foe builders: later. *Default:
   foe bases stand still for now.*
3. **The acts** (which missions start how): later, as agreed.
4. **Cores beyond making mechs** (e.g. a mech's core deciding the OOPS
   BUTTON): later. *Default: cores only make mechs.*
5. **Loadouts for line fighters:** each fighter takes the guns on the rack in
   order, or you pick per fighter on MAKE. *Default: on the rack, in order;
   picking later if it's missed.*
6. **Names:** every building here, and the hauler's (it's the scavenger now).
