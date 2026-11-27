# The look: dither, ramps, more faces

| | |
|---|---|
| Status | part 1 built (2026-11-27): the dither and the ramps. Part 2 (more faces) next. **Deck check: open.** |
| Milestone | P2, the engine (`../parity.md`) |
| Depends on | the browser version's `specs/14-look-and-performance.md` for what it kept and dropped |

## Summary

The owner, after mockups (2026-11-27): dithering is the style, more faces on
the assets but still flat-shaded, and palettes that look unlike each other.

## Design

### Part 1: the dither and the ramps (built)

- Every place has a **ramp** of nine colours for each time of day (native,
  night, dawn), dark to light, in `crates/game/src/look.rs`. The desert runs
  indigo to peach through magenta and orange; the glacier navy, teal and
  white; the volcanic plain black, blood and lava; the forest deep green up
  into grey mist.
- **The ground, the sky and the fog** are shaded as before (one light, the
  sky's gradient, the fog's curve) and their brightness then lands on the
  ramp between two neighbouring colours, picked by the 4x4 ordered dither.
  So a shadow or the distance walks the ramp's hues, not just darker or
  greyer.
- The **tone range** that spreads a place over its ramp comes from its own
  light: from the shadow on the darkest rock (or the zenith) to the lit top
  of the highest ground (or the horizon). A gamma per ramp lifts dark places.
- **Mechs and effects** keep their own colours: a chassis is still told by its
  paint. Their light comes in fifths, dithered between steps. The fog creeps
  over them pixel by pixel as the fog's own ramp colour.
- **A dusk-to-night mission** blends its two ramps along the same clock as
  its light.
- **The dither's cell** is DITHER in SETTINGS: OFF (smooth, the old look, for
  comparing), FINE (1 px), CHUNKY (2 px, the default), CHUNKIER (3 px).
  Polygon edges stay at the screen's full resolution. `--dither N` sets it
  for a tools run.
- **HUD text** has a dark drop shadow, so the green reads on any ramp.

### Effects as lumps (prototype, built)

Smoke, dust, flame and debris were cubes, slabs and tetrahedra. Now they are
lumps (`Builder::lump`): an icosahedron, split, each corner pushed in or out
a little, stretched per kind. Smoke is a round lump that swells as it rises;
dust the same squashed flat; flame a tall jagged tongue; debris a craggy
rock. A smoke or dust puff dissolves pixel by pixel through the dither (an
instance carries how much of it is still drawn), instead of shrinking.
First pass: the smoke still reads a little like boulders.

### Part 2: more faces (next)

Today's mechs are mostly boxes, a few hundred triangles each. The target is
1,500 to 4,000: bevelled plates, 8 to 12 sided cylinders for actuators,
pistons, vents, toes and a canopy, each face still one colour. BARRY first,
at two levels, for the owner to pick from screenshots and on the Deck; then
the other five. The ground's faces are redone by the voxel ground (P2).

## Kept, changed, asked

- **Kept:** one shader, no textures, no blending; the HUD's green; each
  chassis's paint.
- **Changed:** the browser version's PIXELS setting (a 240-line render) is
  not ported; edges stay sharp and the dither carries the retro look.
- **Asked, and answered:** the direction (yes); the dither's size (chunky by
  default, a setting); mechs on the place's ramp or their own paint (their
  own, for now).
- **Open:** the ramps themselves are first drafts. The owner tunes them on
  the Deck; a ramp is nine hex colours in `look.rs`.

## Acceptance criteria

1. Every ramp runs dark to light (test: `look::tests`).
2. Every place at every time of day spreads over a real tone range (test).
3. Screenshots of the four places at dusk, before and after, in the PR.
4. On the Deck: 60 held in Free Play with eight foes, DITHER on CHUNKY.
   **Deck check: open.**
