# Big fights

| | |
|---|---|
| Status | in progress (parts 1–3) |
| Milestone | M14 |
| Size | L (in four parts) |
| Depends on | [14-look-and-performance.md](14-look-and-performance.md), [33-production.md](33-production.md) |
| Touch parity | the point of it: a phone holds its frame in a fight with many mechs |

## Summary

Battles should be big and still run on a 2021 phone. Today the simulation
gets slow fast as mechs are added, because several steps check every mech
against every other. This spec makes that cost grow in step with the number of mechs.
It measures each fix in a new crowd scene. Nothing the player does or sees
changes. How many mechs a map holds is left to playtesting.

## Where it stands

`update()` for one frame, every mech fighting at once (the worst case), on a
desktop CPU in Node. A 2021 phone is 4–6× slower, and spec 14 gives the sim
4 ms of the frame.

| mechs | ms per frame | on a phone |
|---|---|---|
| 12 | 1.0 | 4–6 |
| 27 | 3.1 | 12–19 |
| 52 | 6.5 | 26–39 |
| 102 | 15.5 | 62–93 |
| 202 | 44.7 | — |

Twice the mechs costs 2.5–3× the time. A profile at 100 mechs shows where
the time goes:

| what | share | grows with |
|---|---|---|
| shots meeting mechs (`stepShots`, `rayHit`) | ~14% | shots × mechs |
| finding a melee target (`meleeTarget`) | 8% | mechs × mechs |
| ground rays (`voxels.js` `ray`) | 7% | mechs (each looks every frame) |
| garbage collection | 7% | spread objects in steering, filtered lists |
| `think`, steering, keeping off allies (`avoidAllies`) | ~13% | mechs, and mechs × mechs |

Spec 14 measured 0.8 ms with 20 foes before the voxel ground and spec 33.
The same fight costs about 3× that now.

## Player experience

None, by design. The fights look and play the same. A phone holds its
frame with more mechs on the field.

## Design

Four parts, each its own PR, each measured against main in the crowd scene.

### Part 1: measure it

- **A crowd scene for the sim** (`scripts/crowd.mjs`, run by `npm run perf`
  after its browser scenes). Headless, in Node, on a fixed seed, the
  range's flat ground, with 12, 25, 50 and 100 foes. Each foe really thinks
  and shoots, unlike the bench. It prints ms per frame for each size and
  the ratio between sizes.
- **Counts it can budget.** Times are noisy on CI, so the budget is on
  counts: ground rays per frame and mech-pair checks per frame, at 50 mechs.
  Both come from counters the harness wraps around `G.ter.ray` and the new
  near-lookup (part 2). Nothing in the sim counts for the harness's sake.
