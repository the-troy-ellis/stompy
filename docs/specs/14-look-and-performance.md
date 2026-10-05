# The look, and keeping it fast

| | |
|---|---|
| Status | in progress (P0 #131 perf harness shipped; the owner's decisions are recorded below) |
| Milestone | between M3's #106 and Acts II–III (#110, #111); the rest of M4 builds on it |
| Size | L (split: perf harness; instanced effects + particle pool; allocation diet; one-draw mechs; render scale; culling) |
| Depends on | [07-atmosphere.md](07-atmosphere.md) (weather and explosions are the big new loads); [13-thunk.md](13-thunk.md) (effects are feedback) |
| Touch parity | everything here is aimed at the phone first; a PIXELS setting on both |

## Summary

Stompy's look is flat-shaded polygons drawn in big, visible pixels: no
textures, no sprites, no blending. The pixels are what ground it in the 90s
cockpit-sim look, so they are an art decision. The same choices also make it
cheap: no texture memory, no overdraw, a tiny shader, and about a ninth of the
pixels to fill. That saving is headroom to spend on more mechs, effects and
weather, not a setting to fall back on. This spec writes the look down as
rules, then lays out the performance work that lets weather, bigger fights
and more effects fit on a mid-range phone. The headline: **the cost is draw
calls, not polygons**, and most of the draw calls are effects.

## The look (rules)

1. **Polygons only.** Every visible thing is flat-shaded triangles with a
   colour per vertex. No textures, no sprites, no billboards, no
   post-processing, no alpha blending. (Already true; this makes it a rule.)
2. **Effects are solids.** Smoke, fire, sparks, debris, muzzle flashes,
   shockwaves, rain and snow are small low-poly shapes. Each effect kind has a
   shape that reads at a glance:

   | Kind | Shape | How it lives and dies |
   |---|---|---|
   | smoke | cube (12 tris), tumbling | grows, rises, drifts with wind, colour fades into the fog/horizon colour, then shrinks away |
   | fire / flame | tetrahedron (4 tris), emissive | flickers between orange and red, shrinks fast |
   | spark | thin box stretched along its velocity | bright, emissive, gone in a few frames |
   | chunk | tapered cube in the mech's colour | tumbles, bounces once, lies there (today's debris) |
   | muzzle flash | flat star (6–8 tris), emissive | two frames, faces the camera's plane, not the camera |
   | shockwave | flat ring on the ground (16 segments) | expands, thins, gone in 0.4 s |
   | rain | thin vertical sliver | falls, leans with wind |
   | snow | octahedron (8 tris) | drifts, spins slowly |
   | dust | flattened cube | streams sideways with the wind |
