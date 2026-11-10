# Architecture

Three halves that only meet in `src/game/app.c`: the **sim** (headless,
tested), the **platform** (SDL: window, pad, audio, rumble) and the
**renderer** (OpenGL 3.3, flat polygons, the HUD). C11; any library beyond
SDL2 and GL is the owner's call (docs/README.md § Decisions).

```
deck/
  Makefile            make, make test, make lint, make run
  src/
    util/             mathx (vectors, 4x4 matrices), rng (mulberry32), spring (damped springs)
    data/             every tuned number, ported from the reference's src/data; names.c (display names, voice pools)
    sim/              the simulation: no SDL, no GL (make lint enforces it)
    platform/         SDL2: window and GL context, the pad, keyboard and mouse, rumble, the synthesiser
    render/           GL: the loader and shader, the mesh builder and every chassis's parts, the scene, the HUD
    game/             the app: screens, the loop, settings, the effects sink
    main.c            arguments and go
  test/               the headless sim tests (make test); no SDL needed
  tools/shot.sh       a screenshot under a virtual screen, for machines with no display
  docs/               this plan
```

## The sim (`src/sim`)

| File | Role |
|---|---|
| `sim.h` | Every struct: `Game` (the whole state, one struct, no allocation), `Mech`, `Weapon`, `Shot`, the particle pool, debris, wrecks, pulses, beams, messages; `Input` (the per-frame snapshot) and `Fx` (the effects sink). |
| `game.h` | Every sim function, by module. |
| `terrain.c` | The ground: a 96 by 96 grid of 24 m cells with value-noise heights and a flat zone round the start. `terHeight` samples the same triangle split the mesh is built from. `terRay` marches and bisects. |
| `state.c` | `gameInit`, `newMech` (the stock loadout, the AI, the feet, the springs), `startMatch` (a mission), `startFreePlay`, palettes by time of day, the fog. |
| `update.c` | One frame: the player's controls into the mech, the aim ray, the lock, the triggers by category, every mech's think and step, beams, collisions, objectives, shots, deaths, pulses, particles, debris, wrecks, the camera numbers' decay. |
| `geom.c` | Frames (`frameOf`, `torsoFrame`), `muzzleOf`, `eyeOf`, `centerOf`, the upright-cylinder ray test, `rayHit` (mechs then ground), `sectionHit` (which section a point on the body is), `leadPoint`, line of sight. |
| `gait.c` | Planted feet and the distance clock (spec 00 § Legs). `restFoot`, `gait` (the swing, the footfall, the pendulum body on its springs), `solveKnee` for the renderer. |
| `mech.c` | `stepMech`: speed and the slope, the push and its decay, jets, gravity, the landing (dig-in, stomp), heat and the 100/45 shutdown, cooldowns, the springs, then the gait. |
| `feel.c` | The body springs (squash, wobble, sag, inertia tilt), the camera bob, and `feel(G, event, ...)`: one call per event, one row of the table in `data/data.c`. |
| `combat.c` | `damage` (sections, overflow to the torso, sparks, the clang, the AI's alert), `loseSection` (weapons die, the part comes off), the death in beats, wrecks, `fire`, shells and bursts, volleys, `stepShots`. |
| `beams.c` | Lasers: the target's melt (shared by every beam on it), the flamer's cone and heat, `coolArmour`. |
| `missiles.c` | Tap to fire, hold to guide, let go to detonate; the blast's falloff and shove; `fireCat`, `cycleTarget`. |
| `fusion.c` | The scan (slack, grace, assist), the discharge (heat to 140, shutdown, feedback), the pulse that kills on arrival. |
| `melee.c` | The punch (wind-up, hit frame, recovery), the stomp, `knock` (mass-scaled, with the aim jolt), the drawn pose. |
| `jets.c` | Blast-off jets: charge, the lock and the aimed blast, the ring, the flight's steering and where it lands. |
| `ai.c` | Perception (sight, the react delay, the shout, lost contact), the profiles (baseline, harass, line, skirmish, sniper, brawler) as drivers and shapers, fire discipline by difficulty, `think`. |
| `effects.c` | Messages, the particle pool, debris, `hitSparks`, `explode`, scorches. |
| `voice.c` | The cockpit voice's pools: a seeded pick, no dry line twice, one a minute. |

### How the pieces talk

- **`Game` is the one state object.** Only the sim mutates it; the renderer
  and HUD read it; input writes nothing to it directly (it makes a snapshot).
- **`Input`** (`controls.c` → `update`): `thr`, `turn`, `twist`, `pitch`
  (-1..1 rates), `twistBy`, `pitchBy` (radians this frame, from the gyro and
  the mouse), the held triggers by category, and the presses.
- **`Fx`** is how the sim asks for anything outside itself: `say` (a voice
  line), `sfx` (a sound by kind, positioned or your own), `thump` (the feel
  table's bass, duck and haptic columns), `fusionSound`. The app wires them
  to the synthesiser, the HUD's messages and the pad's rumble. The tests
  wire a recorder.
- **The frame** (`app.c`): poll the platform → map the raw state to an
  `Input` → `update` at a fixed 1/60 (up to four steps if a frame hitched,
  presses only on the first) → `audioTick` (the loops follow the state) →
  `sceneRender` → `drawHud` → the screen on top → swap, with vsync.
- **Pointers are stable:** mechs live in `G->mechs[]` for the whole match
  (the dead stay as wrecks), so a `Mech *` is safe to keep for a match.

### The data model

A **mech** (`Mech`): type, chassis, body plan, team; position, `yaw` (the
legs), `twist` and `pitch` (the torso), `speed`, `throttle`, `heat`, `fuel`;
`hp[5]` and `max[5]` by section (T, LA, RA, LL, RL); up to six weapons; the
feet and the gait's clock and drawn body; the melt (the target's); the fusion
scan; the melee swing; the jets; the push and every spring; the AI.

**Weapons** have a `kind`: beam (dps, hps), shell (dmg, speed, ammo, bursts,
knock, recoil, bolt), missile (count, homing or not), fusion. Fire controls
are by **category** (energy, ballistic, missile, fusion). There are no weapon
groups by design.

**Chassis** hold speed, turn, sink, scale, the AI's range and accuracy and
profile, per-section hp, colours, the mechlab block (tons, frame, hardpoints
each locked to a category, the stock systems), a melee block for fists, a
body plan override, and the unlock.

**Missions**: a palette, a seed, a time of day and weather, a ramp, the foes
by polar [bearing, distance] from the centre (asleep or awake, a profile
override), the objective kind, the brief. Only ELIMINATE is implemented.

## The platform (`src/platform`)

- `platform.c`: SDL init (a 3.3 core context, vsync), the pad (hidapi for
  the Deck, so paddles, trackpads and the gyro come through), the raw state
  of one frame (`Raw`), rumble (the strongest buzz wins until it runs out).
- `controls.c`: `Raw` → `Input` and the menus' presses. Pure.
- `audio.c`: the synthesiser in the audio callback: oscillator and
  filtered-noise voices for the one-shots (the reference's recipes), the
  sub-bass thump through a soft clipper, the loops (hum, jets, servo, beam,
  sizzle, fusion scan) on a bus that ducks under impacts. No samples yet.

## The renderer (`src/render`)

- `gl.c`: a tiny loader (SDL's `GetProcAddress`), one shader (a colour per
  vertex, one light, the palette's sky and fog, an ordered 4 by 4 dither, a
  2D mode for the HUD), meshes, instancing (a matrix and a colour per
  instance). The model matrix rides in generic attributes, so one shader does
  both.
- `mesh.c`: the builder (cube, cylinder, sphere, tri), every chassis's parts
  ported from the reference's `mesh/mechParts.js` (legs by leg type, body by
  style, PURPLE PUNCHER's fists), the effect shapes, the terrain in 16
  chunks (coloured by height and slope), the sky dome, a wreck.
- `scene.c`: the cockpit camera (eye in the torso; kick, bob, shake, wobble,
  heat sway, squash, sag, the fall; the volley's nose camera), the world
  (chunks past the fog skipped), each mech posed from its planted feet with
  two-bone IK and the torso on its springs, the cockpit's own arms, debris,
  wrecks, shots and beams, particles instanced by shape, shockwaves dithered
  away, the jets' landing ring.
- `hud.c`: a 5 by 7 pixel font as quads, lines and arcs as quads; the ring
  (heat up the left, jets up the right, speed along the bottom, the damage
  diagram in the middle), the weapons by category, the radar, the crosshair,
  the target's brackets (a diamond on a lock, coloured by its torso), the
  compass, the messages, the dithered flashes.

## Invariants you must not break

- **Feet never slide.** A planted foot's world position is fixed until it
  lifts; swings land where the rest spot will be at touchdown. The gait
  clock is distance, not time. The test walks every chassis and checks it.
- **Ground queries match the mesh.** `terHeight` and `buildTerrainChunk` use
  the same triangle split. Mechs stand exactly on what is drawn.
- **Mechs are vertical cylinders** for hits, radius and height from the body
  plan. Sections are routed by height and lateral offset in torso space.
- **Melt belongs to the target.** Laser damage ramps on the target's `melt`,
  shared by every beam on it.
- **Heat 100 shuts the reactor down, 45 restarts it.** Shutdown halts
  movement and firing. The fusion cannon deliberately jumps heat to 140.
- **The sim never includes the platform.** `make lint` greps for it.
- **`dt` is a fixed 1/60.** Nothing may depend on frame count for timing
  (the tests step the same way).
- **Everything visible is a polygon.** No textures, no blending; fades are
  shrink, colour toward the fog, or the dither.
- **Balance numbers change only in issues about balance.**

## Tests

`make test` builds `test/*.c` with the sim and runs 830 checks: the data
merges, feet never slide (all six chassis), heat and shutdown, the melt, the
sections, the death beats, the autocannon, the shove by mass, the stomp, the
fusion discharge, the jets, the missiles' lock and guide, every feel row,
reduced motion, the AI's heat cap on each difficulty, line of sight, the
tone rules on every brief and voice line.
