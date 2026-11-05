# Buildings, and the city

| | |
|---|---|
| Status | draft (the owner, 2026-11-05: "I think we will want an urban biome so this should require more planning of how buildings are managed"; "Voxels seem like the right way to go but i want to make sure its not just ground that looks like buildings") |
| Milestone | M16 (proposed) |
| Size | L, in six parts (measure; building records and concrete; rigid falls; the generator and the city; streets for the AI and props that break; outposts and the editor) |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md), [29-ground-4m.md](29-ground-4m.md), [35-bigger-maps.md](35-bigger-maps.md), [37-tunnelling.md](37-tunnelling.md), [13-thunk.md](13-thunk.md), [07-atmosphere.md](07-atmosphere.md) |
| Touch parity | nothing new to press: buildings are shot, punched, dug and walked round as the ground is |

## Summary

A building in Stompy is stored as voxels, so it gets everything the ground
already does (it stops you, hides you, takes craters, can be dug under and
undermined), but it **behaves like a building**: it knows what it is, it's
made of concrete, it has storeys, and when it's cut loose it tips and falls
as one piece rather than crumbling like a hillside. That's what an urban
biome needs, and it fixes today's bug: the outposts' blocks are only drawn,
so mechs walk through them.

## What's there today

- **The outposts' blocks** (4 outposts × 7 blocks, 9–23 m across and up to
  29 m tall, a 44 m radio mast each) and **about 150 boulders** are baked
  into a drawn-only mesh (`world/terrainMesh.js buildGroundExtras`). The sim
  doesn't know they exist: mechs walk through them, shots and sight pass
  through them, and they hang in the air if the ground under them is dug.
- **Props** (bunkers, crates, tanks, pipes, walls, masts, dead trees,
  spires, vents; `world/props.js`) are entities with round footprints and
  `hp: Infinity`: they stop you, but a shot only sparks; one breaks only
  when the ground under it goes (`dig.js settle`).
- **The ground** is a voxel grid of 4 m cells (spec 29), a byte of density
  per corner, in chunks of 16 that are shared when all air or all rock
  (spec 35). Material is by depth only (the soft band, `SOFT`); there is no
  material channel. Cut-loose ground falls straight down as loose cells
  (`voxels.js islands`, `fall`, the torque rule), and big falls shatter.

## Player experience

A city at dusk: low blocks with a few towers, streets between them, lit
windows coming on as it gets dark. You walk down a street and the buildings
stop you; you blast off onto a roof. A foe ducks behind a block and you
can't see it, so you shoot the corner off: concrete chunks and dust, a
crack, and the floor above sags. Shoot the last column out and the top
storeys pancake down with a thunk you feel. Cut a tower at its base and it
tips, slowly, then fast, and lays itself across the street, crushing the
JACKAL that was hiding behind it. `BUILDING DOWN.`

Underground (spec 37), you dig under a block and it drops into its hole and
breaks.

### New text (for the tone check)

- Status: `BUILDING DOWN.` (exists for the base; now for any building).
- Map labels: building kinds as placeholders, `BLOCK`, `TOWER`, `WAREHOUSE`,
  `RELAY` (in `names.js`; NAMING in the PR that shows them).
- Objectives (later missions): `DESTROY THE RELAY TOWER`, `KEEP THE DEPOT
  STANDING`.

## Design

### 1. A building knows it's a building

- `G.buildings = [{ id, kind, box: [x0, y0, z0, x1, y1, z1], yaw, storeys,
  cells, left, down }]`: made by the generator, one record per building.
  `cells` is how many concrete cells it was built with; `left` is how many
  are still standing in its box, recounted when a dig or fall touches the
  box (not per frame).
- **Down** at `BUILD.down` (40%) left: `BUILDING DOWN.` once, it counts for
  objectives (`destroy`, `keep`), and the map shows it as rubble.
- The map shows each building's outline and its kind; the HUD can target
  one (its marker and how much is left), and MARK (spec 37) can mark it.
- Rubble on the ground keeps its building's id (so a heap is that tower's
  heap, and can be told from the hillside).

### 2. It's made of concrete

