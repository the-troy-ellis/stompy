# The plan: the order of work, and what comes across

Stompy is a base builder in a world of robots (`world.md`): demigods (the
mechs) fight demigods, cities of tiny robots gather ore and get stomped,
temples are the factories that make demigods. This is the order it gets
built in.

The browser version (the rest of this repository) is **deprecated**
(2026-11-28) and kept as a reference: about 20,000 lines, 40 specs and a lot
of the owner's playtest notes. This game takes what it needs from it **one
feature at a time, on purpose**. The aim isn't
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
| Walking, torso twist, feet that never slide, gaits by body plan | specs 13, 16 | **built** | P1 (tune) |
| Heat, sections, the four weapon kinds, OOPS BUTTON, missile locks | spec 06 | **built** | P1 (tune) |
| Punch, shove, stomp; blast-off jets, the insta-stomp | specs 12, 26 | **built** | P1 (tune) |
| AI profiles, three difficulties; sides fight sides | spec 05 | **built** | P1 (tune) |
| Thunk: feel table, camera, body, sub-bass, rumble | spec 13 | **built**, not yet tuned on the Deck | P1 |
| Six combat demigods, eleven weapons | spec 06 | **built** | P1 |
| The look: dither, ramps, side paint, lumps for effects | spec 14 | **built** (specs/02-look.md) | P3 (more) |
| BARRY remodelled and animated (layer 1, toes, pods); SKEDADDLE and PURPLE PUNCHER remodelled and animated | (new) | **built** (specs/02-look.md, 03-anim.md) | P3 (the other three) |
| Big battles: batches, distance detail, readout, WATCH | spec 34 | **built**, the number to measure on the Deck (specs/04-big-battles.md) | P2 |
| Debug page, test range, cheats, live tuning | spec 19 | a readout (View + Y) | P1 |
| The crowd: tiny robots by the thousand, honoured underfoot | (new) | not yet | P2 |
| Voxel ground: canyons, caves, craters (big weapons and diggers only), falling ground | specs 18, 27, 29 | not yet (heightfield) | P2 |
| Bigger maps | spec 35 | not yet | P2 |
| Buildings at two scales: the tiny robots' (stompable) and the demigods' (temples, dead towers) | specs 36, 38 | not yet | P2 |
| Cockpits: each demigod's head, from inside, in 3D | spec 17 (portrait, parked) | **BARRY's built** (specs/05-cockpit.md) | P3 (the other five) |
| Digging: BIG SCOOPER, hold to dig, dig up, dig feel | specs 20, 25, 28, 30 | not yet | P4 |
| Tiny robots gathering ore and carrying it home | (the hauler, spec 20) | not yet | P4 |
| The builder demigod and its buildings, which make tiny robots | specs 23, 31, 36 | not yet | P4 |
| The temple: a factory making demigods from ore and salvage | specs 20, 33 | not yet | P4 |
| Descending into any of your demigods (was SWAP) | spec 20 | not yet | P4 |
| The god above: command view, orders | specs 22, 32 | not yet | P5 |
| Rival cities running the same loop; raids on temples; salvage | specs 20, 32, 33 | not yet | P5 |
| Tunnelling, territory, stealing | specs 33, 37 | not yet | P5 |
| The places: desert, glacier, volcanic plain, forest; the dead cities, relics | specs 07, 38, 39 | palettes only | P6 |
| Night, headlights, weather (sprites considered), props | spec 07 | weather keys, no drawing | P6 |
| Mechlab-lite (FIT) | spec 02 | not yet | owner decides (P4 or later) |
| Campaign: missions, objectives, tutorial, acts | specs 03, 04, 11 | Act I missions 1 and 4 (old) | later, rethought for this world |
| Ambience, CC0 samples, the voice (deadpan, and the rite) | spec 07 | synthesis only | later |
| Mission editor | spec 15 | not yet | **owner decides** |
| LAN arena, co-op, internet play | specs 08, 09, 10 | not yet | **owner decides** |
| Phones, portrait cockpit, touch, PWA, app store | specs 11, 17, 24 | not planned | out |

## The phases

The world first decides what the engine must carry: **many giants, a crowd
of thousands, ground that is dug, buildings at two scales**. So the engine
comes before the base builder's loop, and the loop before the wider world.
Each phase starts with its asks and ends with the owner playing it on the
Deck; no new system before the last one has been played.

