# Architecture

Two halves: **what exists** (so you can find things and not break them) and
**where it is going** (the module split that milestone M0 performs). Line
numbers are as of commit `b4c6315`; use them as landmarks, then search.

## What exists

Four source files, no build step.

| File | Lines | Role |
|---|---|---|
| `index.html` | 18 | Shell: one `<main id="app">`, loads `style.css` and `stompy.js`. |
| `stompy.js` | ~2990 | The whole game in one IIFE. |
| `style.css` | 233 | Page layout, the overlay (briefing, pause, debrief, main menu), touch controls. |
| `server.py` | 296 | The arena relay: stdlib asyncio WebSocket server, scores and rounds. |
| `sounds/` | | 36 CC0 MP3 clips from Kenney, mapped in `sounds/README.txt`. |

### Shape of `stompy.js`

The file is one IIFE. The first ~420 lines are module-level helpers and
**data**. Everything else lives inside `start(root)` (line 421), which closes
over the GL context, the game state and every subsystem. That closure is why
the file cannot be split by moving functions around; see M0 below.

Sections, by the comment banners in the file:

| Lines | Section | Key names |
|---|---|---|
| 13–59 | DOM helpers, `store` (localStorage under `stompy.*`), `Sound` audio unlock (iOS rules documented inline) | `$`, `esc`, `store`, `settings`, `Sound.unlock` |
| 60–106 | Maths: scalars, 3-vectors as plain arrays, 4×4 column-major matrices | `clampN lerp wrapA rnd add sub mul dot cross len norm mix3 dirOf`, `M.{id mul T S RX RY RZ persp lookAt apply}`, `chain` |
| 110–133 | `Builder`: flat-shaded triangle soup (pos, normal, colour per vertex), `tri`, `quad`, `cube` with tapered top | `Builder` |
| 135–231 | **Game data**: weapons, fire categories, chassis, mech info, palettes, missions, MP colours, section names | `WEAPONS CATS CAT_OF CHASSIS MECH_ORDER MECH_INFO PALS MISSIONS missionDef MP_COLORS HPK SECT_NAME` |
| 233–305 | Terrain: 96×96 grid of 24 m cells, value-noise heights, flat start zone, `height(x,z)` on the same triangle split as the mesh; rocks and four "outposts" baked into the terrain mesh | `N CELL HALF BOUND makeTerrain buildTerrainMesh` |
| 307–420 | Body plans per leg type and the mesh builders for each | `GEO geoOf buildMechParts buildReverseParts buildQuadParts` |
| 449–551 | GL setup: one lit shader with fog, emissive and an IR path (`uIR`, per-draw `heat`), one sky shader, `upload`, `draw` | `prog skyProg U A SU upload meshes mechParts partsKeyFor draw drawHeat` |
| 552–802 | Sound and voice: sample loading, spatialisation, loops, `sfx.*`, speech synthesis with de-duplication | `loadSamples play loopSet sfx say` |
| 803–874 | **Game state** and match setup | `G`, `keys`, `held`, `newMech`, `startMission`, `startSkirmish`, `startMatch` |
| 875–931 | Geometry helpers: frames, muzzle, eye, ray vs cylinder, ray vs terrain, `rayHit` | `frame torsoFrame center muzzle eyeOf viewYaw rayCyl rayTerrain rayHit` |
| 932–954 | Effects: messages, particles, explosions | `msg particle explode` |
| 955–1071 | **Combat**: section routing, damage, destruction, win/lose, firing | `sectionHit damage destroy fire` |
| 1072–1116 | **Simulation** of one mech: speed, jets, gravity, heat, shutdown, cooldowns | `stepMech` |
| 1117–1226 | Legs: planted feet, swing windows, two-bone IK | `restFoot initFeet swingTarget gait footDown solveKnee limb` |
| 1227–1276 | **AI**: one function, state in `m.ai` | `think` |
| 1277–1409 | **`update(dt)`**: input → player, aim ray, per-mech tick, collisions, projectiles, particles, wrecks, MP send cadence, audio loops, end-of-match timer | `update` |
| 1410–1455 | Continuous laser beams and armour melt | `MELT_T MELT_MAX MELT_COOL meltMult beamTick coolArmour beamMult` |
| 1456–1620 | Fusion cannon: scan, lock help, discharge pulse, sounds | `fusionTick nearMiss fusionFire launchPulse updatePulses fusionSound remoteBeam flushHits beamSound drawBeam` |
| 1621–1721 | Missiles: tap vs hold, guided camera, blast radius, fire-by-category, alpha, target cycling | `HOLD_TO_GUIDE BLAST_R missileTrigger startGuide steerVolley steerBy endGuide blast fireCat alpha cycleTarget` |
| 1722–1901 | **Rendering**: resize, `drawMech` (legs via IK), `render()` (camera per state, sky, world, mechs, wrecks, shots, pulses, beams, particles) | `resize drawMech render` |
| 1902–2297 | **HUD** on a 2D canvas: layout for desktop vs touch, radar, bars, mech diagram, weapons, arena board, guide HUD | `project hudLayout mechDiagram drawArenaHUD drawGuideHUD drawHUD` |
| 2298–2548 | Screens: controls tables, options, overlay, **main menu** with live mech, launch, debrief, pause, overlay click handling, mech cycling | `showOverlay mainMenu renderMenu menuDetail go launch debrief pause cycleMech` |
| 2549–2626 | Input: pointer lock, mouse, keyboard | `lockPointer onMouseMove onKeyDown onKeyUp GAME_KEYS` |
| 2627–2721 | Touch: floating stick, aim drag, buttons, per-finger tracking | `touchButton syncTouchUI` |
| 2722–2960 | **Multiplayer** client: join, protocol handler, arena setup, spawn, state send/receive, interpolation, relayed effects | `Net join netSend onNet startArena spawnPoint respawn sendState netState netInterp netFx` |
| 2961–2987 | Frame loop: variable `dt` capped at 50 ms, pause on blur, audio keep-alive | `loop` |

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
scale, AI preferred range and accuracy, per-section HP, colours, and a fixed
`weapons: [[type, mount], ...]` list. `legs` names a body plan in `GEO`.