- A **material channel**: concrete cells are marked in the voxels. How
  (decided by part 1's measurement): a second byte per corner only in
  chunks that hold concrete (copy-on-write as spec 35's chunks), or the top
  bit of the density byte if the mesher's threshold allows it.
- **Look:** the palette gains `concrete` and `glass` colours. The mesher
  colours concrete faces by height in storey bands with darker window
  rows (no textures: per-face colour, as seams are drawn today, spec 21). At
  night some windows are lit (a share by the building's id; spec 07's dark).
- **Hits:** a shot or punch on concrete throws concrete chunks (grey
  debris, `particles.js`) and sparks, never clods or dirt. A crack and a
  thud (`sfx.concrete`), glass breaking on the first hit in a storey.
- **Harder than rock:** a concrete cell takes `BUILD.hard` (2×) the dig of
  a rock cell to clear, and holds no ore or isotopes (`seams.js` skips it).

### 3. It's built like a building

- **Hollow:** walls one cell thick, a floor every storey (`BUILD.storey`, 2
  cells, 8 m), a roof. Inside is air, but at 4 m cells a room is about the
  size of a mech's leg, so there is **no going inside** (a mech-sized gap
  only exists where destruction opened one).
- **Shots go through walls into rooms:** a crater in a wall opens the room
  behind it; the next hit goes on to the far wall.
- **Floors hang on walls:** the support rule for concrete is tighter than
  rock's torque rule (`BUILD.span`, how far a floor holds out from a wall
  or column), so knocking out a building's supports drops the floors above
  onto the ones below: a pancake, not a crumble.

### 4. It falls like a building

The biggest difference from ground, and the riskiest part.

- When a piece of concrete comes loose (an island, or a floor past its
  span), it doesn't fall as loose cells. It becomes a **rigid piece**: its
  cells are lifted out of the grid into one mesh with a centre of mass, it
  pivots about the edge it was standing on and tips, rotates and falls as
  a whole, and where it lands it **breaks**: the cells go back into the
  grid as rubble (a heap, as `fall` makes today) with dust and the thunk.
