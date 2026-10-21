# Build and fight: the smallest loop (a digger, a factory, a raid)

| | |
|---|---|
| Status | in progress: #308 (the digger), #310 (the crew and SWAP) and #309 (the base) built; the owner picked the two arms (build and mine, defend and conquer), a base that is a mech factory, swapping mechs mid-mission, and starting with the smallest version that proves the loop |
| Milestone | M9 (proposed; after M8) |
| Size | L (split into five issues; see the end) |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md) (digging, building, falling, the torque rule); [03-objectives.md](03-objectives.md) (structures, waves, protect); [05-ai.md](05-ai.md) (foes that go for a target); [12-melee.md](12-melee.md) (the punch the bucket rides on); [16-body-plans.md](16-body-plans.md) (a new body); [19-debug-menu.md](19-debug-menu.md) (where it is tried first) |
| Touch parity | Full. Digging is the punch (double tap the lower stick), unloading and building are automatic or one button, and swapping mechs is one button. Nothing needs a new control on the phone |

## Summary

Stompy gets a second arm. Until now it is all **defend and conquer**: you
walk out and knock mechs down. Now there is also **build and mine**: you dig
ore out of the voxel ground, haul it home, and put up buildings that make
mech parts. The base is a small mech factory, and the enemy comes to knock
it down.

This spec is the **smallest version that proves the loop**. It has one
construction mech, one resource, two buildings, a raid, and swapping between
your two mechs. Each loop gets one step here and a list of what comes next
(§ Room to grow), so later specs add to it without reworking it.

## The loop

```
  MINE ── ore ──▶ SILO ── ore ──▶ FACTORY ── builds ──▶ a fighting mech
    ▲                               ▲                        │
    │ dig with the bucket           │ salvage from wrecks    │ swap into it
  the DIGGER ◀── swap ──▶ your fighter ── DEFEND ◀── a RAID comes for the base
```

The rhythm of a mission (`vision.md` § Thunk and § Fun keep it from turning
into a spreadsheet):

1. **Quiet.** Dig, haul, unload, place the factory. Calm toy-truck play.
2. **Warning.** The voice calls the raid with time to swap mechs.
3. **Loud.** A short, heavy fight on ground you dug.
4. **After.** Salvage the wrecks. The factory turns ore and salvage into
   the next mech. Then the next raid comes, a little bigger.

## Player experience

### The digger (placeholder key `digger`)

A slow, wide construction mech with a bucket arm where a fist would be, a
hopper on its back, hazard stripes, and fat feet. It has no guns. Its HUD
shows the hopper in place of the weapon list.

- **Dig:** the punch (double tap the lower stick; E or Mouse 4). The bucket
  winds up, bites the ground in front of it with the punch's thunk, and
  digs a big hole (radius `CONSTRUCT.bucket`, larger than any gun's, as
  spec 18 promised construction mechs). Dirt flies.
- **What a bite gives:** rock gives ore and soft ground gives none. Ore is
  measured by how much rock the bite removed (§ Design). The hopper fills,
  and a full hopper digs but holds no more (`HOPPER FULL`).
- **Unload:** walk onto the silo's pad. The hopper empties into the silo by
  itself with a rumble: `ORE IN.`
- **It shoves:** the bucket still knocks a mech back, like any punch, so a
  digger can push a JACKAL away. It is not a fighter.

### Two buildings

- **SILO** (placeholder): already at your start. It holds the base's ore
  and is where the digger unloads. If it falls, the mission is lost.
- **FACTORY** (placeholder): you place it. Stand the digger on flat
  ground near the silo and press BUILD (the missile button while you drive
  the digger: hold to see the footprint, let go to place it). It costs
  `CONSTRUCT.factory` ore, and it goes up over a few seconds with dust and
  thumps. It needs flat ground, so dig or fill until it fits; the
  footprint goes red where it doesn't. Once standing, it builds one
  **fighting mech** at a time from ore plus salvage (§ Design), and the new
  mech walks out onto its pad, parked.

### Swapping mechs

You have a **crew**: the mechs on your side that you can drive. A mission
starts with the digger and one fighter (a KESTREL). The factory adds more.

