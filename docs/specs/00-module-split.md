# Module split

| | |
|---|---|
| Status | in progress (stages 1–3 shipped on `m0/foundations`) |
| Milestone | M0 |
| Size | L, split into the five stages below (each its own issue and PR) |
| Depends on | none |
| Touch parity | n/a (no behaviour change) |

## Summary

Break `stompy.js` into ES modules under `src/` so that sim logic can be
tested headlessly and future features land in small files. No behaviour
changes. Each stage leaves the game playable and ships separately. Target
layout and rationale are in [../architecture.md](../architecture.md).

## Ground rules

- `index.html` switches to `<script type="module" src="src/main.js">` in
  stage 1 and stays that way. Development needs only a static server
  (`python3 -m http.server`, or `npm run serve`).
- No bundler at runtime. `npm run build` (esbuild) produces `dist/` for
  releases only.
- Keep names. A function called `beamTick` stays `beamTick`. Comments move
  with their code. The point is to relocate, not to rewrite.
- Each stage's PR diff should be mostly moves. Reviewers diff the moved
  function bodies against the originals.
- After every stage: `npm test`, the playtest checklist on desktop and phone,
  and the arena smoke (two tabs against `server.py`).

## Stage 1 — Tooling and pure leaves (S)

Add `package.json` (`"type": "module"`, scripts `serve`, `test`,
`test:smoke`, `lint`, `build`), ESLint flat config (recommended rules plus
`no-unused-vars` as error), esbuild, Playwright as a dev dependency using the
preinstalled browser, `.gitignore` (`node_modules/`, `dist/`,
`test-results/`).

Move out of `stompy.js`, unchanged:

- `src/util/math.js`: `TAU clampN lerp wrapA rnd add sub mul dot cross len norm mix3 dirOf M chain`.
- `src/util/store.js`: `store`.
- `src/util/dom.js`: `$ esc`.
- `src/mesh/builder.js`: `Builder`.
- `src/data/weapons.js`, `chassis.js`, `geo.js`, `palettes.js`,
  `missions.js`, `colors.js`: the constant tables and `missionDef`. `HPK` and
  `SECT_NAME` go in `chassis.js`.
- `src/world/terrain.js`: `N CELL HALF BOUND makeTerrain`.
- `src/world/terrainMesh.js`: `buildTerrainMesh`.
- `src/mesh/mechParts.js`: `buildMechParts buildReverseParts buildQuadParts`.

`stompy.js` becomes `src/main.js` and imports them. First tests land:
`terrain.test.js` (height matches mesh triangles at 1000 random points; flat
zone is flat; deterministic for a seed), `math.test.js` (`wrapA`, `M.mul`
against a known product, `lookAt` orthonormality), `data.test.js` (every
chassis weapon exists in `WEAPONS`, every `CAT_OF` key exists, every mission
palette and foe exists).

## Stage 2 — Game state and the effects sink (M)

Introduce `src/sim/state.js` exporting `createGame(opts)` that returns the
object that today is `G` plus `ter`, `pal`, `rng`, and `newMech(game, ...)`.
Introduce `src/sim/rng.js` (mulberry32; `game.rng.next()`, `game.rng.range(a,b)`,
`game.rng.pick(list)`). Introduce the `fx` sink interface documented in
`src/sim/fx.js` as a JSDoc typedef with a `nullFx` export (all no-ops) and a
`recordFx()` export (pushes calls to an array) for tests.

Inside `main.js`, replace the closure variables `G`, `ter`, `pal` with a
single `game` created once and reassigned fields on match start; thread
`game` and `fx` as the first arguments into the sim functions still in
`main.js`. This stage is mechanical and large; do it with search-and-replace
in one sitting and do not merge anything else meanwhile.

Replace `random()`/`rnd()` in sim code paths with `game.rng` equivalents:
`newMech` (cooldown stagger, strafe direction), `startMatch` (foe placement,
awareness), `think` (all), `fire` (spread), `spawnPoint`, `startSkirmish`
(map and foe mix), `missionDef`'s callers. Leave `Math.random` in particles,
sound variation, the menu and the fusion HUD readout jitter.

Tests: `rng.test.js` (same seed, same sequence; range bounds), `state.test.js`
(`createGame({seed, mission: 0})` builds two JACKALs at the documented ring
distance; same seed twice gives identical positions).

## Stage 3 — The sim (M)

Move into `src/sim/`:

- `mech.js`: `stepMech`.
- `gait.js`: `restFoot initFeet swingTarget gait footDown solveKnee limb`.
- `combat.js`: `sectionHit damage destroy fire blast` and the geometry
  helpers they need (`frame torsoFrame center muzzle eyeOf viewYaw rayCyl
  rayTerrain rayHit` go to `sim/geom.js`).
- `beams.js`: the MELT constants, `meltMult meltFrac beamTick coolArmour beamMult`.
- `fusion.js`: `fusionTick nearMiss fusionFire launchPulse updatePulses`
  (not `fusionSound`, which is audio).
- `missiles.js`: `missileTrigger startGuide steerVolley steerBy endGuide
  fireCat alpha cycleTarget` with the guide's *state* only; the camera reads
  `game.guide` in render.