- **A tower cut at its base** tips toward the side that went and lays
  itself down along that line; what it lands on is crushed (spec 18's crush
  damage, by the piece's mass).
- **The thunk** scales with the piece's mass and drop: camera, sub-bass,
  dust (spec 13), felt to `BUILD.feel` (200 m).
- Pieces are capped (`BUILD.pieces`, 4 falling at once); past that, the
  oldest breaks where it is.
- Arena and co-op: a rigid fall is decided where digs are confirmed and
  sent as one message (the piece's cells, pivot and direction), so every
  client sees the same fall and the same rubble. A new message, so
  `PROTOCOL` goes up with it; until then (part 3) cities are single player.

### 5. The city

- **The urban biome** (`city`): streets on a grid, slightly bent; blocks
  between them; **sprawl with some towers** (most buildings 2–5 storeys,
  one in ten a tower of 8–20); districts (houses, offices, an industrial
  edge of warehouses); a few landmarks (a relay tower, a depot, a plaza).
  From the seed, like everything else.
- The streets are flat (the ground's flat zones, spec 18), wide enough for
  two mechs (`BUILD.street`, 24 m), so they're lanes for a fight.
- Lit at night; dust and rubble in the streets after a fight.
- **The outposts** in the other biomes become small towns made by the same
  generator (a few blocks and the mast), which fixes the walk-through bug.
  The baked boulders go into the voxels as small lumps of rock, or go.

### 6. Streets for the AI, and props that break

- **The nav grid** (32 m squares today, `ai/nav.js`) is too coarse for
  24 m streets. Part 1 measures a finer one (16 m) over the city only;
  rubble is walkable as ground is.
- **Cover:** the AI's cover picking (`ai/behaviours.js useCover`) already
  rays the ground, so buildings count without change; it's tested in the
  city.
- **Props get hp by size** (crates, pipes, walls a punch or a few shots;
  bunkers and tanks real fire; masts topple), each breaking into its wreck
  mesh with debris and a thunk. **Walking into** crates and fences crushes
  them (a small thunk); bunkers and tanks stop you. Vents and spires are
  terrain and don't break.

### Numbers (`src/data/buildings.js` `BUILD`, starting values to tune in play)

| key | value | what |
|---|---|---|
| `down` | 40% | left standing, below which a building is down |
| `hard` | 2× | the dig a concrete cell takes against rock |
| `storey` | 2 cells (8 m) | one storey |
| `span` | 3 cells (12 m) | how far a floor holds out from a wall or column |
| `pieces` | 4 | rigid pieces falling at once |
| `feel` | 200 m | how far a falling piece is felt |
| `street` | 24 m | a street's width |
| `towers` | 1 in 10 | buildings that are towers |

These are new numbers, so this spec is the balance issue for them.

## Code touchpoints

- `src/world/voxels.js`: the material channel; `build` for concrete
  boxes (walls, floors, roof); concrete's support rule next to the torque
  rule; rigid pieces lifted out and put back.
- `src/world/mesher.js`: concrete's colours, storey bands and windows.
- `src/world/city.js` (new): the generator (streets, blocks, districts,
  landmarks), pure from the seed; `world/props.js` outposts use it.
- `src/sim/buildings.js` (exists, spec 36: the base's buildings by kind):
  the city's building records next to the base's, `left`, down, objectives.
- `src/sim/pieces.js` (new): rigid pieces: pivot, tip, fall, land, break,
  crush. With a headless test.
- `src/render/scene.js`, `render/ground.js`: falling pieces drawn as their
  own meshes; `buildGroundExtras` loses the outposts.
- `src/sim/ai/nav.js`: the finer squares over a city.
- `src/data/palettes.js`: `concrete`, `glass`; `src/data/names.js`:
  building kinds; `src/data/buildings.js`: `BUILD`.
- `scripts/perf.mjs`: a `city` scene and a `city-collapse` scene.
- `docs/architecture.md`: the material channel, `city.js`, `pieces.js`.

## Acceptance criteria

1. Mechs can't walk through any building or outpost block; shots and sight
   stop at them.
2. A building takes craters as concrete (its own debris, sound and colour)
   and goes down at 40% left, with `BUILDING DOWN.` and its objectives.
3. Knocking out a building's supports drops its floors onto each other.
4. A tower cut at its base tips over as one piece, lands across the
   street, breaks into rubble and crushes what's under it.
5. The city biome generates from the seed, the same on every client, with
   streets the AI walks and fights in.
6. Props break by size; crates and fences crush underfoot.
7. A city map holds the frame and fits in memory on the iPhone 13 mini
   (checked on the phone, and in `npm run perf`).
8. Each part works on a phone held sideways (checked on a real phone).

## Tests

- `voxels` tests: concrete cells and the material channel round-trip;
  concrete's support rule drops a floor past its span; rigid pieces lifted
  out and put back leave the same cell count.
- `city.test.js`: the same seed gives the same city; streets are clear and
  flat; no building on the start or a mission's zones.
- `pieces.test.js`: a tower cut at its base falls toward the cut, lands,
  breaks, and crushes a mech under it; the piece cap.
- `buildings` tests: `left` and down; objectives on a building.
- `nav` tests: a route down a street round a block.
- Smoke: `city`: walk a street, shoot a corner, see concrete debris; cut a
  tower and see it fall.
- Perf: `city` and `city-collapse` scenes with memory, GPU, mesh time and
  frame budgets.

## Performance

The unknown is memory, and it's measured first (part 1).

- Concrete chunks aren't all air or all rock, so they can't be shared (spec
  35). Hollow buildings help (walls and floors only), and only chunks a
  building touches pay. Part 1 builds a test city of about 200 buildings
  and measures memory, mesh time and draw cost on the phone; if it doesn't
  fit, the fallback is fewer, smaller towers, or the 2 m fine patches
  (spec 27) only near you.
- A material channel per corner doubles the bytes of a concrete chunk if
  it's a second byte; the top bit of the density byte costs nothing if the
  mesher allows it. Part 1 decides.
- Rigid pieces: at most 4 at once, each one mesh; their cells are lifted
  out (a mesh rebuild of the chunks they leave) and put back on landing.

## Build order

1. **Measure:** a test city of hollow concrete boxes in the voxel grid;
   memory, mesh time, draws and frame on the phone and in `npm run perf`.
   Decides the material channel and the nav squares. The outposts' blocks
   go in as concrete as part of it, which fixes the walk-through bug.
2. **Building records and concrete:** identity, `left`, down, the look
   (colours, storey bands, windows, lit at night), concrete's debris and
   sound, harder to dig, no ore.
3. **Rigid falls:** concrete's support rule (floors pancake), rigid pieces
   (tip, fall, land, break, crush), the thunk. Single player.
4. **The city:** the generator, the `city` biome in Free Play, outposts as
   small towns, boulders into the voxels.
5. **Streets for the AI and props that break.**
6. **The arena in cities** (rigid falls on the wire, `PROTOCOL`), and the
   editor's building brush.

One PR each (part 1 may be two: the measurement, then the outposts fix).

## Open questions

1. **Sprawl or downtown?** Towers cost the most memory and are the most
   fun to bring down. *Default: sprawl with some towers (1 in 10).*
2. **Going inside?** At 4 m cells a room is the size of a mech's leg.
   *Default: no; hollow buildings, mech-sized gaps only where destruction
   opens one.*
3. **The arena in cities?** Rigid falls need a new message. *Default:
   campaign and Free Play first; the arena in part 6.*
4. **Is the 4 m grid fine enough to read as buildings?** *Default: 4 m with
   storey bands and window rows; the 2 m fine patches (spec 27) near you if
   it looks too coarse.*
5. **Should concrete be harder to dig than rock?** It makes tunnelling
   under a city a choice. *Default: twice as hard.*
