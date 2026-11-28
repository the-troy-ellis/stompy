# Big battles

| | |
|---|---|
| Status | parts 1 to 3 built (2026-11-28): sides fight sides, drawing in batches with less detail far off, a battle in Free Play with a readout. Part 4 if the Deck's numbers want it. **Deck check: open: the owner's table below.** |
| Milestone | P2, the engine (`../parity.md`) |
| Depends on | the browser version's `specs/34-big-fights.md` and `35-bigger-maps.md` for what it learned |

## Summary

The owner (2026-11-28): Stompy is a base builder, and the battles should be
very large; eight mechs is not enough. Unit types are to come. This spec
finds out what the Deck can really hold, then builds the engine to hold it.
The number is picked from measurements on the Deck, not guessed.

## What it costs: the sim (measured)

`tests/crowd.rs`: two armies of the Free Play mix on flat ground, 20 s in
(the blocks have closed and everyone is fighting), then 5 s timed. On the
build machine (a 2.1 GHz Xeon core, about the Deck's single core or a little
slower), release build:

| mechs | still alive | ms a frame, mean | worst |
|---|---|---|---|
| 64 | 51 | 0.21 | 0.46 |
| 128 | 98 | 0.53 | 1.0 |
| 256 | 200 | 0.92 to 1.1 | 1.5 to 2.1 |
| 512 | 455 | 2.6 | 4.1 |
| 1024 | 949 | 8.7 | 22.5 |

A frame is 16.7 ms. Up to about 500 the sim is comfortable. Past it, the
parts that check every mech against every other (finding a target, keeping
off allies, finding a punch's target) dominate: twice the mechs, three times
the cost.

## What it costs: drawing (to measure)

The bigger limit today. A detailed BARRY is about 35 draws (hip, torso,
pods, antenna, arms, guns, legs, toes, pistons); a box model about 15. A few
thousand draws a frame is the most the Deck's driver will take at 60, so
draws, not triangles, cap the crowd near a hundred. Triangles come next:
BARRY at level 2 is 9,200.

## Parts

1. **Sides fight sides** (built). Every AI mech has a target: the nearest
   enemy it can see (sight lines checked nearest first, three at most), or
   whoever last hit it. Allies of the player think too. With only the
   player on the other side it behaves exactly as before (the 30 sim tests
   hold). `start_battle`: you and your allies in a block, theirs in a block
   700 m off, everyone aware. The cap is 256 (was 24). Test: two armies
   lose mechs to each other, not to the player.
2. **Drawn in batches, with less detail far away** (built). A frame's
   mechs, wrecks, debris, pistons, shots, beams, flashes and shockwaves are
   gathered by shape and each shape goes out in one instanced draw. Past
   120 m a mech is drawn with its plain model and no drawn-only motion.
   Frames before and after match pixel for pixel. In a 128-mech battle 22 s
   in (103 standing, 254 shots in flight): **2,216 draws before, 138
   after**; triangles 569,000 before, 488,000 after.
3. **A battle in the game, with a readout** (built). Free Play has ALLIES
   (0 to 127) and ENEMIES (1 to 8, then 16 to 128); any allies, or more
   than eight enemies, is a battle (`start_battle`). The debug readout
   (View held + Y, or F3) adds mechs alive, the sim's and the 3D drawing's
   ms a frame (CPU side) and triangles. `--battle A F` for tools runs. The
   cockpit voice reports only your kills. **VIEW: WATCH** (the owner,
   2026-11-28) watches the battle instead of fighting in it: a free camera
   (`freecam.rs`, the controls in `controls.md`) that starts behind your
   side looking at theirs; your mech is parked off the field and nobody
   targets it (`state::spectate`), and the battle ends when either side is
   gone (test). With no allies chosen, WATCH gives you as many as the
   enemies. The owner runs it on the Deck and fills in the table below; it
   picks the number.
   
   | allies + enemies | fps | sim ms | draw ms | draws | triangles |
   |---|---|---|---|---|---|
   | 16 + 16 | | | | | |
   | 32 + 32 | | | | | |
   | 64 + 64 | | | | | |
   | 127 + 128 | | | | | |
4. **The sim past 500**, if the number wants it: a grid of the mechs for
   the every-against-every checks, far mechs thinking less often, shots
   and particles capped.

### With deformable ground

The voxel ground (P2, after this) is built against these battles, not
retrofitted: sight lines step through the 4 m grid and stop at the first
solid cell, a top-surface height map serves feet and movement and is redone
only where the ground changed, chunks are remeshed off the sim's core a few
a frame nearest first, routes are shared by everyone going the same way,
falling-ground checks are capped a frame, and memory follows what was dug.
Its budget: the ground's work under about 3 ms a frame in a 300-mech battle
with craters, checked by the crowd test on dug ground.

**Only big weapons and diggers make craters** (the owner, 2026-11-28).
Everything else scorches. Proposed from the browser version's approved
table (its `src/data/weapons.js`, `dig` and `DIG`), for the owner to adjust:

| digs | radius |
|---|---|
| OOPS BUTTON | 6 m |
| ANGRY ZAPPER | 4 m |
| BIG BONKER | 3.5 m |
| a mech's death blast | 5 m by its size, up to 7 |
| a wreck's ammunition cooking off | 7 m |
| diggers (construction gear) | 8 to 16 m |

Scorch only: BIG BOOMER, FIRECRACKERS, ANGRY BEES, the lasers, RATATAT,
TOASTER, and a guided volley set off by hand (it dug 4 m in the browser
version).

**Giants fight giants; tiny robots are the crowd** (the owner, 2026-11-28,
`../world.md`). The numbers above are the demigods. The tiny robots are a
separate crowd, not mechs: simple agents that carry, cheer and scatter,
drawn in batches with a few shapes, thousands of them cheap, measured on
their own.

Unit types (the owner: still to be decided) change the sums: a small cheap
unit can be many, a big one fewer. The table above is per mech of today's
kinds.

## Acceptance criteria

1. Two armies fight each other (test: `two_armies_fight_each_other_not_just_the_player`).
2. The crowd test runs and prints the table (`--ignored`).
3. On the Deck: the number of mechs at which 60 still holds in a battle,
   recorded here. **Deck check: open.**