- `ai.js`: `think`.
- `update.js`: `update(game, input, dt)`. (Built this way: the sink lives at
  `game.fx`, set by `createGame({ fx })`, rather than being threaded as a
  fourth argument through every sim function. Same testability, half the
  parameters.) `input` is a snapshot object
  (`{ throttleUp, throttleDown, stop, turn, twistKeys, pitchKeys, jets,
  centre, held: {energy, ballistic, missile, fusion}, missileTap, aimDelta }`)
  built by `src/input/input.js` from keyboard, mouse and touch each frame.
  The audio-loop updates at the end of today's `update` (hum, jet, servo)
  move to `main.js` after the sim step, reading `game`.

What `update` may call on `fx`: `msg(text, col)`, `say(text, force)`,
`sfx(name, args)`, `particle(...)`, `explode(p, big)`, `beamFlash(a, b, def)`,
`netSend(obj)`, `onPlayerDeath()`, `onMatchOver(won)`. Everything else is
state.

Tests: `combat.test.js` (section routing by height and lateral offset;
overflow damage from a destroyed arm reaches the torso; weapons on a
destroyed section die; torso 0 destroys), `mech.test.js` (heat 100 shuts
down, 45 restarts; leg loss halves top speed; sink rate), `beams.test.js`
(`meltMult(0)=1`, `meltMult(MELT_T)=MELT_MAX`, cools to 0 in 2 s), `gait.test.js`
(walk 20 s straight at full throttle on flat terrain: no planted foot moves
more than 1 mm while planted), `missiles.test.js` (blast falloff at 0, 5, 10,
11 m; firer never hurt), `fusion.test.js` (3 s continuous scan fires; a 0.4 s
slip pauses; a 0.6 s slip resets; overload sets heat 140), `ai.test.js` (never
fires while shutdown; never exceeds 72 heat by its own fire; unaware mech
wanders inside BOUND), `update.test.js` (300 steps of a mission with
`recordFx` produce no NaN in any mech field; player under full throttle moves
forward).

## Stage 4 — Render, HUD, audio, UI, input (M)

Move, without changing output:

- `src/render/gl.js`: context, both shaders, `upload`, `draw`, `meshes`,
  `mechParts`, `partsKeyFor`.
- `src/render/scene.js`: `resize drawMech render(game, view)`; `view` is
  `{ W, H, dpr, ir, menu }`.
- `src/render/hud.js`: everything in the HUD section, taking `(game, ctx, layout)`.
- `src/audio/sound.js`, `sfx.js`, `voice.js`.
- `src/ui/overlay.js`, `menu.js`, `screens.js`: the screens section and the
  overlay click handler, split by screen.
- `src/input/keyboard.js`, `mouse.js`, `touch.js`, `input.js`.

`main.js` is left with: create game, create renderer, create audio, build the
`fx` object from them, wire input, run the loop. Target under 300 lines.

Playwright smoke test lands here (`test/smoke.spec.js`) since the page is now
loadable in CI.

## Stage 5 — Net and server (S)

- `src/net/protocol.js`: builders and parsers for every message, plus
  `PROTOCOL = 1`. The client sends `v: PROTOCOL` in `hello`; the server
  ignores it for now (M5a enforces).
- `src/net/client.js`: `Net join netSend onNet startArena spawnPoint respawn
  sendState netState netFx`.
- `src/net/interp.js`: `netInterp`.
- `server/server.py` (moved), `server/test_server.py` with tests for
  `origin_ok`, `clean_name`, `num`, `handle_message` for `hit` clamping and
  `died` scoring and round end, and a handshake test over a real socket.
- `test/protocol.test.js`: every builder's output parses back to equal input;
  `sendState`'s shape has no duplicate keys (this catches the `sp` bug; fixing
  it is M5a's job because it changes the wire format).

Also in this stage: GitHub Actions workflow `ci.yml` (lint, test, build,
smoke, python unittest) and `pages.yml` (build and deploy `dist/` plus
`sounds/` to Pages on `main`, enabled by a repository variable so it is inert
until hosting is chosen). README refreshed; `CLAUDE.md` added at the root.

## Acceptance criteria

1. `index.html` loads `src/main.js` as a module and the game plays as before
   on desktop and phone (playtest checklist, both).
2. `npm run build` emits `dist/index.html`, `dist/stompy.js`, `dist/style.css`,
   `dist/sounds/`, and that build passes the same checklist.
3. `npm test` runs at least the tests named above and passes in CI.
4. `src/sim/**` and `src/data/**` import nothing from `src/render`,
   `src/audio`, `src/ui`, `src/input` or the DOM (enforced by an ESLint
   `no-restricted-imports` rule in the flat config).
5. `src/main.js` is under 300 lines.
6. Two clients on `server/server.py` play a round as before.
7. `architecture.md`'s layout matches the tree.

## Performance

None expected. Module loading adds a handful of requests in development
only; the release bundle is one file. Verify no frame-time regression on the
reference phone after stage 4 (the `draw` hot path must not gain indirection:
keep `gl` and uniform locations in module scope, not on an object looked up
per draw).

## Open questions

- Whether `main.js` should stay a single entry or split desktop/touch
  bootstrapping. Default: single entry.
- Whether to use JSDoc `@typedef`s for `Mech`, `Game`, `Weapon` now. Default:
  yes, in `src/sim/types.js`, with `// @ts-check` off; they are documentation.
