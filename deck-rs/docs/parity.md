# Bringing features across from the browser version

The browser version (the rest of this repository) is **deprecated**
(2026-11-28) and kept as a reference: about 20,000 lines, 40 specs and a lot
of the owner's playtest notes. This game takes what a base builder needs from
it **one feature at a time, on purpose**. The aim isn't
a copy. Each feature comes across once, gets checked against what playing on
the Deck has taught us, and is kept, changed or dropped on the owner's call.

## How a feature comes across

1. **Read the old one.** Its spec in `../docs/specs/`, its code in `../src/`,
   its tests in `../test/`, and the issues and notes where the owner played it.
2. **Write the port spec** in `docs/specs/`, short, with three lists:
   - **Kept:** what comes over as it was, numbers included.
   - **Changed:** what the Deck, Rust or an earlier decision here makes
     better, each with a reason in one line.
   - **Ask:** the questions only the owner can answer.
3. **The owner answers the asks.** "Same as before" is always a fine answer.
   The answers go into the spec and the decision log below.
4. **Build it**, with the old headless tests ported to `cargo test` first, so
   whatever we keep behaves as it did.
5. **Merge, which puts it on the Deck.** The owner plays it and writes notes.
   Notes become tuning issues. The next feature waits for them (no new system
   before the last one has been played).

A feature is at parity when its port spec is marked shipped and the owner
has played it. "Changed" is still parity: the goal is the same game, made
better on the way, not the same code.

## Where things stand

| Area | Browser version | Rust | Phase |
|---|---|---|---|
| Walking, torso twist, feet that never slide, gaits by body plan | specs 13, 16 | **ported** | P1 (tune) |
| Heat, sections, the four weapon kinds, OOPS BUTTON, missile locks | spec 06 | **ported** | P1 (tune) |
| Punch, shove, stomp; blast-off jets, the insta-stomp | specs 12, 26 | **ported** | P1 (tune) |
| AI profiles and three difficulties | spec 05 | **ported** | P1 (tune) |
| Thunk: feel table, camera, body, sub-bass, rumble | spec 13 | **ported**, not yet tuned on the Deck | P1 |
| Six combat chassis, eleven weapons | spec 06 | **ported** | P1 |
| Free Play; Act I missions 1 and 4 | spec 04 | **ported** | P1 |
| Debug page, test range, cheats, live tuning | spec 19 | a debug overlay (F3) | P1 |
| Structures: things in the world to shoot, punch and topple | spec 03 | data only | P2 |
| Trucks, waves; DESTROY, ESCORT, SURVIVE, EXTRACT | spec 03 | data only | campaign |
| Act I missions 2 and 3; the silent tutorial | specs 04, 11 | not yet | campaign |
| Mechlab-lite (FIT) | spec 02 | not yet | P3 |
| Night, headlights, weather, props, explosions' extras | spec 07 | palettes, weather keys, no drawing | P5 |
| Ambience, CC0 samples, a recorded cockpit voice | spec 07 | synthesis only | campaign |
| The glacier, volcanic plain and forest; Acts II and III; contracts | specs 04, 39 | palettes only | campaign |
| Voxel ground: canyons, caves, craters, falling ground, on a 4 m grid | specs 18, 27, 29 | not yet (heightfield) | P2 |
| Bigger maps and big fights (memory and cost that scale) | specs 34, 35 | not yet | P2 |
| The AI in canyons, caves and tunnels | spec 18 | not yet | P3 |
| Digging: BIG SCOOPER, hold to dig, dig up, dig feel | specs 20, 25, 28, 30 | not yet | P3 |
| The base: silo, factory, crew and SWAP, raids, salvage | spec 20 | not yet | P3 |
| Command view, orders, sites, the builder | specs 22, 23, 31 | not yet | P4 |
| Base loop, production, territory, stealing, tunnelling | specs 32, 33, 37 | not yet | P4 |
| Buildings and the city; the forest's toppling trees | specs 36, 38, 39 | not yet | P5 |
| Mission editor | spec 15 | not yet | **owner decides** |
| LAN arena, co-op, internet play | specs 08, 09, 10 | not yet | **owner decides** |
| Phones, portrait cockpit, touch, PWA, app store | specs 11, 17, 24 | not planned | out |

## The phases

**The gameplay core and the engine first; the campaign later** (the owner,
2026-11-27). Until the campaign, new things are played in Free Play and the
test range, so the test range comes first. Each phase starts with its asks
and ends with the owner playing it on the Deck.

- **P1: Play the core, tune it.** The debug page grows a test range (a flat
  field or a canyon, the foes you pick), cheats, live FEEL tuning and a
  frame-time readout, since every later playtest uses them. Then the Deck
  playtest (`roadmap.md` § M1) and the tuning it asks for.
- **P2: The engine, built for a base builder's crowds.** The owner
  (2026-11-28): eight mechs is not enough.
  - **Big battles** ([specs/04-big-battles.md](specs/04-big-battles.md)).
    Sides now fight sides, and the crowd test measures two armies: 256
    mechs cost about 1 ms a frame, 512 about 2.6 ms, 1,024 about 9 ms on
    the build machine. Drawing is the real limit (about 35 draws a
    detailed mech): batches and less detail far away come next, then a
    battle in the game with a readout, so the number is picked on the
    Deck.
  - **Voxel ground** on a 4 m grid: chunks meshed off the main thread, 3D
    ground questions for feet, shots and sight, craters, falling ground,
    sized for big maps from the start (in the browser version these came as
    three rewrites).
  - **Structures** as a general thing in the world that can be shot, punched
    and toppled.
- **P3: The base builder, by hand.** The AI in canyons and caves, then the
  loop: BIG SCOOPER and digging, the base, the crew and SWAP, raids (spec
  20's smallest loop, in Free Play), mechlab-lite.
- **P4: The base builder, from above.** Command view, the builder, the base
  loop, production, tunnelling.
- **P5: The world.** Buildings and the city, the forest, night and
  headlights, weather, props, explosions' extras.
- **Later: the campaign.** Trucks, waves and the objective types, the
  silent tutorial, the missions of Acts I to III, contracts, ambience and the
  recorded voice.

The editor and multiplayer slot in wherever the owner wants them, or
nowhere.

## Decision log

Choices that differ from the browser version, and why. Add a row whenever a
port spec's "Changed" list is approved.

| Date | What | Browser version | Here | Why |
|---|---|---|---|---|
| 2026-11-10 | Platform | web, phones, desktop | the Steam Deck (mouse and keyboard second) | the game's home is the Deck |
| 2026-11-10 | Weapon groups | none (one control per kind) | the same | kept on purpose |
| 2026-11-27 | The look | smooth shading, a PIXELS setting (240 lines) | an ordered dither onto a ramp per place and time; full-resolution edges; DITHER in SETTINGS (off, fine, chunky, chunkier), chunky by default | the owner: dithering is the style, more distinct palettes |
| 2026-11-27 | Order | the campaign before the second arm | the core and the engine first, the campaign later | the owner's call: get the game's core and engine right first |
| 2026-11-28 | The browser version | the game | deprecated: a reference for specs, code and numbers, never changed | the owner |
| 2026-11-28 | What Stompy is | a mech sim; construction later, if it earned it | a mech base builder; construction is the heart of it | the owner |
| 2026-11-28 | Mechs on a map | up to about 20 (MAX_MECHS 24) | the sim allows 256; the playable number is what the Deck holds at 60 | the owner: eight is not enough |
| 2026-11-27 | Rust version | (n/a) | pinned in `rust-toolchain.toml` | fmt and clippy don't drift between builds |