**Missions** (`MISSIONS`, line 198) are `{ name, pal, foes[], intel }`;
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
  in torso space.
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

Client → server: `hello {name, color}`, `s {state...}` (15 Hz), `fx {k, ...}`
(`b` beam flash, `s` shell, `m` missile volley, `fu` fusion discharge, `mg`
guided volley update, `md` detonate), `hit {to, amt, p, fu}`, `died {by}`.

Server → client: `welcome {id, seed, pal, limit, over, scores}`, `full
{max}`, `join`, `leave`, `s` and `fx` stamped with `id`, `hit {from, amt, p,
fu}`, `kill {victim, killer, scores}`, `roundover {winner, name, next,
scores}`, `newround {seed, pal, scores}`.

The state message (`sendState`, line 2873) carries chassis `ch`, pose, speed,
alive/shutdown flags, per-section hp, beam state (`bm`, `be`, `bf`), fusion
scan state (`fl`, `sc`, `sp`). Note `sp` is used twice in that object (speed
and scan progress); the second wins. Fixing that is in the M5a issue list.

## Where it is going (M0)

M0 splits `stompy.js` into ES modules without changing behaviour, so that sim
code can be tested headlessly and later features land in files of a few
hundred lines. The constraints:

- Served as-is in development: `index.html` loads `src/main.js` with `<script
  type="module">`. No bundler needed to play.
- `npm run build` runs esbuild to produce `dist/stompy.js` (one file) for
  releases and itch.io. `npm test` runs `node --test`. `npm run lint` runs
  ESLint. These are the only dev dependencies.
- Pure modules (no `document`, `window`, `gl`, `AudioContext`) are the ones
  tests import. The split is designed around that boundary.

### Target layout

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
    geo.js         GEO body plans
    palettes.js    PALS and weather/time variants (M4)
    missions.js    MISSIONS, missionDef, objective definitions (M3)
    colors.js      MP_COLORS
  world/
    terrain.js     makeTerrain, height sampling, BOUND
    terrainMesh.js buildTerrainMesh (Builder in; GL out)
    props.js       buildings, rocks, structures as entities (M3/M4)
  mesh/
    builder.js     Builder
    mechParts.js   buildMechParts / Reverse / Quad
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

`update(game, input, dt, fx)` is then a pure-ish function of its arguments.
`render(game, gl...)` reads `game` and draws. The HUD reads `game`. The
network layer reads/writes `game.mechs`. This is the whole trick; it is a
mechanical refactor but a large one, and it is the only M0 item that touches
everything. See [specs/00-module-split.md](specs/00-module-split.md) for the
staged order that keeps the game playable at every commit.

### Determinism

`Math.random` is used throughout the sim (spawn angles, AI jitter, spread,
particles). M0 introduces `sim/rng.js` (a small xorshift or mulberry32 seeded
from the match seed) and routes every sim-side call through `game.rng`.
Particles and sound variation may keep `Math.random`; anything that affects
hit outcomes, AI decisions or spawn positions must not. This is what makes
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
| Frame time, mid-range 2021 Android phone (Pixel 6a / Galaxy A53 class), DPR capped at 2 | ≤ 16.6 ms sustained in a 6-mech fight with weather on |
| Frame time, 2019 phone (Pixel 3a class) | ≤ 33 ms |
| Draw calls per frame | ≤ 500 |
| Triangles per frame | ≤ 300k |
| `update()` CPU | ≤ 4 ms on the 2021 phone |
| JS heap growth over a 5-minute mission | none visible (no leak) |
| Initial load, static assets | ≤ 2 MB over the wire including sounds |

Headroom today is decent; the things that will eat it are weather particles
(M4), more mechs on screen (co-op and bigger missions), and buildings (M3/M4).
Instanced particles and a particle cap are M4 work; frustum culling of props
is M3/M4 work.
