# Parity with the browser version

The browser version (the rest of this repository) is the reference: about
20,000 lines, 40 specs and a lot of the owner's playtest notes. This rebuild
reaches parity with it **one feature at a time, on purpose**. The aim isn't
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
| Structures, trucks, waves; DESTROY, ESCORT, SURVIVE, EXTRACT | spec 03 | data only | P2 |
| Act I missions 2 and 3; the silent tutorial | specs 04, 11 | not yet | P2 |
| Mechlab-lite (FIT) | spec 02 | not yet | P2 |
| Night, headlights, weather, props, ambience, explosions' extras | spec 07 | palettes, weather keys, no drawing | P3 |
| The glacier, volcanic plain and forest; Acts II and III; contracts | specs 04, 39 | palettes only | P3 |
| Voxel ground: canyons, caves, craters, falling ground, on a 4 m grid | specs 18, 27, 29 | not yet (heightfield) | P4 |
| Bigger maps and big fights (memory and cost that scale) | specs 34, 35 | not yet | P4 |
| Digging: BIG SCOOPER, hold to dig, dig up, dig feel | specs 20, 25, 28, 30 | not yet | P5 |
| The base: silo, factory, crew and SWAP, raids, salvage | spec 20 | not yet | P5 |
| Command view, orders, sites, the builder | specs 22, 23, 31 | not yet | P6 |
| Base loop, production, territory, stealing, tunnelling | specs 32, 33, 37 | not yet | P6 |
| Buildings and the city; the forest's toppling trees | specs 36, 38, 39 | not yet | P7 |
| Mission editor | spec 15 | not yet | **owner decides** |
| LAN arena, co-op, internet play | specs 08, 09, 10 | not yet | **owner decides** |
| Phones, portrait cockpit, touch, PWA, app store | specs 11, 17, 24 | not planned | out |

## The phases

Each phase starts with its asks and ends with the owner playing it on the
Deck. The order follows dependencies and keeps the game a good fighting game
at every step. The big systems (voxel ground, then construction) come after
the fighting game is whole, because they change what the fighting game's
ground and missions are.

- **P1: Play the core, tune it.** The Deck playtest (`roadmap.md` § M1), then
  the tuning it asks for. The debug page grows a test range and live FEEL
  tuning first, since every later playtest uses them.
- **P2: Act I whole.** Entities and objectives, missions 2 and 3, the silent
  tutorial, mechlab-lite.
- **P3: The campaign whole.** Night, weather, props, ambience, the other
  three biomes, Acts II and III, contracts.
- **P4: The ground.** Voxel ground on a 4 m grid, built for bigger maps and
  big fights from the start rather than retrofitted (in the browser version
  these came as three rewrites).
- **P5: The second arm, by hand.** BIG SCOOPER and digging, the base, the
  crew and SWAP, raids: spec 20's smallest loop.
- **P6: The second arm, from above.** Command view, the builder, the base
  loop, production, tunnelling.
- **P7: The world.** Buildings and the city, the forest's falling trees.

The editor and multiplayer slot in wherever the owner wants them, or
nowhere.

## Decision log

Choices that differ from the browser version, and why. Add a row whenever a
port spec's "Changed" list is approved.

| Date | What | Browser version | Here | Why |
|---|---|---|---|---|
| 2026-11-10 | Platform | web, phones, desktop | the Steam Deck (mouse and keyboard second) | the game's home is the Deck |
| 2026-11-10 | Weapon groups | none (one control per kind) | the same | kept on purpose |
| 2026-11-27 | Rust version | (n/a) | pinned in `rust-toolchain.toml` | fmt and clippy don't drift between builds |
