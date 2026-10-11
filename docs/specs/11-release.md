# Ship: PWA, gamepad, tutorial, accessibility, deploy

| | |
|---|---|
| Status | ready |
| Milestone | M6 |
| Size | M (each heading is an S/M issue) |
| Depends on | everything before it; can begin after M3 |
| Touch parity | gamepad is additive; PWA and settings benefit phones most |

## Summary

The last mile: installable, offline for single player, controller support,
mission 1 teaching the controls without words, an accessibility pass, a
performance pass against the budget table, and a tagged release that deploys
in one command.

## Design

### PWA

- `manifest.webmanifest`: name STOMPY, landscape orientation, standalone
  display, black theme, icons generated from `favicon.svg` at 192 and 512
  (a small `scripts/icons.mjs` using the preinstalled Chromium to rasterise
  the SVG, run at build time).
- `sw.js`: cache-first for the bundle, CSS, sounds and manifest with a
  version key derived from the build hash; network-first for `index.html`;
  never caches the relay. Registration from `main.js` only when served over
  `https` or `localhost`.
- An "update available" moment: the voice says nothing; the menu shows a dim
  `UPDATED · RELOAD` line that reloads on tap.

As shipped (#226):
- **Icons:** `scripts/icons.mjs` draws them in plain Node rather than in
  Chromium. The favicon is a grid of rects, so the drawing is exact, and the
  Pages build needs no browser. Any other shape in the SVG is an error.
  - It makes 192 and 512, plus a 512 for Android's masks, on black with the
    art inside the middle 75%.
  - The built page links the manifest and an `apple-touch-icon`.
- **The worker:** `src/sw.js` is written into `dist/` by the build, with the
  list of files and a version that is a hash of them all.
  - Only the built game registers it (a `__PWA__` define), so `npm run
    serve` never caches anything.
  - It caches `index.html` on install as well. The first visit loaded the
    page before the worker existed, and offline needs it.
  - A WebSocket never reaches a service worker, so the relay can't be cached.
- **The update line:** it sits in the menu's top corner, over the scene, so
  nothing in the column moves. A tap tells the waiting worker to take over,
  and the page reloads.
- **The smoke test:** it serves `dist/` and checks the manifest and icons
  and that 45 files are cached. Then it goes offline, reloads and starts
  mission 1, fetching all 37 sounds through the worker. Then it changes
  `sw.js` and checks that UPDATED · RELOAD appears and a tap swaps the cache.
- **The owner's check:** installing on Android (Chrome) and an iPhone
  (Safari), standalone and sideways.

### Gamepad

Standard mapping, polled each frame in `src/input/gamepad.js` into the input
snapshot: left stick turns legs and sets throttle as A/D and W/S do (with a
deadzone), right stick twists and pitches, RT energy, LT missile (tap/hold as
touch), RB ballistic, LB fusion, A jump, B centre torso, X target, Y zoom,
Start pause, Back menu. A `gamepad` sensitivity setting. Works on phones with
a controller attached (the touch UI hides while a gamepad is active and
returns on the first touch).

### Silent tutorial

Mission 1 only, first time only (`store` key `tut.done`), each prompt shown
once in the HUD font near the relevant instrument, fading when the player
does the thing. In the house voice, at most three words plus the key or
gesture: `W: GO. S: LESS GO.` · `A / D: LEGS` · `MOUSE: TORSO` · `HOLD LMB:
MELT IT` · `RMB: THUMP` · `SPACE: MISSILES (HOLD TO FLY)` · `J: UP` · `E:
PUNCH` (when a JACKAL is in reach) · `HEAT: TOO MUCH` (first over 60) · `T:
NEXT ONE` (when a second enemy appears). Touch variants name the gesture. Skippable by pausing (the pause
screen gains `SKIP TUTORIAL`).

### Accessibility and settings

- HUD SCALE: 0.8 / 1.0 / 1.25 / 1.5 (multiplies `hudLayout` and fonts).
- COLOUR MODE: default / deuteranopia / protanopia / tritanopia, swapping the
  green/amber/red HUD and section colours for a safe set (also the melt
  glow). Radar blips get shapes as well as colours.
- REDUCED MOTION: no camera shake, no HUD kick, shorter flashes, weather
  particles at LOW.
- SENSITIVITY (mouse, touch, gamepad) and INVERT already partly exist;
  gather them in a CONTROLS section.
- FOV: 90 / 100 / 110 (default 100 ≈ today's 1.08 rad is ~62° vertical;
  express it horizontally in the UI).
- VOICE RATE and VOICE VOLUME.
- The settings screen is grouped (SOUND, CONTROLS, DISPLAY, GAME) and
  scrollable on phones.

### Performance pass

Against the budget in [../architecture.md](../architecture.md), on the two
reference phones, in the worst case (night, dust, six mechs, props):
profile, fix the top three costs, re-measure, record in the release notes.
Known candidates: the HUD full redraw (cache the static dashboard to an
offscreen canvas), terrain draw at the far fog (split the terrain mesh into
16 chunks for frustum culling), particle cap on LOW.

Load-time: sounds total ~600 KB and the code ~180 KB unminified; lazy-load the less common clips after the
first frame; the bundle is minified by esbuild already.

### Deploy and release

- `pages.yml` deploys on tag `v*` as well as `main` (owner's choice via the
  repo variable).
- `npm run zip` makes `stompy-<version>.zip` of `dist/` for itch.io, with
  `index.html` at the root as itch requires.
- A GitHub Release per tag with the zip attached and notes generated from PR
  titles since the last tag.
- Version shown in the settings footer, from `package.json` via a build
  define.

### README and credits

README rewritten for players first (what it is, how to play, controls), then
hosts (run the relay), then developers (link to `docs/`). Credits list Kenney
and the fonts in use (system fonts; none shipped).

## Code touchpoints

- `manifest.webmanifest`, `sw.js`, `scripts/icons.mjs`, `scripts/zip.mjs`,
  `src/main.js` (SW registration), `src/input/gamepad.js`, `input.js`,
  `src/ui/menu.js` (settings groups), `src/ui/tutorial.js`,
  `src/render/hud.js` (scale, colour modes, tutorial prompts, offscreen
  dashboard), `src/data/colors.js` (HUD palettes), `.github/workflows/*`.

## Acceptance criteria

1. Installed from Chrome on Android and Safari on iOS; launches standalone in
   landscape; a mission plays in airplane mode after one online visit.
2. A gamepad plays a full mission on desktop and on a phone with no touch
   input; the touch UI hides and returns correctly.
3. First mission 1 shows each prompt once; a second run shows none; SKIP
   works.
4. Each colour mode passes a simulated check (screenshots through a
   deuteranopia filter show heat, armour states and radar still distinct).
5. HUD SCALE 1.5 fits a phone in landscape without overlap (screenshot).
6. Frame budget met on both reference phones in the worst case; numbers in
   the release notes.
7. `v1.0.0` tag produces a Pages deploy, a zip and a Release with notes.

## Open questions

- Music. None exists; a short synthesised menu loop would suit the register
  and cost no assets. Default: not in scope unless the owner asks.
- itch.io page copy and screenshots: owner-provided.