- **GPU memory in the browser scenes.** The harness wraps `gl.bufferData`
  and `deleteBuffer`, and reports bytes held on the GPU after each scene,
  with a budget. This is the phone-memory budget offered after the map crash
  (#392). A scene that sweeps the map view joins the list.
- **Heap after each scene** too, so a leak in JS shows.

### Part 2: look near, not at everyone

A grid of the mechs, rebuilt once per frame (`src/sim/near.js`):

- 32 m squares over the map, filled from `G.mechs` at the top of
  `update()`. It's flat arrays, reused frame to frame, with no garbage.
- `mechsNear(G, x, z, r, out)` fills `out` with the live mechs whose middle
  is within `r` plus their radius, and returns how many there are.
- Its users, each a loop over every mech today:
  - `meleeTarget` and the swing's hit (`melee.js`): reach plus the widest mech.
  - `avoidAllies`: the ally gap. `holdLine`: its 150 m.
  - A shout to allies (`perception.js`): the shout's range.
  - `rayHit`'s mech test (`geom.js`): the squares along the shot's step.
  - `blast` (`missiles.js`): its radius. `nearMiss` (`fusion.js`): along the beam.
  - Mechs pushing each other apart (`update.js`), which checked every pair
    of live mechs every frame: now each mech against those it may touch,
    the pairs in the same order.
- Mechs move during the frame, so each lookup pads `r` by the farthest any
  mech can move in a frame. A wrong miss is worse than a spare check.
- **Same answers.** A headless test runs a seeded fight twice, once with the grid
  and once with a brute-force `mechsNear`. It asserts every mech ends where it
  did, with the same health. Order matters where a lookup
  takes the first match (`avoidAllies`), so `mechsNear` returns mechs in
  `G.mechs` order.

The same grid is what fog of war and a spatial index for buildings and things
would use later. It's built for mechs first, because that's where the time goes.

### Part 3: think less when far

- **Far foes think less often** (`FAR_THINK` in `data/ai.js`, `thinksNow`
  in `sim/ai.js`). A foe that can't see its prey, has no mech of another
  team within 400 m and wasn't hit in the last 2 s runs `think` every 4th
  frame. The frames are staggered by its place in `G.mechs`, so the work
  stays even. When it does think, it gets all the time it missed, so its
  turns, timers and strafing add up to the same as thinking every frame:
  about 4° of turn every 4th frame, at 400 m or more. Between those frames
  it walks on with its last throttle. Its feet, gait and physics still step
  every frame, so feet never slide.
  - A foe that sees its prey thinks every frame however far off: on HARD
    foes see 800 m, and could be firing at you.
  - Measured: fifty foes marching in from 600 to 1,100 m cost 25–35% less
    (0.61–0.79 ms against 0.82–1.27 ms here). A far patrol was already cheap
    and gains nothing measurable. Fights near you are unchanged.
- **Sight is already checked less often.** Each foe looks every 0.15 s,
  staggered (`AI.lookEvery`, spec 05), so there's nothing to do there. The
  rays left are shots, beams and the nav's feelers.
- This changes when far foes decide, not what fights do. Every existing AI
  test passes unchanged.

### Part 4: no garbage in the sim's hot loops

Measured first: a 50-foe fight made about 1,080 KB of garbage a frame in
Node. Done, each giving the same numbers to the bit (a seeded 30 s fight
hashes the same as before):

- `torsoFrame` built five new matrices and four products for every muzzle
  and eye, 116 KB a frame. `muzzle` and `eyeOf` now use scratch matrices,
  with the same Float32 steps in the same order.
- The steering shapers change `out` in place instead of spreading a new
  object (`{ ...out, moveYaw }`) for every foe every frame. Every driver's
  `out` is a new object, so nothing else holds it.
- `G.shots`, `G.beams`, `G.debris`, `G.pulses`, `G.falls` and `G.msgs` are
  compacted in place (`keepIf` in `util/math.js`) instead of `filter`ed
  into new arrays each frame.
- The grid's lookups no longer shrink the caller's array (which only made it
  grow again), and keep their query in typed arrays.

The result: about 15% less in Node (920 KB a frame), and 4–9% less in the
browser bench (`bench-fight` 201 → 180 KB, `bench-deaths` 234 → 219 KB).
Mean frame time doesn't move measurably; on a phone, less garbage means
fewer GC hitches. What's left is spread thin: the ground's rays and samples,
`gait` and `stepMech`, small vectors returned from functions and numbers
boxed on calls that aren't inlined. Each is a few percent, and the ground's
hot loops were already tuned for the browser (spec 14). Not worth the churn
until a phone shows hitches.

### Not in this spec

- **Drawing many mechs.** Each mech is several draw calls. Part 1 reports
  draws with 50 mechs on screen. If those draws turn out to be the limit,
  drawing each chassis's mechs together is its own spec.
- **The sim on a worker thread.** It isn't needed while the sim fits its 4 ms.
- **Ground storage for bigger maps** (sparse voxels, far ground by
  distance). That's a separate spec.

## Code touchpoints

- `scripts/crowd.mjs` (new), `scripts/perf.mjs`: the crowd scene, the
  counters, GPU bytes and heap, a map-view scene.
- `src/sim/near.js` (new): the grid, `buildNear(G)`, `mechsNear`.
- `src/sim/update.js`: `buildNear` at the top of the frame. It also calls
  `think` for far foes only on their frames.
- `src/sim/melee.js`, `src/sim/ai/behaviours.js`, `src/sim/ai/perception.js`,
  `src/sim/geom.js`, `src/sim/missiles.js`, `src/sim/fusion.js`: lookups
  through `mechsNear`.
- `src/sim/ai/behaviours.js`, `src/sim/combat.js`, `src/sim/effects.js`:
  no spread objects, lists compacted in place.
- `docs/architecture.md`: `near.js` on the map. `docs/workflow.md`: the
  crowd scene.

No network message changes. Co-op's host runs the foes as today.

## Acceptance criteria

1. `npm run perf` runs the crowd scene and fails when its ray or pair counts
   at 50 mechs, or a browser scene's GPU bytes, pass their budgets.
2. After part 2, mech-pair checks at 50 mechs drop by at least 5×. Twice the
   mechs costs no more than about 2.2× the time.
3. After parts 2–4, the crowd scene at 50 mechs takes under half of today's
   6.5 ms on the same machine.
4. A seeded fight ends identically with the grid and with the brute-force lookup.
5. Every existing test passes. The bench's draws and garbage don't rise.
6. On the reference phone, Free Play with 12 hostiles reports median and 95th
   percentile frame time, before and after (workflow's procedure).

## Tests

- `test/near.test.js`: `mechsNear` finds exactly what a brute-force check
  finds, at the map's edges and across squares, with mechs moving mid-frame.
  A seeded 20-mech fight ends identically either way.
- `test/ai.test.js`: a far foe thinks every 4th frame, and every frame once
  hit or within 400 m.
- The crowd scene is the measurement, not a test.

## Performance

This spec is the performance work. It adds one grid rebuild per frame: one
pass over the mechs, flat arrays, about 0.01 ms at 100 mechs.

## Open questions

- **How many mechs a map should hold.** The owner wants the battles to be
  impressive but still manageable, and will settle the number in playtests.
  Default: no cap beyond the crew's 8 per player. Raids and waves stay as
  they are, and this spec makes room for more.
- **The far-think distance and rate** (400 m, every 4th frame). Default as
  written. To be tuned if a far raid ever looks dim-witted.
