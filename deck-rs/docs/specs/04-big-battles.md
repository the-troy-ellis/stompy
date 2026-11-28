# Big battles

| | |
|---|---|
| Status | part 1 built (2026-11-28): sides fight sides, the battle setup, the sim measured. Parts 2 to 4 next. **Deck check: open.** |
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
2. **Drawn in batches, with less detail far away.** Every part of every
   mech of a kind in one instanced draw; level 2 near, level 1 in the
   middle distance, the box model far, and past that a single shape. The
   drawn-only animation (anim.rs) near only.
3. **A battle in the game, with a readout.** Free Play gets a BATTLE with
   ALLIES and FOES up to the cap, and F3 shows mechs, sim ms, draw ms,
   draws and triangles. The owner runs it on the Deck at 64, 128, 256 and
   up; that table picks the number.
4. **The sim past 500**, if the number wants it: a grid of the mechs for
   the every-against-every checks, far mechs thinking less often, shots
   and particles capped.

Unit types (the owner: still to be decided) change the sums: a small cheap
unit can be many, a big one fewer. The table above is per mech of today's
kinds.

## Acceptance criteria

1. Two armies fight each other (test: `two_armies_fight_each_other_not_just_the_player`).
2. The crowd test runs and prints the table (`--ignored`).
3. On the Deck: the number of mechs at which 60 still holds in a battle,
   recorded here. **Deck check: open.**
