# Fine digging that settles

| | |
|---|---|
| Status | draft (the owner, 2026-10-29: "The digging still isn't satisfying enough. The low poly is too chunky. I still want to try the dig and then settle into low poly approach") |
| Milestone | M12 (hold to dig), a follow-on |
| Size | L, split in three: fine patches in the sim; drawing them and the settle; online |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md) (the ground); [25-hold-to-dig.md](25-hold-to-dig.md) (DIG, the scoop, clods) |
| Touch parity | Nothing new to press: it's how the ground looks and behaves where you dig |

## Summary

Where you dig, the ground goes fine: a patch of 2 m cells, four times finer
than the map's 8 m, so every scoop leaves a round, crisp bite you can see.
The hole looks like the buckets made it. Leave it alone for a while and the
patch **settles**: with a rumble and a puff of dust, the fine surface slumps
over a second and a half into the map's usual low-poly ground and the patch
goes away. So digging is detailed while it matters, and the world stays
cheap. This is the open question spec 25 left ("A finer ground near the
dig"), now picked by the owner.

## Player experience

### Digging

- Each scoop takes a round bite out of the face, about the bucket's size,
  where the bucket went. A run of scoops carves a smooth, scalloped hollow,
  not 8 m facets.
- Blasts (missiles, shells, the fusion) dig fine craters the same way: round
  bowls with a lip.
- Walking into or over the dug ground, your feet land on the fine surface:
  what you see is what you stand on.
- Nothing else changes. DIG's pace, the ore and the dirt are exactly as now
  (they're counted on the 8 m ground underneath, § Design). The clods still
  fly.

### Settling

- About 15 s after the last dig in a patch, when nobody is standing on it,
  it settles:
  - a low rumble and a sub-bass thump (a `settle` feel row, small);
  - dust puffs along the patch's dug surface;
  - the fine surface slumps smoothly, over 1.5 s, into the 8 m ground's
    shape. Sharp edges round off and the hole relaxes into its chunky,
    low-poly self.
- Then it's plain ground again, the same as anywhere else on the map.
- A patch someone is standing on waits until they step off, so the ground
  never moves under a mech's feet (see Edge cases).

### Text

None. The settle is a sound and dust, not a message.

## Design

### Numbers

| | | what |
|---|---|---|
| `FS` | 2 m | a fine cell: the map's 8 m over 4 |
| `margin` | 1 cell (8 m) | the coarse cells a patch keeps round its edits, untouched |
| `maxSide` | 64 m | the most a patch spans in x or z (8 coarse cells); a dig past it starts a new patch |
| `maxPatches` | 6 | the most at once; one more settles the oldest first |
| `settleAfter` | 15 s | since the last edit in a patch |
| `settleTime` | 1.5 s | the slump |
| `settleWait` | 45 s | if it's still stood on by then, it settles round the feet (Edge cases) |

These are presentation numbers, not balance: the ore, dirt and dig pace
never read the fine ground.

### The patch

`world/finePatch.js` (new):
- A box of whole 8 m cells, `[i0..i1] × [j0..j1] × [k0..k1]` on the coarse
  grid. Inside it, corners every 2 m hold a density byte, as the coarse grid
  does (the same `Q` coding).
- **Born** when an edit lands somewhere no patch covers: the box is the
  edit's coarse box plus `margin`, and its densities are sampled from the
  coarse ground (trilinear, as `sample` reads it), so at birth it's the same
  surface, only finer.
- **Grows** when an edit lands partly outside it: the box widens to cover it
  (up to `maxSide`), and the new part is sampled from the coarse ground.
- **Edits:** every carve and build (`shape` in `voxels.js`) goes into both
  grids. The coarse grid as now; the fine grid with the same sphere and the
  same rule (a carve takes the smaller, a build the larger), at 2 m. Carves
  give the same bytes in any order, so two clients that apply the same digs
  agree, as they do on the coarse grid.
- The outer `margin` ring is never edited (edits that would reach it grow the
  patch first), so its edge is always the coarse ground's surface.

### Reading the ground

`sample(x, y, z)`, the one function every ground query is built on (feet,
`groundBelow`, `ray`, shots, sight, falls), reads the fine patch when the
point is inside one (a box test per patch, at most six) and the coarse grid
otherwise. `height(x, z)` reads a fine `top` kept per patch the same way.
So **the ground queries match what's drawn** (architecture's invariant),
fine or coarse.

### What still reads the coarse grid

- **The economy:** `bite`'s tally (ore for rock corners, dirt) counts coarse
  corners turned to air, exactly as now. DIG's pace and the 80-seed ore test
  are untouched.
- **Falls and islands** (spec 18): the support check runs on the coarse
  grid. A coarse fall in a patch's box settles that patch at once, first, so
  the two never disagree about a falling lump.
- **The network:** digs go on the wire as now; nothing about patches does.

### The settle

`stepFinePatches(G, dt)` (in `sim/dig.js`'s step):
1. A patch whose last edit is `settleAfter` old, with no live mech's feet,
   wreck or building in its box, starts settling.
2. For `settleTime` the fine densities blend toward the coarse field
   (trilinear) at each fine corner; `sample` reads the blend, and its chunks
   re-mesh about 10 times a second. The surface slumps smoothly into the
   coarse shape.
3. Then the patch is dropped. `settle()` (dig.js's existing pass) runs over
   its box, so scorches, wrecks, props and structures follow the ground.
4. The `settle` feel row and sound at its start, and dust along the dug
   surface.

### Drawing

`render/ground.js`:
- A patch is meshed by `meshChunk` with corner spacing `FS` (the mesher
  already takes a spacing), in the worker like a chunk, in pieces of 16³
  fine cells. Flat-shaded and in the palette, like all ground.
- The coarse chunks skip the cells a patch covers, except its outer ring.
  The ring is drawn by both, the fine mesh just under the coarse one, so the
  seam never shows a gap.
- Re-mesh at most 10 times a second per patch, while it's being dug or
  settling.

### Online

- Every client builds its own patches from the digs it applies (its own at
  once, others' as they arrive), so the same holes look the same.
- The settle is each client's own, on its clock. A client only collides its
  own mech with its own ground, so a patch settling a moment apart on two
  phones moves nothing anyone stands on.
- No `PROTOCOL` change.

### Edge cases

- **Stood on past `settleWait`** (a digger parked at its face; a mech asleep
  in a crater): the patch settles everywhere except a column round each foot
  (2 cells), which settles when the foot lifts. The ground never moves under
  a planted foot.
- **A seventh patch:** the oldest settles at once, waiting or not, with the
  same column rule.
- **Digging during a settle:** the settle stops where it is. The blend's
  densities become the patch's, and the new edit goes on top.
- **A patch at its `maxSide`:** a dig past it starts a neighbouring patch;
  the two share an edge ring, each drawn over the other.
- **The editor and missions:** edits from a mission's own strokes at load
  never make patches. Only edits during play do.
- **Clods** still sink into whichever surface is there.

## Code touchpoints

- `src/world/finePatch.js` (new): the patch grid, birth, growth, edits,
  sampling, the blend.
- `src/world/voxels.js`: `shape` edits patches too; `sample` and `height`
  read them; patch bookkeeping on the ground object.
- `src/world/mesher.js`: unchanged (it already meshes at any spacing); maybe a
  mask so coarse chunks skip patch cells.
- `src/sim/dig.js`: `stepFinePatches`, the settle, and a coarse fall settling
  its patch first.
- `src/data/feel.js`: a small `settle` row.
- `src/audio/sound.js`: `sfx.settle` (a low rumble, a sub thump).
- `src/render/ground.js`: patch meshes, skipping patch cells, the seam ring.
- `scripts/perf.mjs`: `bench-scoop` digs into a patch; a settle in the run.

## Acceptance criteria

1. A held DIG at a face leaves round, scalloped bites at 2 m, not 8 m
   facets. A missile leaves a round crater.
2. Feet, shots and the landing ring meet the fine surface where it's drawn
   (queries match the mesh, within 0.3 m).
3. DIG's ore and dirt are exactly as before (the 80-seed test unchanged).
4. 15 s after the last dig, with nobody on it, the patch slumps over 1.5 s
   into the 8 m ground, with a rumble and dust, and is gone.
5. Standing in the hole delays the settle, and the ground never moves under
   a planted foot.
6. No seam shows between a patch and the ground round it.
7. `npm run perf` holds its budgets with a patch being dug and one settling.
8. Online, both clients see the same fine hole. No protocol change.
9. On a phone, digging stays smooth (no frame-time spike when a patch
   re-meshes).

## Tests

- `test/finePatch.test.js` (headless):
  - birth: a patch's surface matches the coarse ground at birth (within
    0.3 m);
  - a carve: the fine hole is round (its radius within 0.5 m all round),
    the coarse one is the old one;
  - carves in any order give the same bytes;
  - `sample`, `groundBelow` and `ray` read the patch inside it and the coarse
    grid outside;
  - growth, `maxSide` and `maxPatches`;
  - the settle: after `settleAfter`, `settleTime` later the patch is gone and
    the ground is the coarse ground;
  - stood on: it waits; past `settleWait`, the foot's column doesn't move;
  - a coarse fall in a patch settles it first.
- `test/tools.test.js`: the 80-seed ore test unchanged.
- `test/mesher.test.js`: a patch's mesh agrees with its `height` within
  0.6 m, as the coarse one does.
- Smoke: hold DIG at the range's mesa 3 s; a patch exists and the screenshot
  shows round bites; wait 17 s; it's gone.

## Performance

- A patch is at most 64 × 64 m across, and as deep as the edits need; its
  fine corners are tens of thousands of bytes. At most six: well under a
  megabyte.
- `sample` adds a box test per patch, at most six, on the hot path. That's
  measured in `npm run perf`'s ground-query numbers.
- Meshing a patch is a few thousand triangles, in the worker, at most 10 a
  second while dug or settling. The skipped coarse cells give some of that
  back.
- If a phone can't hold it, `FS` goes to 4 m (twice as fine, not four times)
  by the same code.

## Build order

1. **Fine patches in the sim:** the patch grid, edits, `sample` and `height`
   reading them, the settle with its blend and the stood-on rule, the feel
   row and the sound. Tests. It's drawn crudely at first: the patch meshed
   whole on the main thread.
2. **Drawing them properly:** in the worker, in pieces; coarse chunks
   skipping patch cells, the seam ring, re-mesh pacing, dust on the settle,
   and the perf bench.
3. **Online:** patches from others' digs, local settles, and a smoke run with
   two clients.

## Open questions

- **How fine.** Default 2 m. 1 m would look rounder still, at about eight
  times the corners and four times the triangles. Try 2 m on a phone first.
- **How long before it settles.** Default 15 s after the last dig. Longer
  keeps your work crisp while you look at it; shorter keeps the world cheap.
- **Blasts too.** Default yes: craters get fine patches like scoops do.
  Alternatively only the digger's scoops, so fights stay as they are.
- **The settle's look.** Default a slump with dust and a rumble. It could be
  a quicker drop with a bigger thunk, more in the thunk pillar.