- **SWAP** (TGT held, or Q): the cockpit cuts to the next mech in your
  crew with a short static wipe and a thunk. The voice says `Digger.` or
  `KESTREL.` The mech you left stays where it is, **parked**. In this
  first version it doesn't think: it stands, takes hits, and doesn't move.
  It can be hit, and it can die.
- The HUD's crew strip shows a small chip per crew mech, so you know who is
  where and who is hurt.

### The raid

Foes come in waves (the existing wave system, spec 03). Each wave is
called out `RAID WEST. Two JACKALs.` a few seconds early and goes for the
**buildings**, not just you. Foes shoot at the silo and the factory, and
at anything parked in the way.

- **Salvage:** a foe you knock down leaves its wreck (as today). Walk any
  of your mechs over the wreck and its salvage goes to the silo: `SALVAGE
  IN.` The wreck stays as scenery.
- **Winning:** survive the last raid with the silo standing (the mission's
  objectives, in the usual way). **Losing:** the silo falls, or every
  mech in your crew is down.

### The mission

One mission, **FIRST FACTORY** (placeholder), outside the campaign at
first: on the DEBUG tab's JUMP TO and in Free Play's MAP picker as BASE. It
has a dusk map with a rocky mesa near the start to dig into, the silo at
the start, the digger and a KESTREL, and three raids, each bigger.

The new text, in full (tone-checked by `test/tone.test.js` where it
applies):

| Where | Text |
|---|---|
| brief | `Dig the rock. Fill the silo. Build a factory. Keep the silo safe.` |
| digger role | `IT DIGS.` |
| HUD | `ORE` · `SALVAGE` · `HOPPER FULL` · `BUILD` · `NO ROOM` · `SWAP` |
| voice | `Ore in.` · `Salvage in.` · `Factory up.` · `New mech ready.` · `Raid west. Two JACKALs.` · `Silo hit.` · `Digger.` (the name of the mech you swapped to) |

## Design

### Numbers (`src/data/construct.js`, starting values to tweak in play)

| Key | Value | What |
|---|---|---|
| `bucket` | 6 m | The digger's bite (a radius). It digs rock at full size, as BIG DIGS does: a construction tool, not a battle blast |
| `hopper` | 40 ore | What the digger carries |
| `orePerCorner` | 4 | Ore per rock corner the bite turns to air (rock = below the soft band, spec 18) |
| `factory` | 60 ore | The factory's price |
| `buildTime` | 6 s | The factory going up |
| `mechCost` | { ore: 50, salvage: 30 } | One fighting mech from the factory |
| `mechTime` | 30 s | Building it |
| `salvage` | by chassis: light 10, medium 20, heavy 35, assault 50 | What a wreck gives |
| `startOre` | 20 | In the silo at the start |
| `siloHp`, `factoryHp` | 600, 400 | Structure hit points |

### Ore is rock you dig

There is no new material in the ground yet. **Ore is rock**: the corners
below the soft band (spec 18's 6 m, measured from the ground as built).
A bite counts the rock corners it turns from solid to air, times
`orePerCorner`. It is worked out in `sim/dig.js` from the bytes before and
after, so it is the same however the bite lands, and it is the same on
every client (for later; this version is single player).

So landmarks are worth digging: a mesa or an arch is solid rock. The
torque rule (spec 18) still holds, so undercut one and it falls, onto you
if you stand under it.

### Buildings are entities

The silo and the factory are mission **entities** (`sim/entities.js`):
structures with hit points, a pad and a footprint. They work like today's
relays and tanks, with two new behaviours:

- **Footprint check:** the factory needs its footprint (a 24 m square)
  flat to within 2 m and clear of mechs, using the ground's height query.
- **A queue:** the factory turns ore and salvage into one mech at a time
  (`mechTime`). When it's done, a `kestrel` with the stock fit stands on
  its pad and joins the crew. This version only builds the KESTREL.

### The crew and swapping

`G.crew` is the list of team-0 mechs you can drive; `G.player` is the one
you are in. SWAP moves `G.player` to the next live crew mech and moves the
camera, the HUD and the inputs with it. A parked mech has `ai.parked`: it
stands, like the range's still foes (`stand()`, spec 19). Ordering parked
mechs about comes later.

### Raids go for buildings

A raid's foes pick a target the way escort foes pick a truck (`ai.js`
`convoyTarget`, `attackConvoy`): the nearest standing building, or a crew
mech within 120 m of them, or you. Each raid is a mission wave
(`waves: [{ at, foes, from }]`) plus a flag that sends it at the base.

