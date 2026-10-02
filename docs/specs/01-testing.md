# Testing, determinism and CI

| | |
|---|---|
| Status | ready |
| Milestone | M0 (extended by every later milestone) |
| Size | M |
| Depends on | [00-module-split.md](00-module-split.md) stages 1–3 |
| Touch parity | n/a |

## Summary

Make the simulation reproducible and testable without a browser, add a smoke
test that does use one, and run all of it on every PR. This is what lets many
agents change the same game without re-breaking it.

## Design

### Seeded randomness

`src/sim/rng.js` exports `makeRng(seed)` returning `{ next(), range(a, b),
pick(list), chance(p), seed }`. mulberry32 is enough: 32-bit state, fast,
decent distribution. The game owns one (`game.rng`) created from the match
seed in `startMatch`/`startArena`. Rule: any random draw that can change a hit,
a death, a position or an AI decision uses `game.rng`. Cosmetic draws
(particle velocities, sound pitch, HUD flicker) may use `Math.random`.

Why it matters beyond tests: co-op (M5b) needs every client to build the same
terrain and spawn the same enemies from the seed the host sends. Terrain is
already seeded; this extends it to spawns and AI.

### Fixed-step option

The sim stays variable-step for play (the 50 ms cap is fine). Tests call
`update(game, input, 1/60, fx)` repeatedly. A helper `test/helpers.js` exports
`stepFor(game, seconds, input, fx)` and `createTestGame(opts)` which builds a
game on a flat terrain (`makeTerrain` with a `flat: true` option added for
tests, every height 0) so that movement tests are not confused by slopes.

### Headless unit tests

`node --test test/`, Node 22+. No test framework. Assertions with
`node:assert/strict`. Each sim module has a test file; see stage 3 of the
split spec for the initial list. Later milestones add theirs (the specs say
which).

Coverage is not measured; the rule is instead that every spec's acceptance
criteria that *can* be asserted headlessly *are*.

### Smoke test in a real browser

`test/smoke.spec.js` with Playwright:

1. Serve the repo root (a tiny `scripts/serve.mjs` using `node:http`, also
   behind `npm run serve`).
2. Launch the preinstalled Chromium with `--use-gl=swiftshader` so WebGL
   works headless.
3. Load `/`, wait for the menu, click FREE PLAY, click LAUNCH.
4. Inject `window.__stompy` (exposed by `main.js` only when
   `?debug=1`) to read `game.player.x/z` and the frame counter.
5. Hold `KeyW` for 2 s of frames; assert the player moved more than 10 m and
   `game.frame` advanced; assert zero console errors and zero page errors.
6. Screenshot to `test-results/` as a CI artifact.

A second scenario loads with `?touch=1` (forces `G.touchUI`) and asserts the
touch cluster is visible and the dashboard HUD is not drawn.

### Server tests

`server/test_server.py` with `unittest`: pure helpers directly; the asyncio
session via a real `asyncio.start_server` on an ephemeral port and a minimal
hand-rolled WebSocket client in the test (the handshake and masking code is
short). Cases: bad origin rejected, good origin accepted, ninth player gets
`full`, `hit` amount clamped to 40 and `fu` passed, `died` increments scores
and reaching the limit broadcasts `roundover` then `newround` with
`STOMPY_ROUND_GAP=0`.

### CI

`.github/workflows/ci.yml` on pull requests and pushes to `main`:

- `npm ci`, `npm run lint`, `npm test`, `npm run build`.
- `npm run test:smoke` with `PLAYWRIGHT_BROWSERS_PATH` set to the action's
  install (in GitHub's runners we do install Chromium; the preinstalled path
  is only for Claude cloud containers).
- `python3 -m unittest discover server`.

`.github/workflows/pages.yml` on pushes to `main`, gated by the repository
variable `STOMPY_DEPLOY_PAGES == 'true'`: build and upload `dist/` as a Pages
artifact and deploy.

### In-game diagnostics

Behind `?debug=1` (and later a settings toggle, M1): a frame-time readout
(median and p95 over the last 2 s), draw-call count, particle count, and the
seed. Tests and perf reports read these.

## Acceptance criteria

1. Same seed, same mission, same input script → identical `game` after 600
   steps (deep-equal on mech positions, hp, heat, and `game.stats`).
2. `npm test` completes in under 20 s locally.
3. Smoke test passes in CI and uploads a screenshot.
4. Server tests pass with `python3 -m unittest`.
5. A PR that breaks lint, tests, build or smoke cannot be merged (branch
   protection on `main`, set by the owner once CI exists).

## Open questions

- Branch protection requires the owner to flip settings; the plan assumes
  they will once `ci.yml` is green.
- Whether to track frame-time numbers over time (a JSON file in the repo
  updated by PRs). Default: no; numbers go in PR bodies.
