# Architecture

Two halves: **what exists** (so you can find things and not break them) and
**where it is going** (the module split that milestone M0 performs). Line
numbers are as of commit `b4c6315`; use them as landmarks, then search.

## What exists (after M0)

The game is ES modules under `src/`, served as-is (`index.html` loads
`src/main.js`; no bundler to play). `npm run build` makes one minified file
in `dist/` for releases. Node 22 runs the headless tests; Python 3 runs the
relay and its tests.

| Path | Lines | Role |
|---|---|---|
| `src/main.js` | ~120 | Bootstrap: builds the page, creates everything below, wires them through one `app` object, runs the frame loop. |
| `src/sim/` | ~900 | **The simulation.** `state.js` (`createGame`, `newMech`, `startMatch`, `resetMatch`), `update.js` (`update(game, input, dt)`), `geom.js`, `effects.js`, `combat.js`, `mech.js`, `gait.js`, `beams.js`, `fusion.js`, `missiles.js`, `ai.js` with `ai/perception.js` (line of sight, belief, shout, search) and `ai/behaviours.js` (keepRange, harass, useCover, ridge, brawler, holdLine, avoidEdge, avoidAllies; `steer` runs a plan) and `ai/fire.js` (heat cap, lock, alpha, section targeting) and `ai/profiles.js` (a plan per chassis) and `ai/group.js` (shared fixes, the flanker), `melee.js`, `knock.js`, `feel.js`, `voice.js`, `loadout.js` (mechlab: stock, validate, apply, stats), `entities.js` (M3: structures, vehicles and nav points in `G.entities`: `addEntity`, `stepEntities`, `damageEntity`, `destroyEntity`, footprints), `objectives.js` (M3: `initObjectives`, `tickObjectives`; the mission's win and loss), `placement.js` (polar `[bearing°, dist]`, flat pads), `waves.js` (`spawnWave`, difficulty ±1 mech), `turrets.js` (mission 9's launchers: aim and fire LRM volleys via `combat.js` `volley`), `rng.js`, `fx.js`. No DOM, GL, audio or input imports (lint enforces it). |
| `src/data/` | ~200 | Weapons, chassis, body plans (`geo.js`), palettes, missions, arena colours, and `names.js` (every display name, keyed). |
| `src/world/` | ~110 | `terrain.js` (heights, `height(x, z)`, `BOUND`, a `flat` option for tests), `terrainMesh.js`. |
| `src/mesh/` | ~140 | `builder.js` (flat-shaded triangle soup), `mechParts.js` (each chassis's parts: legs by leg type, sized from its body plan; torso, arm and barrel by `style`), `props.js` (mission props in unit space, scaled to each entity's cylinder; `<key>Wreck` once blown up, `<key>Head` turns). |
| `src/render/` | ~730 | `gl.js` (`createRenderer`: context, shaders, `upload`, `draw`, mesh sets), `scene.js` (`createScene`: camera, sky, world, mechs with IK, effects), `hud.js` (`createHud`: the 2D instruments, the missile camera feed, the `?debug=1` readout). `look.js` (the 3D view's tunable resolution: `backingSize`, `readLook`; a `?debug=1` LOOK row in the FEEL panel sets lines and antialiasing to settle the pixel look, spec 14). |
| `src/audio/` | ~360 | `sound.js` (`createAudio`: unlock dance, samples over synthesis, spatialisation, loops, `sfx.*`, the voice `say`, the beam and scan tones, `tick`). |
| `src/input/` | ~220 | `input.js` (`createInput`: keyboard, mouse with pointer lock, touch stick/aim/buttons, one per-frame `snapshot()`). |
| `src/ui/` | ~280 | `screens.js` (`createUi`: main menu with the live mech, briefing detail, settings, pause, debrief, mission and skirmish start, click routing), `debrief.js` (the objective rows and the banner). |
| `src/net/` | ~330 | `protocol.js` (`PROTOCOL`, message builders, `parse`), `client.js` (`createNet`: join, handler, spawn, 15 Hz state, relayed effects, `tick`), `interp.js` (`netInterp`). |
| `src/util/` | ~70 | `math.js` (scalars, vec3, `M` matrices, `chain`, cosmetic `rnd`), `store.js`, `dom.js`. |
| `server/` | 300 + tests | `server.py` the relay (unchanged logic), `test_server.py`. |
| `test/` | | `*.test.js` headless (`helpers.js` builds a flat-ground game with a recording fx), `smoke/run.mjs` (Playwright: desktop mission, touch layout, two-pilot arena against the real relay). |
| `scripts/` | | `serve.mjs` (static server), `build.mjs` (esbuild), `perf.mjs` (`npm run perf`: the frame-cost harness and its budgets, spec 14). |
| `.github/workflows/` | | `ci.yml` (lint, test, build, server tests, smoke), `pages.yml` (gated by the `STOMPY_DEPLOY_PAGES` variable). |

### How the pieces talk

- **`app`** (built in `main.js`): `{ root, wrap, cv, hud, ov, ctx, R, prefs, params, G, audio, scene, hud, input, net, ui }`.
  Page-side modules receive it and call each other through it at event time
  (`app.ui.pause(true)`, `app.net.send(...)`), which is what lets them be
  created in any order.
- **`G`** (`createGame`) is the one state object. Only the sim mutates
  gameplay state; render, HUD and net read it; input writes nothing to it
  directly (it produces a snapshot). `G.fx` is the effects sink the sim talks
  through (`say`, `sfx.*`, `fusionSound`, `netSend`); `G.hooks` holds the two
  callbacks the page installs (`debrief`, `arenaDeath`). `G.rng` is the
  seeded randomness; `G.clock` is real time in ms, set by the loop.
- **Input snapshot** (`src/input/input.js` → `update`): `{ thrUp, thrDown,
  stop, turn, twist, pitch, centre, jets, held: {energy, ballistic, missile,
  fusion}, missileTap }`. The HUD reads the last one from `G.input`.
- **prefs** (`main.js` `loadPrefs`): `{ sound, voice, invert, mission, chassis,
  menuSel, fpMap, fpFoes, mpName, mpColor }`, persisted under the same
  `stompy.*` keys as before.
- **Frame**: `update(G, input, dt)` → `net.tick(dt)` (arena cadence, respawn)
  → `audio.tick()` (loops follow the state) → `scene.render()` → `hud.draw()`.

### The data model

A **mech** (`newMech`, line 827) is a plain object:

```
{ type, ch: CHASSIS[type], team (0 = player side), partsKey, netId, remote,
  x, y, z, vy, yaw, twist, pitch, speed, throttle, heat, fuel,
  jetting, air, shutdown, alive, spawnT,
  hp: {T, LA, RA, LL, RL}, max: {...},
  weapons: [{ type, def: WEAPONS[type], mount, cd, ammo, dead, side }],
  ai: { aware, strafe, strafeT, jitter, wp, coolT, beamAim },
  feet: [...], cyc, bob, lastYaw,            // gait (initFeet / gait)
  melt, beamOn, beaming, beamEnd, beamMech,  // laser target state
  fusion: { on, t, mech, end, slipping },    // fusion scan state
  net: { ...last state message, at }         // remote mechs only
}
```

**Game state** is the single `G` object (line 812) plus a few `let`s next to
it (`ter`, `world`, `pal`, `missionN`, `chassis`, `menuSel`, `fpMap`,
`fpFoes`). Important fields: `G.state` (`menu` | `play` | `over` | `debrief`),
`G.paused`, `G.mode` (`mp` or undefined), `G.kind` (`campaign` | `free`),
`G.worldKind` (`menu` | `match`), `G.player`, `G.mechs`, `G.shots`,
`G.beams`, `G.cbeams`, `G.parts`, `G.wrecks`, `G.pulses`, `G.msgs`,
`G.target`, `G.aim`, `G.aimMech`, `G.guide`, `G.stats`, `G.def` (the mission
definition), `G.time`.

**Weapons** (`WEAPONS`, line 135) have a `kind`: `beam` (continuous, `dps`,
`hps`), `shell` (projectile, `dmg`, `speed`, `ammo`), `missile` (`count`,
homing, blast), `fusion`. Fire controls are by **category** (`CATS`,
`CAT_OF`): energy, ballistic, missile, fusion. There are no weapon groups by
design.

**Chassis** (`CHASSIS`, line 169) hold speed, turn rate, heat sink rate,
scale, AI preferred range and accuracy, per-section HP, colours, and the
mechlab block (`tons`, `frame`, `hardpoints`, `systems`, and an optional `sysMax` that caps a system lower for that chassis; see the loadout section). A `melee` block gives a chassis fists (`data/melee.js`: `FIST_MELEE`, `meleeOf`, `punchArm`). `unlock` is the number of campaign missions to clear before it can launch (`isUnlocked`; the menu reads the best ever, saved as `mech.best`, so restarting the campaign keeps unlocks; `?unlock` opens everything for testing), and `lockedLook` is its silhouette in the selector. `legs` names a body plan in `GEO`; an optional `geo` partial overrides any of it (`geoFor(ch)`, which `geoOf(m)` calls), and an optional `style` picks the torso and arms (default: the leg type).

**Missions** (`MISSIONS`, line 198) are `{ name, pal, foes[], intel }`, plus from M3 `objectives`, `entities` (placed by polar `[bearing°, dist]`) and `flat` pads;
`missionDef(n)` returns hand-authored ones for n < 4 and procedural contracts
after. Win = no enemy alive; lose = player torso gone (`destroy`, line 1005).

### Invariants you must not break

- **Feet never slide.** A planted foot's world position is fixed until it
  lifts; swings land where the rest spot will be at touchdown. Any change to
  movement must keep `gait()` fed with real displacement (the gait clock is
  distance, not time).
- **Terrain height matches the mesh.** `ter.height` uses the same triangle
  split as `buildTerrainMesh`. If you change one, change both, and keep the
  test that samples both.
- **Mechs are vertical cylinders** for hits (`rayCyl`) with radius and height
  from `GEO`. Section routing (`sectionHit`) is by height and lateral offset
  in torso space. Structures and vehicles are cylinders too (`radius`,
  `height` on the entity): `rayHit` returns `{ mech }` or `{ ent }`, blasts and
  punches reach them, and their footprints push mechs out. An entity has one
  `hp` pool; `hp: Infinity` is decorative.
- **Melt belongs to the target.** Laser damage ramps on the *target's* `melt`,
  shared by every beam on it. Do not move it to the shooter.
- **Heat 100 shuts the reactor down, 45 restarts it.** Shutdown halts movement
  and firing. The fusion cannon deliberately jumps heat to 140.
- **In the arena the shooter scores, the victim applies.** Remote hits are
  batched per victim (`G.pendingHits`) and flushed at 15 Hz. Deaths are
  declared by the victim (`died`). The server clamps `amt` to 40 and passes
  `fu` (fusion kill) through unchanged.
- **Audio only after a gesture**, and iOS needs the dance in `Sound.unlock`.
  Never play from a timer before the first tap.
- **Touch and mouse are both live** and switch automatically (`G.touchUI`
  starts from `(pointer: coarse)` and flips when a mouse moves).
- **`dt` is capped at 50 ms** and the sim is variable-step. Nothing may
  depend on frame count for timing.
- **Everything the menu shows is drawn by the game renderer** (`G.worldKind
  === 'menu'`). The menu's mech is a real mech object on a patch of desert.

### The network protocol (as it is)

`PROTOCOL` is 6 (2: M1 melee; 3: M2 mechlab loadouts; 4: `w` on the shell and missile effects so other screens draw the right round, `zap` on a hit so a bolt scrambles the victim; 5: `hh` on a hit, the heat a flamer poured in, which the victim adds, clamped to 20 by the server; 6: `knuckles` in the loadout's systems, PURPLE PUNCHER's KNUCKLES slot).

Client → server: `hello {v, name, color}`, `s {state...}` (15 Hz), `fx {k, ...}`
(`b` beam flash, `s` shell, `m` missile volley, `fu` fusion discharge, `mg`
guided volley update, `md` detonate, `pu` a punch starts), `hit {to, amt, p,
fu, kb?, me?, st?, zap?, hh?}`, `died {by, me?}`.

Server → client: `welcome {id, seed, pal, limit, over, scores}`, `full
{max}`, `join`, `leave`, `note {k}` (`k: 'lo'`: your loadout was rejected), `s` and `fx` stamped with `id`, `hit {from, amt, p,
fu, kb?, me?, st?, zap?, hh?}`, `kill {victim, killer, scores, me?}`, `roundover {winner,
name, next, scores}`, `newround {seed, pal, scores}`.

Melee on the wire (`docs/specs/12-melee.md` § Arena): the shooter-scores rule
holds. A punch or stomp on another pilot rides the batched `hit` with `me: 1`
or `st: 1` and `kb: [vx, vz]`, the knockback impulse; the victim's client
adds `kb` to its push, jolts its aim and plays the lurch. The server clamps
each `kb` part to ±30 and `amt` to 40 as before. `died {me: 1}` makes the
server's `kill` carry `me`, and the kill feed says PUNCHED OUT.

The state message (`stateMessage` in `src/net/protocol.js`) carries chassis
`ch`, pose, speed `sp`, alive/shutdown flags, per-section hp, beam state
(`bm`, `be`, `bf`), fusion scan state (`fl`, `sc`, `sq`), and the punch phase
`pu` (0 none, 1 wind-up, 2 recovery), which `meleeGhost` turns into the
swing pose on other screens; `fx {k: 'pu'}` starts the wind-up without
waiting for the next report.

Mechlab loadouts (`docs/specs/02-mechlab.md` § Arena): `s` carries `lo`, the
validated loadout, whenever it changes and every 30th message (2 s) so late
joiners learn it. Receivers refit the remote mech when `lo` differs from the
last one they applied. The relay checks every `lo` with `server/data.py`,
which loads `server/loadout_tables.json`, a fixture written from the game's
own tables by `npm run fixture:loadout` (a Node test fails if it is stale; a
Python test replays its answered cases). A malformed or overweight loadout is
relayed as stock and the sender gets `note {k: 'lo'}`, refits to stock and
shows LOADOUT REJECTED. (`sq` was `sp`
before M0, which overwrote the speed; the client reads whichever it sent, so
there was never a cross-version issue.) `hello` carries `v: PROTOCOL`; the
server ignores it until M5a enforces it.

## How M0 split it (kept for the record)

M0 split the original single `stompy.js` into the modules above without
changing behaviour. The constraints it worked under:

- Served as-is in development: `index.html` loads `src/main.js` with `<script
  type="module">`. No bundler needed to play.
- `npm run build` runs esbuild to produce `dist/stompy.js` (one file) for
  releases and itch.io. `npm test` runs `node --test`. `npm run lint` runs
  ESLint. These are the only dev dependencies.
- Pure modules (no `document`, `window`, `gl`, `AudioContext`) are the ones
  tests import. The split is designed around that boundary.

### Layout (as built, with the files later milestones add marked)

```
index.html
style.css
src/
  main.js          entry: builds the app, wires loop, input, screens
  util/
    math.js        scalars, vec3, M (matrices), chain, seeded RNG
    store.js       localStorage wrapper
    dom.js         $, esc
  data/
    weapons.js     WEAPONS, CATS, CAT_OF, CAT_LABEL, CAT_KEY
    chassis.js     CHASSIS, MECH_ORDER, MECH_INFO, hardpoints (M2)
    geo.js         GEO body plans, geoFor (per-chassis overrides)
    palettes.js    PALS and weather/time variants (M4)
    missions.js    MISSIONS, missionDef, objective definitions (M3)
    colors.js      MP_COLORS
    names.js       every display name, keyed; the only place a name lives
  world/
    terrain.js     makeTerrain, height sampling, BOUND
    terrainMesh.js buildTerrainMesh (Builder in; GL out)
    props.js       buildings, rocks, structures as entities (M3/M4)
  mesh/
    builder.js     Builder
    mechParts.js   buildMechParts: LEGS by leg type, BODY by style
    props.js       buildProps, propFor: relay, tank, truck, launcher (+Head), pad, wrecks
  sim/
    state.js       createGame(): the G object and factories (newMech)
    mech.js        stepMech, heat, shutdown
    gait.js        feet + IK
    combat.js      sectionHit, damage, destroy, fire, blast
    beams.js       melt, beamTick, coolArmour
    fusion.js      fusionTick, fusionFire, pulses
    missiles.js    missile steering, guide state (no camera code)
    ai.js          think, per-chassis behaviours (M1)
    objectives.js  objective state machines (M3)
    turrets.js     stepTurrets: static launchers that fire volleys (M3)
    update.js      update(dt): the orchestration, taking an input snapshot
    rng.js         seeded PRNG for everything the sim randomises
  render/
    gl.js          context, shaders, upload, draw
    scene.js       render(): camera, sky, world, mechs, effects
    hud.js         drawHUD and friends (2D canvas)
    menuScene.js   the menu mech view
  audio/
    sound.js       Sound unlock, samples, play, loops
    sfx.js         sfx.* recipes
    voice.js       say()
  ui/
    overlay.js     showOverlay/hideOverlay, click routing
    menu.js        main menu, settings, mech select
    mechlab.js     (M2)
    screens.js     briefing, pause, debrief
    debrief.js     objectiveRows, debriefTitle: the debrief's tick-or-cross rows
  input/
    keyboard.js
    mouse.js
    touch.js
    gamepad.js     (M6)
    input.js       merges sources into one per-frame snapshot
  net/
    protocol.js    message builders/parsers, schema version
    client.js      Net, join, onNet, send cadence
    interp.js      netInterp
    coop.js        (M5b)
server/
  server.py        the relay (moved; same code)
  test_server.py   unittest for handshake and message handling
test/
  *.test.js        node --test, imports from src/sim, src/util, src/world, src/data
  smoke.spec.js    Playwright: load, start a mission, run 300 frames, no errors
dist/              build output, gitignored
```

### How the split handles the closure

Today `update`, `render`, `drawHUD`, `think`, `fire` etc. all read `G`, `ter`,
`pal`, `gl`, `sfx`, `say`, `msg` from the enclosing scope. The split replaces
that with two objects passed explicitly:

- **`game`** (from `sim/state.js`): everything that was `G` plus `ter`, `pal`,
  `rng`, `time`. Pure data. The sim mutates it; tests build one with
  `createGame({ seed, mission })` and step it.
- **`fx`** (an "effects sink" interface): `{ msg, say, sfx, particle, explode,
  beam, netSend }`. The real app passes the audio/visual implementations; tests
  pass a recorder or no-ops. Sim code never touches audio or GL directly.

`update(game, input, dt)` is then a pure-ish function of its arguments (the
sink lives at `game.fx` rather than being a fourth argument).
`render(game, gl...)` reads `game` and draws. The HUD reads `game`. The
network layer reads/writes `game.mechs`. This is the whole trick; it is a
mechanical refactor but a large one, and it is the only M0 item that touches
everything. See [specs/00-module-split.md](specs/00-module-split.md) for the
staged order that keeps the game playable at every commit.

### Determinism

`Math.random` was used throughout the sim (spawn angles, AI jitter, spread,
particles). M0 introduced `sim/rng.js` (a small xorshift or mulberry32 seeded
from the match seed) and routes every sim-side call through `game.rng`.
Everything inside `src/sim` draws from it, particles included; render and
audio keep `Math.random` (`rnd` in `util/math.js`) for cosmetic jitter. This is what makes
tests reproducible and what co-op (M5b) later needs so that the host and
guests agree on terrain and spawns.

### Performance envelope

Current costs per frame: terrain is ~18k triangles in one draw; each mech is
~10 to 14 draws (torso, hip, per-leg segments, arms, pods); particles are one
draw each (a scaled cube), as are beam segments and the fusion pulse's up to
6×28 segments. The HUD is a full 2D canvas redraw. There is no culling.

Budget going forward (see [workflow.md](workflow.md) for how it is checked):

| Measure | Budget |
|---|---|
| Frame time, mid-range 2021 Android phone (Pixel 6a / Galaxy A53 class), DPR capped at 1.5 (`scene.js`) | ≤ 16.6 ms sustained in a 6-mech fight with weather on |
| Frame time, 2019 phone (Pixel 3a class) | ≤ 33 ms |
| Draw calls per frame | ≤ 500 |
| Triangles per frame | ≤ 300k |
| `update()` CPU | ≤ 4 ms on the 2021 phone |
| JS heap growth over a 5-minute mission | none visible (no leak) |
| Initial load, static assets | ≤ 2 MB over the wire including sounds |

Headroom today is decent; the things that will eat it are weather particles
(M4), more mechs on screen (co-op and bigger missions), and buildings (M3/M4).
Instanced particles and a particle cap are M4 work; frustum culling of props
is M3/M4 work. Measured baselines and the ordered plan (instanced effects, a
particle pool, an allocation diet, one draw per mech, a PIXELS setting,
culling, a perf harness) are in
[specs/14-look-and-performance.md](specs/14-look-and-performance.md): the
cost is draw calls, not triangles, and most draw calls are effects.
