# The forest

| | |
|---|---|
| Status | in progress: part 1 built (the tree field). Approved (the owner merged it, then "start the forest", 2026-11-05); first asked for 2026-11-05: "Also what about a forest biome?"; "I think thick woods becomes more interesting. Especially if fog is involved. Very close range" |
| Milestone | M16 (proposed, with or before spec 38's city) |
| Size | L, in five parts (the tree field; crushing and toppling; concealment and the mist; fighting up close; the arena) |
| Depends on | [07-atmosphere.md](07-atmosphere.md) (fog, weather, props), [13-thunk.md](13-thunk.md), [14-look-and-performance.md](14-look-and-performance.md), [35-bigger-maps.md](35-bigger-maps.md), [38-buildings.md](38-buildings.md) (rigid pieces) |
| Touch parity | nothing new to press; the radar and the sound carry more of the fight, on both |

## Summary

Thick woods in mist: you see 60–120 m, foes are on top of you before you
see them, and the trees are both cover and something to smash through. The
city (spec 38) is hard cover; the forest is **concealment**. It makes
brawlers and short-range weapons count, makes the radar and your ears
matter, and every fight leaves lanes of flattened trees behind it.

## What's there today

- Biomes: `dusk`, `ice`, `volcanic` (palettes and `world/props.js` SINGLES).
  The ice biome has `deadTree` props: entities, one draw each.
- Fog weather (`data/weather.js`): fog distance ×0.3, radar ×0.6. Foe
  sight is cut by the same weather (`ai/perception.js sightOf` uses
  `radarOf`), so fog already hides you from the AI, but only by distance.
- Sight is the ground only (`sim/sight.js blocked`); props don't block it.
- Effects are drawn one call per shape (spec 14 P1); props are one draw each.

## Player experience

Free Play, FOREST. Mist, dark trunks close on every side, a pale clearing
ahead. The radar shows two contacts 150 m off and you can't see either.
You hear footfalls to the left, heavy and slow. A shape comes out of the
grey at 70 m, a SLOWPOKE, already turning its guns. You charge, flattening
saplings, and punch it before its missiles can lock. Behind you, the path
you smashed through the woods stays smashed. On the map, the woods show
where every mech has been.

### New text (for the tone check)

- Free Play's MAP: `FOREST` (placeholder; NAMING in its PR).
- Voice, after the fact: `Timber.` when a tree you pushed or shot comes
  down on a foe (candidate; flat alternative `Tree down.`).

## Design

### 1. The tree field

- Trees aren't entities and aren't voxels (one 4 m cell is a whole tree).
  They're a **field**: `G.trees = { x, z, kind, size, state }` as typed
  arrays, one entry per tree, made from the seed by `world/forest.js`.
  `state`: 0 standing, 1 falling, 2 fallen. A few bytes a tree, so 20,000
  trees is a few hundred KB.
- **Kinds:** pine (tall, narrow), broadleaf (round, wider), sapling (small,
  thick undergrowth); `size` scales each. Low-poly, flat-shaded, in the
  palette's greens; seasons are a palette (summer, autumn) later.
- **Thick woods:** trees every `TREES.gap` (7 m) on average, thinned by
  a noise field into **clearings** (`TREES.clear`, 30–80 m across), and
  cut by a few **paths** (old logging roads, 12 m wide, flat). Steep slopes
  and the start, pads and mission zones stay clear.
- **Drawn** one call per kind per ground square (spec 35's 256 m squares),
  instanced (per-tree position, yaw, size, state), only out to the fog's
  end: in mist that's ~120 m, so few squares are drawn at once.
- **The map** draws the woods as a dark canopy, clearings and paths open.

#### As built (part 1)

- `world/forest.js plantTrees`: a jittered grid (2 × 2 to a 16 m cell, so
  about 8 m apart), kinds by share (`data/forest.js TREES.kinds`), cut into
  clearings by a noise field (`TREES.clear`), three straight old roads, no
  tree on slopes over `TREES.slope` or in `avoid`. About 51,000 trees on
  today's map; typed arrays sorted by cell.
- Sizes, after seeing them from the cockpit: pines 18–28 m and broadleaves
  16–22 m tall, crowns over the cockpit (a mech's eye is about 8 m up), so
  the woods are trunks at eye level and canopy above; saplings 3–5 m.
- `sim/trees.js`: `initTrees` (forest biome only; clear of the start 45 m,
  the zones, the structures and every mech's footing), `pushOutOfTrees`
  (trunks stop mechs; saplings don't), `settleTrees` (trees ride dug ground
  down). Crushing, shoving and felling are part 2.
- Drawn through the props' instanced program (`render/propBatch.js
  batchTrees`, one draw per kind), cells culled whole; in the cockpit out to
  the fog's end, from above round the map view's focus out to `TREES.draw`
  (250 m). Its buffer grows once to the biggest batch.
- The forest palette (moss, bark, needles; fog 30–140 m by day, 20–95 at
  night), the `mist` weather (fog ×0.6, radar ×0.8, a muffled bed), the
  forest's ambient bed (wind in the canopy over a low hush), and FOREST at
  the end of Free Play's MAP (so saved picks keep their place).
- **Foes can't see much past the fog** (`ai/perception.js sightOf`): never
  past 1.1 × the palette's own fog end. Only the forest's fog is shorter
  than foes' sight, so nothing changes elsewhere (fog weather still cuts
  sight by its radar factor, as before).
- The map's canopy: Free Play has no map view (no crew); a forest mission
  with a crew sees the trees in 3D round the focus. A drawn canopy waits for
  a forest mission.
- Known: walking right up to a pine, its lowest boughs can brush the
  cockpit (a mech stops 3 m from the trunk; the lowest cone reaches about
  3.3 m at eye height). Part 2 looks at it with the shoving.

### 2. Crushing and toppling

- **Saplings** give way to any mech walking through them: they fold flat
  (state 2) with a rustle and a small thud. No slowing.
- **Trees** stop you like props do (a trunk-sized footprint), unless the
  mech is heavy enough (`TREES.push`, by chassis tons) to shove through,
  which fells it the way you're going and costs a little speed.
- **Punched or shot**, a tree falls: it's a rigid piece (spec 38 § 4's
  `sim/pieces.js`, built here first on the simplest shape): it pivots at
  the stump away from the hit, falls, lands with the thunk by its size,
  and **crushes** what it lands on (spec 18's crush damage, by size).
  `Timber.` when it lands on a foe.
- **Fallen trees** stay where they lie as scenery you walk over (no
  footprint; feet plant on the ground under them, the invariant holds). A
  fight leaves lanes; the map shows them.
- Explosions fell trees in their radius, outward.

### 3. Concealment, and the mist

- **The woods hide you.** Sight through woodland fades with how much of it
  is in between: along the line, the metres that pass through standing
  forest (sampled every 8 m against a coarse **density grid**, 16 m cells,
  made with the field and updated as trees fall) cut the sight range by
  `TREES.hide` (each 10 m of woods takes 15% off). A mech 60 m deep in the
  trees is hidden past ~70 m; at the woods' edge it isn't hidden at all.
  This goes into `sim/sight.js` (so the AI uses it, and the editor's
  shading) and the HUD's target brackets (you can't lock what you can't see).
- **The mist:** the forest's palette has short fog (`fog: [30, 140]` m) by
  day, shorter in its fog weather (`mist`: fog ×0.6, radar ×0.8). The radar
  still works: it's what you fight by at range.
- **Sound carries:** foes' footfalls and gunfire are heard from further
  than they're seen (sounds are already placed by where they happen, `audio/`), and a little louder in the
  woods, so you can tell where the radar blip is heavy and coming.

### 4. Fighting up close

- **The AI in the woods:** a foe that isn't seen holds still among trees
  (an ambush, by difficulty: HARD waits, EASY wanders), uses woods as
  cover the way `useCover` uses ridges, and closes fast when it's found.
  Brawler chassis do well; snipers (`ridgeRelocate`) look for clearings.
- **Weapons:** missiles still need their lock, which needs sight: in the
  woods, short-range guns and fists win. Nothing about the weapons changes
  (no balance numbers move in this spec); the ground does the work.
- **The HUD:** a foe heard but not seen gets a faint pointer at the edge
  (`HEARD`), so the fog is tense, not blind.

### 5. The arena

- Trees falling must match on every screen: a felled tree is sent as its
  index and direction (a new message, so `PROTOCOL` goes up). Until then
  (part 5) forests are campaign and Free Play only.

### Fire

Not in this spec. Lasers and the fusion cannon setting trees alight, fire
spreading and burnt stumps would be a later one (it's the costliest for the
frame).

### Numbers (`src/data/forest.js` `TREES`, starting values to tune in play)

| key | value | what |
|---|---|---|
| `gap` | 7 m | trees' average spacing in thick woods |
| `clear` | 30–80 m | a clearing across |
| `push` | 60 t | a mech at least this heavy shoves through trees |
| `hide` | 15% a 10 m | sight lost to woods in between |
| `cell` | 16 m | the density grid's cells |
| forest palette fog | 30–140 m | the woods' own mist |
| `mist` weather | fog ×0.6, radar ×0.8 | the forest's fog |

These are new numbers, so this spec is the balance issue for them.

## Code touchpoints

- `src/world/forest.js` (new): the field (kinds, density, clearings,
  paths), pure from the seed; the density grid.
- `src/data/forest.js` (new): `TREES`; `data/palettes.js` the forest
  palette; `data/weather.js` `mist`; `data/names.js` `FOREST`.
- `src/sim/trees.js` (new): crushing, shoving, felling, the density grid's
  updates; headless tests.
- `src/sim/pieces.js` (new, shared with spec 38): rigid pieces.
- `src/sim/sight.js`: woods in the line of sight.
- `src/sim/ai/behaviours.js`, `ai/profiles.js`: holding still, woods as cover.
- `src/mesh/trees.js` (new), `src/render/trees.js` (new): instanced trees by
  kind and square, out to the fog's end.
- `src/render/hud.js`: `HEARD`; `ui/command.js` the canopy on the map.
- `src/ui/screens.js`: FOREST in Free Play's MAP.
- `scripts/perf.mjs`: `forest` and `forest-fight` scenes.

## Acceptance criteria

1. Free Play has FOREST: thick woods with clearings and paths, in mist,
   from the seed, the same on every client.
2. Any mech walks through saplings; heavy mechs shove through trees; a
   punched or shot tree falls away from the hit, crushing what's under it.
3. Fallen trees stay and the map shows the lanes.
4. A mech deep in the woods is hidden from a foe past ~70 m, and seen at
   the woods' edge; the same rule for the player's target brackets.
5. Foes hold still in the woods and use them as cover.
6. A forest map holds the frame on the iPhone 13 mini, with thousands of
   trees.
7. Each part works on a phone held sideways (checked on a real phone).

## Tests

- `forest.test.js`: the same seed, the same trees; clearings and paths
  clear; nothing on the start or zones; the density grid.
- `trees.test.js`: saplings fold under any mech; a light mech is stopped by
  a tree and a heavy one shoves it over; a punched tree falls away from the
  fist and crushes a mech under it; explosions fell outward.
- `sight.test.js`: sight through 60 m of woods is cut, through the edge it
  isn't; a felled lane lets sight through.
- `ai` tests: an unseen foe in the woods holds still on HARD.
- Smoke: `forest`: start FOREST, walk through saplings, punch a tree down.
- Perf: `forest` (walking through the woods) and `forest-fight` (four mechs
  felling trees) with draws, triangles and frame budgets.

## Performance

- Memory: a few bytes a tree, and a density grid of 16 m cells.
- Draws: one per kind per square in view; in mist, a handful of squares.
  Triangles are the cost: trees are kept to a few dozen each, and the fog's
  short end keeps the count down.
- Sight: a sight check samples the density grid every 8 m (a few dozen
  lookups), only when the AI looks (`lookEvery`).
- Falling trees: at most 4 rigid pieces at once (spec 38's cap).

## Build order

1. **The tree field:** the generator, the look (three kinds), instanced
   drawing, the map's canopy, FOREST in Free Play, the perf scenes.
2. **Crushing and toppling:** saplings, shoving, rigid felling and crushing
   (`sim/pieces.js`, which spec 38 part 3 then builds on).
3. **Concealment and the mist:** the density grid in `sight.js`, the
   forest's fog, `mist`, sound carrying.
4. **Fighting up close:** the AI holding still and using woods, `HEARD`.
5. **The arena:** felled trees on the wire (`PROTOCOL`).

One PR each.

## Open questions

1. **How thick?** *Default (the owner): thick woods, clearings and paths;
   trees every 7 m on average.*
2. **Who shoves through trees?** *Default: any mech folds saplings; 60 t and
   up shoves through grown trees; anyone fells one with a punch or a shot.*
3. **How much do woods hide?** *Default: 15% of sight per 10 m of woods, so
   deep woods hide you past ~70 m.*
4. **Fire?** *Default: a later spec.*
5. **Kinds and seasons?** *Default: pine, broadleaf and saplings; seasons
   later as a palette.*
6. **Before or with the city?** It's smaller, has no memory question, and
   builds the rigid pieces spec 38 needs on the simplest shape. *Default:
   before spec 38's part 3.*