### Edge cases

- **Swapping while hurt:** you can swap out of a mech that is shut down or
  falling. You can't swap into a dead one; the strip greys it out.
- **Deaths:** if the mech you are driving dies, you go to the next live
  crew mech after the death beat. If none are left, the mission is lost.
- **Hauling:** the hopper keeps its ore if the digger is hit. If it dies,
  the ore in it is lost.
- **Nothing left to dig:** if there's no rock in reach (a bite in soft
  ground or air), the bucket digs and gives nothing.
- **Single player only:** no network message changes, so no `PROTOCOL`
  bump. Co-op and the arena come later (§ Room to grow).

### As built in #308

- **The digger** (`CHASSIS.digger`, the owner named it BIG SCOOPER; role
  `IT DIGS.`) is safety yellow with black hazard stripes, an open hopper on
  its back, an exhaust stack, short thick legs and two buckets (the `fist`
  part, so they swing like PURPLE PUNCHER's fists and take turns). `tools`:
  no guns and no fusion cannon, so FIT is hidden. Its kit line comes from
  `names.js`.
- **Where you get it:** it isn't in the selector yet. `?debug=1` offers it
  after the fighting chassis (`PILOTABLE`). MULTIPLAYER refuses it with
  `THE BIG SCOOPER STAYS HOME. PICK ANOTHER MECH.` The foe rosters (contracts, Free
  Play's mixes) still use the fighting chassis only.
- **The bite** (`BUCKET_MELEE`, `bucketBite` in `sim/melee.js`, `bite` in
  `sim/dig.js`):
  - With no mech or structure in reach, the bucket casts two rays from its
    height along the view. The first is nearly level, for a wall or a mesa
    face (mining). The second is tipped well down, for the floor (a pit).
  - It bites where the ray hits, half a bucket *into* the rock. Centred on
    the surface, a 6 m bite often reached no solid corner, since corners are
    8 m apart.
  - A mech in reach is shoved instead, and nothing is dug.
- **Ore:** `voxels.js` `dig` takes a `tally` and counts the corners under the
  soft band it turns from solid to air. A 6 m bite in solid rock turns two to
  four, so `orePerCorner` is 4: about four bites fill the 40-ore hopper. A
  bite into a mesa's face often turns one corner. Bites in either order give
  the same ground and the same ore.
- **Online,** a bite is a plain synced dig with no ore, though the digger
  can't be taken online yet anyway.
- **HUD:** shows `HOPPER` or `HOPPER FULL`, the count and a bar where the
  weapon list goes.

### As built in #310

- **`sim/crew.js`:**
  - `G.crew` is you, then a mission's `crew: [{ type, at, face }]`, parked where they stand. A match without one is a crew of one, so nothing changes for the rest of the game.
  - `swap(G)` moves `G.player` to the next live crew mech. It parks the one you leave (no throttle, no jets, no beam) and clears your target and any missile you were guiding. The voice says the new mech's name, and its caption shows it.
  - `update.js` makes a parked mech `stand()` every frame, like the range's still foes. It coasts to a stop and stays put.
  - SWAP is ignored in the arena.
- **Deaths:** when the mech you're in dies and another crew mech is standing, it's `MECH DESTROYED`, not the end. The next live one is yours after `HANDOVER` (2.2 s). With none left, the mission is lost as before.
- **Foes:** in single player with a crew, foes go for the nearest live crew mech (`preyOf`, the way a co-op host's foes pick a pilot). A parked mech gets attacked.
- **Controls:**
  - Q on the keyboard.
  - The gamepad's D-pad right.
  - TGT held 0.45 s on touch. With a crew, a tap on TGT picks the next target on release; without one, it picks on the press, as before.
  - The controls tables say so.
- **HUD:**
  - **Crew strip:** with two or more mechs, a line each with its torso's health. The one you're in is amber and marked ▶, and a dead one is dark red. It sits under HOSTILES on desktop, and left of the radar on a phone, where it clears the buttons.
  - **Swap wipe:** a 0.3 s static wipe follows a swap.
- **The range:** the test range gets a CREW picker (JUST YOU, + KESTREL, + the digger) to try it before FIRST FACTORY.

### As built in #309

- **Where:** `sim/base.js`, with the numbers and building shapes in `data/construct.js` (`BUILDINGS`).
- **The silo:** a mission with `base: { silo: [bearing°, dist] }` gets a silo entity (team 0, 600 hp), facing the map's centre, and `G.base = { ore, salvage, silo, factory }` with 20 ore.
  - A crew mech carrying ore within 14 m of the silo's pad (in front of it) empties into it. For the mech you're in, the voice says `Ore in.` and `ORE IN` shows.
- **BUILD:** the missile button while you drive a `tools` mech (the digger), in `update.js`. Held, the footprint shows.
  - It's a 24 m square whose near edge is 14 m in front of you, drawn on the ground in green, or red with `NO ROOM`.
  - Under it sits `BUILD · 60 ORE`.
  - Let go, and the factory goes there for 60 ore.
- **The footprint check:** ground within ±2 m across 25 samples, no mech on it, no building on it.
- **Going up:** the factory rises over 6 s (`prog`, its height growing with it), its door toward you. The voice says `Factory up.`
- **The queue:** once up, the factory starts a mech whenever the silo holds 50 ore and 30 salvage, and takes them.
  - 30 s later a stock KESTREL stands on its pad, parked, and joins `G.crew`. The voice says `New mech ready.`
  - Salvage only comes in with #311. Until then a mech can't be built in play.
- **HUD:**
  - The crew column shows `ORE n  SALVAGE n` (amber; dark red if the silo is down).
  - The factory's state shows as `FACTORY 40%`, `NEW MECH 12 s`, `FACTORY` or `FACTORY DOWN`.
- **The bucket:** it no longer bites or punches its own side's buildings.
- **Meshes:** the silo (a steel bin with hazard bands and a cone roof, a chute to a striped pad) and the factory (a concrete shed with a saw-tooth roof, a striped door and a chimney) are props with wrecks, under 120 triangles each.
- **Trying it:** the test range gets a BASE picker (NONE, SILO).

## Code touchpoints

- `src/data/construct.js` (new): the numbers above.
- `src/data/chassis.js`, `src/data/geo.js`, `src/data/names.js`: the
  `digger` chassis with its body (a wide, slow biped with a bucket arm and
  a hopper; treads come later) and placeholder names.
- `src/sim/dig.js`: `bite(G, m, p)` digs with the bucket and returns the
  rock corners removed; `src/world/voxels.js` `dig` reports that count.
- `src/sim/melee.js`: the digger's punch is a bite.
- `src/sim/base.js` (new): the silo and factory as entities, unloading,
  salvage, the factory's queue, the footprint check.
- `src/sim/crew.js` (new): `G.crew`, `swap(G)`, and parked mechs.
- `src/sim/ai.js`: raiders go for buildings.
- `src/sim/objectives.js`: a `keep` objective (this structure stands) and
  a lost-when-the-crew-is-down rule.
- `src/data/missions.js`: FIRST FACTORY.
- `src/render/hud.js`: ORE, SALVAGE, the hopper, the crew strip, the BUILD
  footprint.
- `src/input/*`: SWAP (TGT held, Q, a gamepad button) and BUILD (missile
  button while driving the digger).
- `src/ui/debugMenu.js`, `src/ui/screens.js`: the mission on JUMP TO and
  in Free Play.

## Acceptance criteria

1. In FIRST FACTORY, the digger's punch digs rock, fills the hopper by the
   rock removed, and soft ground gives nothing.
2. Walking the digger onto the silo's pad empties the hopper into the silo.
3. BUILD places the factory on flat ground for its price, refuses where it
   doesn't fit, and it goes up over `buildTime`.
4. The factory builds a KESTREL from ore and salvage, and it joins the
   crew.
5. SWAP moves you between crew mechs; the one you leave stays parked, and
   it can be hit.
6. Raids are called early and go for the buildings; wrecks give salvage.
7. Surviving the last raid with the silo up wins. Losing the silo, or the
   whole crew, loses.
8. All of it works on a phone held sideways with two thumbs, with no new
   on-screen control.
9. Perf budgets hold.

## Tests

- `test/construct.test.js`: ore counted from rock corners (soft gives
  none); the hopper caps; unloading; the factory's price, footprint and
  build time; its queue makes a KESTREL that joins the crew; salvage per
  chassis.
- `test/crew.test.js`: swap order, parked mechs stand still and take hits,
  swapping past dead mechs, losing when the crew is gone.
- `test/raid.test.js`: raiders go for the nearest building; `keep` fails
  when the silo falls.
- Smoke: FIRST FACTORY from JUMP TO. Dig, unload, place the factory, swap,
  and see ORE and the crew strip.
- Playtest on a phone: one whole mission.

## Performance

A bite is a dig (spec 18's budget) plus a count over its box. Buildings are
a few entities. The crew strip and counters are a handful of HUD draws. A
parked mech costs what a still foe does.

## Room to grow

Each loop gets one step here. Each item below can be a spec of its own and
adds to this one without reworking it.

- **Mining:** ore seams as a material layer in the ground, shown as
  coloured bands, so you dig toward them. Deeper means richer. Dirt the
  digger carries and dumps as ramps and berms. Bigger hoppers and faster
  buckets as parts. More construction mechs (dozer, crane, mixer).
- **Building:** more buildings (a weapon shop, a repair bay, walls, turrets
  if wanted). Buildings fall by the torque rule like the ground. Placing on
  ground you levelled.
- **The factory:** more chassis and parts; parts into the mechlab; choosing
  what to build.
- **Defending:** orders for parked mechs (hold, follow, guard the silo,
  keep digging). Repairs at the base. Smarter raids that dig.
- **Conquering:** going out to an enemy factory, breaking it for salvage,
  claiming its seams. A rival crew that plays by the same rules.
- **Campaign and multiplayer:** a base act in the campaign (Act I fights,
  Act II the digger, Act III the factory). Co-op roles (one digs, one
  defends; this needs a `PROTOCOL` bump for ore, building and swaps).
  Whether the base carries between missions.

## Open questions

1. **Salvage in this first version, or ore only?** Recommended default:
   both. Salvage makes fighting feed the factory, so both arms matter from
   the start.
2. **Hauling or instant?** Recommended default: hauling, with a generous
   hopper. It's the reason to defend the digger.
3. **Parked mechs:** stand still, or keep doing their last job (keep
   digging, keep shooting)? Recommended default: stand still for now. Orders
   come next.
4. **The factory's first product:** a whole KESTREL, or parts (armour,
   repairs) for the mechs you have? Recommended default: a whole KESTREL. It
   is the mech-factory fantasy in one step, and it shows off swapping.
5. **Names:** the digger, the silo, the factory, the mission, ORE and
   SALVAGE are placeholders, picked by the owner after seeing them
   (`workflow.md` § Naming).

## Issues

1. **#308 The digger and its bucket** (M): the chassis and body, the bite (dig
   plus rock count), the hopper, the HUD.
2. **#309 The base: silo and factory** (M): the entities, unloading, BUILD and
   the footprint check, the factory's queue, ORE and SALVAGE on the HUD.
3. **#310 The crew and SWAP** (M): `G.crew`, swapping, parked mechs, the crew
   strip, losing when the crew is down.
4. **#311 Raids and salvage** (S): raiders go for buildings, wrecks give
   salvage, the `keep` objective.
5. **#312 FIRST FACTORY** (S): the mission, on JUMP TO and in Free Play, the
   smoke test, a phone playtest, NAMING.