3. **Fade by shape, colour and dither, never by blending.** Things disappear
   by shrinking, by blending toward the sky or fog colour, or by being replaced
   with a smaller shape. The one see-through effect allowed is a **dither**: an
   ordered 4×4 pattern of drawn and skipped pixels (the 1996 trick), which with
   chunky pixels reads as a coarse checkerboard. Dither is for soft things on
   their way out (thinning smoke, dust, a shockwave's tail) and for ghostly
   states (an arena pilot respawning); never for solid objects or the HUD.
4. **Chunky, readable silhouettes.** Mechs ≤ 700 triangles, props ≤ 120,
   effect shapes ≤ 16. A thing that does not read at 400 m on a phone gets
   fewer, bigger parts, not more detail.
5. **One light and a sky.** One directional light plus the palette's sky and
   fog. Hot things are emissive (they ignore the light). Night headlights
   ([07](07-atmosphere.md)) are the one exception: a single spotlight term.
6. **The pixels are part of the art.** The 3D view renders at about **240
   lines** (the 320×240 era; the width follows the screen's shape) and is
   scaled up with hard edges: no smoothing, no antialiasing. Every device
   gets the same picture: a 720p laptop and a phone held sideways both show
   240 lines, so a mech 400 m away has the same number of pixels on each.
   The HUD and menus stay crisp at full resolution on top, so text and
   markers always read. PIXELS in Settings offers CHUNKIER (default, ~240
   lines), CHUNKY (~360 lines) and CRISP (full resolution), as a preference,
   not a performance setting. The game never changes the pixel size on its
   own.

## Where the time goes today (baseline)

Measured on `main` in headless Chromium (software GL, so the draw *counts* and
triangle counts are exact and the times are only relative), at 1280×720:

| Scene | Draw calls (peak) | Triangles | Particles | Of the draws: mechs / effects |
|---|---|---|---|---|
| Menu | 13 | 22k | 0 | 12 / 0 |
| Free Play start, 3 foes | 49 | 22k | 0 | 48 / 0 |
| 6-mech fight | 166 (332) | 24k | 82 | 76 / 88 |
| 6-mech fight, 3 deaths | 379 (506) | 27k | 286 | 87 / 291 |
| After the deaths (burning wrecks) | 421 (495) | 27k | 321 | 87 / 333 |

`npm run perf` (P0) now measures these scenes on every CI run, deterministic
to the draw, and adds what this table lacked: **about 1.3 MB of garbage per
frame** in the fight-with-deaths scene (680 KB in a plain fight, 160 KB with
nobody shooting), which is roughly 80 MB a second for the phone's garbage
collector at 60 fps. P2 and P3 aim straight at that number.

The simulation itself is cheap: `update()` takes 0.3 ms per frame with 6
enemies, 0.5 ms with 12 and 0.8 ms with 20, on a desktop CPU in Node. A 2021
phone is roughly 4–6× slower, which is still inside the 4 ms budget.

What it shows:

- **Triangles are a non-issue**: ~27k against a 300k budget.
- **Draw calls already hit the 500 budget** in an ordinary 6-mech fight with
  three deaths, before any weather. Particles are one draw each, and are most
  of them; each mech is 12–15 draws.
- **Effects make garbage.** Every particle is a new object, the particle and
  shot lists are filtered into new arrays every frame, the oldest particle is
  removed with `shift()`, and every draw builds new matrices (`chain`, 32 call
  sites in `scene.js`). On phones that churn turns into garbage-collection
  hitches: frames that are suddenly long.
- The particle cap (420) is low because each one costs a draw; weather alone
  is planned at 800–2,500.

## The plan, in order

| # | Work | What it buys | Size |
|---|---|---|---|
| P0 | **Perf harness.** `npm run perf`: scripted scenes (the table above, plus weather once it exists) that print draw calls, triangles, particles and per-frame allocations, and fail if a count passes its budget. The `?debug=1` overlay already shows FRAME and DRAWS on a real phone. | Every later step is measured, and a regression fails CI. | S |
| P1 | **Instanced effects** (one shape per effect kind, as in the table above). Effects are drawn with instancing (`ANGLE_instanced_arrays`, available on effectively every WebGL1 device): one draw per effect shape, each instance carrying position, size, spin, colour, glow and heat. | Effects go from one draw each to about one draw per shape: ~330 draws → ~6. The cap can rise from 420 to the 4,000 that weather needs. | M |
| P2 | **Particle pool.** Particles live in preallocated typed arrays (a ring buffer), not objects, so spawning and expiring allocate nothing, and the renderer uploads the live slice straight into P1's instance buffer. Shots and debris get the same treatment. | No garbage from effects; faster updates. | M |
| P3 | **Allocation diet.** Scratch matrices reused in `scene.js` and `hud.js` instead of new ones per draw; lists compacted in place instead of filtered; no `shift()`. | Steady-state frames make no garbage (the heap budget's "no growth"). | S |
| P4 | **One draw per mech.** Each chassis's parts go into one buffer with a part index per vertex; the shader picks that part's matrix from a small uniform array (rigid skinning, ≤ 16 parts, within WebGL1's guaranteed uniform space). The IK and gait code are unchanged; they fill the matrix array instead of issuing draws. | 12–15 draws per mech → 1. A 12-mech co-op fight: ~170 → 12. | M |
| P5 | **240-line pixels.** Render the 3D view to a low-resolution framebuffer (no antialiasing) about 240 lines tall, width by aspect, and scale it up with hard edges. PIXELS: CHUNKIER (default, ~240), CHUNKY (~360), CRISP (full). The HUD canvas is untouched. When a phone cannot hold the frame budget, the PARTICLES level from [07](07-atmosphere.md) steps down one notch and the status line says so once (`PARTICLES: LOW.`); the pixel size is never touched. | The look. And about 9× less GPU pixel work than today at 720p (more on high-resolution phones): headroom spent on more on screen. | S |
| P5b | **Dither.** A `uDither` value per draw: the fragment shader skips pixels by an ordered 4×4 threshold (`discard`, no blending). Smoke, dust and the shockwave dither out over their last third; the instanced path carries it per instance. Dithered draws go after the solid ones, because skipping pixels can switch off a phone GPU's early depth rejection. | Soft fades in the period style, at almost no cost. | S |
| P6 | **Culling.** Skip mechs, props and effects outside the view (a sphere against the view frustum), on top of today's fog distance. | Fewer draws when looking away from a fight; matters with M4's props. | S |
| P7 | **HUD caching.** Draw the static cockpit frame and dashboard once to an offscreen canvas and copy it each frame; redraw only what changes. Only if P0 shows the HUD matters on a phone. | Less 2D canvas work per frame. | S |

Order: P0, P1, P2, P3 and P5 (with P5b) come right after #106 and before Acts
II–III, because weather (M4) and bigger missions need the headroom and the
look should be settled before more content is screenshotted. P4, P6 and P7
follow, P4 before co-op (M5b) puts more mechs on screen.

After P1–P4 the measured worst case above would be roughly **1 terrain + 6
effect shapes + ~10 mechs + a few beams ≈ 25–30 draws**, against 500. That
headroom is what weather, night, bigger fights and co-op spend.

Not planned: bigger maps or terrain detail levels (one 18k-triangle draw is
fine at today's map size; revisit if maps grow), WebGL2 (nothing here needs
it), Web Workers for the sim (it is not the bottleneck).

## Code touchpoints

- `src/render/gl.js`: the instancing extension, an instanced shader variant
  (per-instance attributes), effect-shape meshes, the PIXELS framebuffer,
  and (P4) the skinned mech shader and per-chassis merged buffers.
- `src/render/scene.js`: effects drawn by shape from the pool; reused
  matrices; frustum culling; mechs fill a matrix array per draw.
- `src/sim/effects.js`, `src/sim/update.js`: the particle pool (typed arrays,
  ring buffer) replacing `G.parts` objects; in-place compaction for shots and
  debris. Particle *behaviour* (how each kind moves and fades) stays in the
  sim and stays tested headlessly.
- `src/mesh/effects.js` (new): the effect shapes in the table above.
- `src/data/settings.js`: PIXELS (CHUNKIER default / CHUNKY / CRISP), and the
  PARTICLES level from [07](07-atmosphere.md), which is what steps down on a
  slow phone.
- The main fragment shader: `uDither` and the 4×4 threshold (also a
  per-instance value on the instanced path).
- `scripts/perf.mjs` (new) and `package.json`: `npm run perf`.

## Acceptance criteria

1. `npm run perf` runs the scenes and prints draws, triangles, particles and
   allocations; it fails when a scene passes its budget.
2. The 6-mech-fight-with-deaths scene stays under 60 draw calls at its peak
   after P1–P4.
3. A steady 6-mech fight allocates no new objects per frame once warmed up
   (heap snapshot or allocation counter in the harness).
4. 4,000 particles render in one draw per shape, and the frame budget holds on
   the 2021 phone (manual check with the `?debug=1` overlay).
5. CHUNKIER (the default) renders the 3D view about 240 lines tall with hard
   pixel edges and no antialiasing, on desktop and on a phone alike; CHUNKY
   and CRISP work from Settings; the HUD stays sharp in all three;
   screenshots of each on both.
6. Nothing on screen uses a texture or alpha blending (a test greps the
   renderer for `texImage2D` and `BLEND`); see-through effects use the dither
   only.
7. No visible change to how effects behave, apart from the new shapes:
   screenshots before and after for smoke, fire, sparks and explosions.
8. Smoke dithers out over its last third instead of popping; screenshot
   sequence.
9. On a phone that cannot hold the budget, PARTICLES steps down once, says
   so, and stays there; PIXELS never changes on its own.
10. At the default, a WARDEN 400 m away still reads as a mech on a phone held
    sideways (screenshot), with its HUD marker crisp on top.

## Tests

- Unit: the particle pool spawns, ages, expires and wraps around without
  allocating; kinds keep today's motion (rise, wind, gravity, fade colour).
- Unit: the skinned-mech matrix array matches the per-part matrices today's
  renderer builds (same transforms, one buffer).
- Harness: draw-call and allocation budgets per scene, run in CI.
- Playtest: a 6-mech fight and a dust storm on a mid-range phone, overlay on.

## Performance

This spec *is* the performance plan. Budgets stay as in
[architecture.md](../architecture.md) § Performance envelope; the harness
enforces the countable ones (draws, triangles, allocations) in CI.

## Decisions (the owner's, 2026-10-05)

1. **CHUNKIER is the look**, by default on every device (its exact
   resolution is tuned by hand, see Open questions 0): the pixelated 3D
   view is what grounds Stompy in the 90s cockpit-sim vibe. It is an
   aesthetic choice; the performance gain is a bonus that buys more on
   screen. CHUNKY and CRISP stay in Settings as preferences. (The owner saw
   CRISP, CHUNKY and CHUNKIER renders of the same frame before choosing.)
2. **See-through only by dither.** No alpha blending anywhere.
3. **One shape per effect kind**, as in the table.
4. **Order:** after #106, before Acts II–III.

## Open questions

0. **The exact resolution.** The owner settles it by eye: `?debug=1` has a
   LOOK row in the FEEL panel (lines tall, presets from 480 down to 120, a
   live readout, an antialias toggle; saved, and shareable as
   `?lines=240&aa=0`). The ~240 lines above is the starting point, not the
   answer. Whether the final number is fixed per device by line count or by
   pixel size is part of that tuning; line count keeps distant mechs readable
   on phones.
1. **Menu and briefing scenes.** The live mech on the main menu: chunky like
   the game, or crisp as a showcase? *Recommended:* chunky, so the first
   thing a player sees is the real look.
2. **Dither scale.** Dither in chunky pixels (coarse, very 1996) or in screen
   pixels (fine)? *Recommended:* chunky; it falls out of rendering at low
   resolution anyway.
