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

As shipped (#227):
- **The mapping** is in `src/input/gamepad.js`, a pure `readPad` that is
  tested headlessly. `input.js` polls the first standard-mapped pad every
  frame.
  - The sticks have a round deadzone (0.2).
  - The right stick has a curve, for fine aim near the centre. At full tilt
    it turns 1.5× as fast as the arrow keys, times GAMEPAD sensitivity, and
    0.4× that zoomed.
- **The throttle:** the left stick moves it at W/S's rate times the tilt,
  and it stays where it was set. That's a new `thr` in the snapshot (the
  sim's only change).
- **Buttons the spec didn't name:** right stick click punches, D-pad up is
  LIGHTS, D-pad down is STOP.
- **Back** pauses rather than going straight to the menu, since the menu is
  one press away on the pause screen. A stray press shouldn't lose a
  mission.
- **Screens** (menu, pause, lobby, debrief): the D-pad, or the left stick
  held, moves a highlight through the buttons. A presses the highlighted
  one, Start launches or resumes, and B resumes. So a whole mission needs no
  mouse, keyboard or touch.
- **Phones:** the touch controls hide while the pad is in use and come back
  on the first touch.
- **Sound:** browsers may not count a pad press as the gesture that unlocks
  audio. A pad-only first launch may start silent until a key, click or tap.
  The owner's real-pad check will say.

### Silent tutorial

Mission 1 only, first time only (`store` key `tut.done`), each prompt shown
once in the HUD font near the relevant instrument, fading when the player
does the thing. In the house voice, at most three words plus the key or
gesture: `W: GO. S: LESS GO.` · `A / D: LEGS` · `MOUSE: TORSO` · `HOLD LMB:
MELT IT` · `RMB: THUMP` · `SPACE: MISSILES (HOLD TO FLY)` · `J: UP` · `E:
PUNCH` (when a JACKAL is in reach) · `HEAT: TOO MUCH` (first over 60) · `T:
NEXT ONE` (when a second enemy appears). Touch variants name the gesture. Skippable by pausing (the pause
screen gains `SKIP TUTORIAL`).

As shipped (#228):
- **Where it lives:** `src/data/tutorial.js` holds the words; `src/sim/tutorial.js` decides
  which prompt is up and when it's done, headless and tested. The HUD draws
  it by its instrument (the throttle, the weapon list, the heat bar, the
  target box, under the compass, under the crosshair), in the words for what
  the pilot is holding: keys and mouse, the touch controls, or a gamepad.
- **Order:** steps come one at a time, in the spec's order, a beat apart.
  Each fades when it's done. A step this mech can't do (no missiles, JUMP
  JETS NONE) is skipped. One that's ignored for 25 s gives way to the next.
- **Events:** E: PUNCH (a JACKAL in reach), HEAT: TOO MUCH (heat past 60)
  and T: NEXT ONE (a second hostile within 300 m) break in once each. A step
  they interrupt comes back after. T: NEXT ONE counts only a T press, not a
  target the game picked for you after a hit.
- **Once:** the first mission 1 runs it. Reaching the debrief, or SKIP
  TUTORIAL on the pause screen, sets `tut.done`, and it never shows again.
  Quitting halfway leaves it for next time. Co-op never shows it.

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

As shipped (#229), HUD SCALE and COLOURS (the rest of this section is #230):
- **HUD SCALE** (0.8, 1, 1.25, 1.5) is one canvas scale over the whole HUD,
  laid out in the screen's size over the scale. Every instrument, font and
  gap grows together, and the dashboard still keeps to its share of the
  screen.
  - On a desktop the weapon list now keeps clear of the throttle gauge.
  - The compass narrows on a phone so it never runs into the target box.
- **Phones:** the touch HUD sits around the thumbs' controls, which don't
  grow. So a phone gets as much of the scale as it has room for: its HUD
  stays at least 640 × 360, and never below 1.
  - A 360-tall phone stays at 1, an 896 × 414 phone gets 1.15, and a tablet
    or desktop gets the full 1.5.
  - That is how acceptance 5 is met. A real 1.5 on a small phone would mean
    moving the touch controls: the owner's call, and a follow-up if wanted.
- **COLOURS:** NORMAL, DEUTAN, PROTAN and TRITAN, from `HUD_PALETTES` in
  `src/data/colors.js`. Each mode swaps the HUD's fine, warning and bad
  colours, the dim line work, the armour shades and the melt glow.
  - DEUTAN and PROTAN share the Okabe-Ito sky blue, yellow and vermillion.
    TRITAN uses cyan, pink and red.
  - Radar blips have shapes as well as colours: a hostile is a triangle, the
    target a ringed square, a pilot a dot. Objectives stay hollow diamonds.
- **Acceptance 4:** `test/hudColours.test.js` simulates each colour
  blindness (Machado et al. 2009, full severity). It requires each mode's
  fine, warning, bad and gone colours, and its armour shades, to be at least
  25 apart in CIELAB. The normal set fails that for red-green eyes (about
  10), which is why the modes exist. The smoke test saves a screenshot of
  each mode.

As shipped (#230), the rest of this section:
- **The settings screen** (and the pause screen, which shares it) comes in
  four sections: SOUND, CONTROLS, DISPLAY and GAME. Each has a small heading
  over its toggles, then its dials. A phone scrolls the column.
  - SOUND: sound, voice, VOICE RATE, VOICE VOL.
  - CONTROLS: invert, haptics, and MOUSE, TOUCH and GAMEPAD sensitivity.
  - DISPLAY: reduced motion, frame time, full screen, FOV, PARTICLES, HUD
    SCALE, COLOURS.
  - GAME: difficulty.
  - Each dial's section is in `src/data/settings.js` (`group`,
    `SETTING_GROUPS`), and a test checks that every dial has one.
- **VOICE RATE:** 0.7×–1.5× on top of the voice's own 1.05.
- **FOV** is shown as the horizontal angle on this screen's shape: 94° at
  16:9 and about 100° on a phone. It is still stored and stepped as the
  vertical angle, so nobody's view changes. A dial in fixed horizontal steps
  would have widened the default desktop view.
- **REDUCED MOTION stays as spec 13 has it:** view motion at 30%, flashes
  shorter, a step fewer particles. This section's "no camera shake, no HUD
  kick, weather particles at LOW" goes further than that, and the two specs
  disagree. Which one holds is the owner's call.

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

As shipped (#232):
- **The zip:** `npm run zip` (`scripts/zip.mjs`) writes
  `stompy-<version>.zip` of `dist/` in plain Node, with `index.html` first at
  the root. There's no source map, and the same `dist/` gives the same bytes.
  CI builds it on every push.
- **The Release:** `.github/workflows/release.yml` runs on a `v*` tag. It
  builds (with the hosted relay, if set), zips, and creates the Release with
  the zip attached. The notes are the titles of the PRs merged into main
  since the last tag (`scripts/notes.mjs`, from git's merge commits).
  - It refuses a tag that doesn't match `package.json`. Bump the version, then
    tag `v<version>`.
- **Pages on a tag:** `pages.yml` also runs on `v*` tags. The repository
  variable `STOMPY_DEPLOY_ON` chooses `main` (unset: as now), `tags` or
  `both`. A tag deploy also needs the `github-pages` environment to allow
  tags.
- **Version:** the settings footer shows `v<version>` from `package.json`
  (a build define). The unbuilt page shows `vdev`.
- **The owner's step:** bump `package.json` to 1.0.0, push the tag `v1.0.0`,
  and check the Release and the deploy (acceptance 7).

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
