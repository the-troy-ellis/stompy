# Architecture

A Rust workspace of two crates that only meet in `crates/game/src/app.rs`:

- **`stompy-sim`** (`crates/sim`): the simulation. Headless, deterministic,
  tested. It has **no dependencies at all**, so it cannot reach SDL, GL or
  audio by construction; the compiler enforces what a lint used to.
- **`stompy`** (`crates/game`): the game. The platform (SDL2: window, pad,
  audio, rumble), the renderer (OpenGL 3.3 through glow: flat polygons, the
  HUD), the screens and the loop.

Libraries: `sdl2` (with `hidapi`, for the Deck's gyro and trackpads) and
`glow` (OpenGL bindings). Both approved by the owner on 2026-11-10. Any other
library needs the owner's yes first (docs/README.md § Decisions).

```
deck/
  Cargo.toml            the workspace; cargo build, cargo test, cargo clippy, cargo fmt
  crates/
    sim/                stompy-sim: the simulation, no dependencies
      src/data/         every tuned number, ported from the reference's src/data; names.rs (display names, voice pools)
      tests/            sim.rs (the invariants and acceptance criteria), tone.rs (the tone guide)
    game/               stompy: the binary
  tools/shot.sh         a screenshot under a virtual screen, for boxes with no display
  docs/                 this plan
```

## The sim (`crates/sim/src`)

| File | Role |
|---|---|
| `game.rs` | Every state type: `Game` (the whole state), `Mech`, `Weapon`, `Shot`, particles, debris, wrecks, pulses, beams, messages; `Input` (the per-frame snapshot) and `Event` (what the sim asks the outside world to do). |
| `data/mod.rs` | The tables as typed statics: weapons, chassis, body plans and `geo_for`, gaits, melee, the feel table, jets, difficulty, AI tunables, palettes, weather, Act I. Keys are enums (`Ch`, `Wpn`, `Sec`, `Cat`...). |
| `data/names.rs` | Every display name and line of text: chassis, weapons, roles, missions, verdicts, the voice's pools, the warnings. |
| `math.rs`, `rng.rs`, `spring.rs` | `V3` and `M4` (column-major, OpenGL's layout), mulberry32, damped springs. |
| `terrain.rs` | The ground: a 96 by 96 grid of 24 m cells with value-noise heights and a flat zone round the start. `height` samples the same triangle split the mesh is built from. `ray` marches and bisects. |
| `state.rs` | `Game::new`, `new_mech` (the stock loadout, the AI, the feet, the springs), `start_mission`, `start_free_play`, palettes by time of day, the fog. |
| `update.rs` | One frame: the player's controls into the mech, the aim ray, the lock, the triggers by category, every mech's think and step, beams, collisions, objectives, shots, deaths, pulses, particles, debris, wrecks, the camera numbers' decay. |
| `geom.rs` | Frames, `muzzle_of`, `eye_of`, `center_of`, the upright-cylinder ray test, `ray_hit` (mechs then ground), `section_hit`, `lead_point`, line of sight. |
| `gait.rs` | Planted feet and the distance clock: the swing, the footfall, the pendulum body on its springs; `solve_knee` for the renderer. |
| `mech.rs` | `step_mech`: speed and the slope, the push and its decay, jets, gravity, the landing (dig-in, stomp), heat and the 100/45 shutdown, cooldowns, the springs, then the gait. |
| `feel.rs` | The body springs (squash, wobble, sag, inertia tilt), the camera bob, and `feel(g, event, ...)`: one call per event, one row of the table. |
| `combat.rs` | `damage` (sections, overflow to the torso, sparks, the clang, the AI's alert), `lose_section`, the death in beats, wrecks, `fire`, shells and bursts, volleys, `step_shots`. |
| `beams.rs` | Lasers: the target's melt (shared by every beam on it), the flamer's cone and heat, `cool_armour`. |
| `missiles.rs` | Tap to fire, hold to guide, let go to detonate; the blast's falloff and shove; `fire_cat`, `cycle_target`. |
| `fusion.rs` | The OOPS BUTTON: the scan (slack, grace, assist), the discharge (heat to 140, shutdown, feedback), the pulse that kills on arrival. |
| `melee.rs` | The punch (wind-up, hit frame, recovery), the stomp, `knock` (mass-scaled, with the aim jolt), the drawn pose. |
| `jets.rs` | Blast-off jets: charge, the lock and the aimed blast, the ring, the flight's steering and where it lands. |
| `ai.rs` | Perception (sight, the react delay, the shout, lost contact), the profiles (baseline, harass, line, skirmish, sniper, brawler) as drivers and shapers, fire discipline by difficulty, `think`. |
| `effects.rs` | Messages, the particle pool, debris, `hit_sparks`, `explode`, scorches. |
| `voice.rs` | The cockpit voice's pools: a seeded pick, no dry line twice, one a minute. |

### How the pieces talk

- **`Game` is the one state object.** Only the sim mutates it; the renderer
  and HUD read it; input writes nothing to it directly (it makes an `Input`).
- **Mechs are indices** (`MechId`) into `Game::mechs`, never references.
  The player is always index 0 (`PLAYER`), and a mech stays in the list for
  the whole match (the dead become wrecks), so an index is good for the match.
- **`Input`** (`controls.rs` → `update`): `thr`, `turn`, `twist`, `pitch`
  (-1..1 rates), `twist_by`, `pitch_by` (radians this frame, from the gyro
  and the mouse), the held triggers by category, and the presses.
- **`Event`s** are how the sim asks for anything outside itself: `Say` (a
  voice line, maybe delayed), `Sfx` (a sound, positioned or your own),
  `Thump` (the feel table's bass, duck and rumble columns), `FusionSound`.
  The sim pushes them onto `Game::events`; the app drains them every frame
  into the synthesiser, the HUD's messages and the pad's rumble. The tests
  read them.
- **The frame** (`app.rs`): poll the platform → map the raw state to an
  `Input` → `update` at a fixed 1/60 (up to four steps after a hitch, presses
  on the first only) → drain the events → the audio's loops follow the state
  → `Scene::render` → `draw_hud` → the screen on top → swap, with vsync.

### The data model

A **mech**: its chassis and body plan, team; position, `yaw` (the legs),
`twist` and `pitch` (the torso), `speed`, `throttle`, `heat`, `fuel`;
`hp` and `max` by section (`Sec::T`, `LA`, `RA`, `LL`, `RL`); its weapons;
the feet and the gait's clock and drawn body; the melt (the target's); the
fusion scan; the melee swing; the jets; the push and every spring; the AI.

**Weapons** have a kind (beam, shell, missile, fusion) and a category
(energy, ballistic, missile, fusion). Fire controls are by category. There
are no weapon groups by design.

**Chassis** hold speed, turn, sink, scale, the AI's range, accuracy and
profile, per-section hp, colours, the mechlab block (tons, frame, hardpoints
locked to categories, stock systems), fists, a body plan override, the unlock.

**Missions**: a biome, a seed, a time of day and weather, a ramp, the foes by
polar [bearing, distance] from the centre, the objective, the brief. Only
ELIMINATE is implemented.

## The game (`crates/game/src`)

| File | Role |
|---|---|
| `main.rs` | Arguments, then `App::new` and `run`. |
| `app.rs` | The settings file, the effects sink (events into sound, voice text and rumble), the screens, the fixed-step loop, the menu's turntable, the demo pilot and screenshots for the tools. |
| `platform.rs` | SDL: a 3.3 core context with vsync, the pad (hidapi for the Deck, so paddles, trackpad touch and the gyro come through), keyboard and mouse, rumble (the strongest buzz wins until it runs out). |
| `controls.rs` | `Raw` → `Input` and the menus' presses. Pure, with unit tests. The Deck layout is at its top. |
| `audio.rs` | The synthesiser in SDL's audio callback: oscillator and filtered-noise voices for the one-shots (the reference's recipes), the sub-bass thump through a soft clipper, the loops (hum, jets, servo, beam, sizzle, fusion scan) on a bus that ducks under impacts. No samples yet. |
| `gl.rs` | One shader through glow: a colour per vertex, one light, the palette's sky and fog, an ordered 4 by 4 dither, a 2D mode for the HUD. Meshes, instancing, screenshots. |
| `mesh.rs` | The builder (cube, cylinder, sphere, tri), every chassis's parts ported from the reference's `mesh/mechParts.js`, the effect shapes, the terrain in 16 chunks, the sky dome, the wrecks. |
| `scene.rs` | The cockpit camera (kick, bob, shake, wobble, heat sway, squash, sag, the fall; the volley's nose camera), the world, each mech posed from its planted feet by IK, the cockpit's own arms, debris, wrecks, shots, beams, particles instanced by shape, shockwaves dithered away, the jets' landing ring. |
| `hud.rs`, `font.rs` | A 5 by 7 pixel font as quads, lines and arcs as quads; the ring (heat, jets, speed, the damage diagram), the weapons by category, the radar, the crosshair, the target's brackets, the compass, the messages, the dithered flashes. |

## Invariants you must not break

- **Feet never slide.** A planted foot's world position is fixed until it
  lifts; swings land where the rest spot will be at touchdown. The gait
  clock is distance, not time. A test walks every chassis and checks it.
- **Ground queries match the mesh.** `Terrain::height` and
  `build_terrain_chunk` use the same triangle split.
- **Mechs are vertical cylinders** for hits. Sections are routed by height
  and lateral offset in torso space.
- **Melt belongs to the target**, shared by every beam on it.
- **Heat 100 shuts the reactor down, 45 restarts it.** The fusion cannon
  deliberately jumps heat to 140.
- **The sim has no dependencies.** Adding one to `crates/sim/Cargo.toml` is
  the one change that needs the most justification.
- **`dt` is a fixed 1/60.** Nothing depends on frame count for timing.
- **Everything visible is a polygon.** No textures, no blending; fades are
  shrink, colour toward the fog, or the dither.
- **Balance numbers change only in issues about balance.**

## Checks

```
cargo test --workspace                          # the sim's tests and the controls' tests
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cargo build --release                           # target/release/stompy
```

The sim's tests cover: the data merges and the tonnage budgets, feet never
sliding on all six chassis, the distance clock, heat and shutdown, the melt,
sections and sitting down, the death beats, the autocannon, the shove by
mass, the stomp, the fusion discharge and its slip, the jets, the missiles'
lock and guide, springs, every feel row, reduced motion, knockback's aim
jolt, the sag and overshoot, the AI's heat cap on each difficulty, line of
sight, the heavies' line, the harasser's flip, the punch on HARD, the
missions' starts, and the tone rules on every brief and voice line.