- **P1: Play and tune** (ongoing). The owner's notes from the Deck, bug 3
  (feet sink too far), the battle numbers (16, 32, 64, 128 a side, from
  the readout), then the tuning they ask for. A test range and live FEEL
  tuning on the debug page when the tuning needs them.
- **P2: The engine for this world.**
  1. **Big battles** (built): measure on the Deck, then part 4 (a grid of
     the mechs, far ones thinking less often) if the number wants more.
  2. **The crowd**: tiny robots as simple agents, not mechs, drawn in
     batches from a few shapes, thousands of them. They cheer and kneel for
     their own demigods, scatter from the other city's, and are squished
     back into ore underfoot with a crunch you feel. Measured like the
     battles.
  3. **Voxel ground** on a 4 m grid: sight through the grid, a top-surface
     height map for feet, chunks remeshed off the sim's core, craters from
     big weapons and diggers only, falling ground capped a frame, memory
     that follows what was dug. Sized for big maps from the start.
  4. **Buildings at two scales**: the tiny robots' (a storey a little over
     a tiny robot; a demigod stands three storeys over them, steps on them,
     knocks them down) and the demigods' (temples; the dead cities' towers,
     8 m storeys).
- **P3: The demigods' look and feel** (alongside P2, piece by piece as the
  owner wants). Each demigod's **cockpit as its head, from inside, in 3D**
  (BARRY first, from the mockups' window shapes); animation layers 2 and 3
  on BARRY (states, then personality); then the other five remodelled and
  animated; their trim colours.
- **P4: The loop, by hand** (in Free Play, a city to grow). BIG SCOOPER
  digs and reveals ore; tiny robots gather it and carry it home; the
  builder demigod raises buildings; buildings make tiny robots; the temple
  turns ore and salvage into demigods on a line you can watch; you descend
  into any of your demigods. Honour costs: every squished gatherer is ore
  you won't get.
- **P5: The god above.** The command view (your city from above, orders to
  demigods, where the builder builds), rival cities running the same loop,
  raids on temples, salvage hauled from battlefields; then tunnelling and
  territory.
- **P6: The world.** The four places with their own ore and hazards; the
  dead cities (demigod-scale ruins: salvage, cover, relics that teach the
  temple new demigods); night and weather; statues, shrines and murals.
- **Later: the campaign**, rethought for this world, with the ambience and
  the voice (deadpan, and the rite: "Ore to ore." "Smelt me into thy
  image.").

The editor, multiplayer and mechlab slot in wherever the owner wants them,
or nowhere.

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
| 2026-11-28 | Paint | a colour per chassis | a colour per side: yours slate blue, theirs mustard (specs/02-look.md) | the owner: chassis colours indicate teams |
| 2026-11-28 | Craters | most hits dig (BIG BOOMER 2.5 m, every missile of a volley) | only big weapons and diggers dig; the rest scorch (specs/04-big-battles.md) | the owner: big battles on deformable ground |
| 2026-11-28 | Mechs on a map | up to about 20 (MAX_MECHS 24) | the sim allows 256; the playable number is what the Deck holds at 60 | the owner: eight is not enough |
| 2026-11-28 | The world | (none: a mech sim) | robots, no humans; demigods (the mechs) fight demigods; cities of tiny robots gather ore and are stomped (an honour, at a cost); temples are factories (world.md) | the owner |
| 2026-11-28 | The order | P2 engine, P3 base builder by hand, P4 from above, P5 world | P2 engine for this world (battles, crowd, voxel ground, two-scale buildings), P3 the demigods' look and feel, P4 the loop by hand, P5 the god above, P6 the world | the world sets what the engine must carry |
| 2026-11-28 | Throttle and twist | the throttle is a setting the stick nudges; the torso stays twisted | the stick is the throttle (back to zero when let go); walking forward, a torso left alone swings back over the legs (docs/controls.md) | the owner |
| 2026-11-28 | Punching | everyone shoves, PURPLE PUNCHER punches | only PURPLE PUNCHER punches; everyone stomps (specs/00-core.md) | the owner: punching is a mechanic unique to PURPLE PUNCHER |
| 2026-11-27 | Rust version | (n/a) | pinned in `rust-toolchain.toml` | fmt and clippy don't drift between builds |
