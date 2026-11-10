# Thunk: what Stompy feels like

| | |
|---|---|
| Status | shipped for M0 (the table, the springs, every event wired); M1 tunes it on the Deck |
| Milestone | M0, then every milestone adds rows |

## Summary

The top pillar made concrete: one table of feedback tunables (`FEEL` in
`crates/sim/src/data/mod.rs`), one spring helper (`crates/sim/src/spring.rs`), and a pass over
every action and impact so that each has a camera response, a body response,
a sound with low end and a buzz in the hands. The numbers are the reference's.

## The table

One row per event; columns, each multiplied by the event's intensity `k`:

| Column | What it moves |
|---|---|
| kick | the eye drops at once (`G->kick`, the max of the current value) |
| bob | the same drop through two critically damped springs in series: eases in, dips, comes back; footsteps use it so a quick cadence reads as a sway, not a judder |
| shake | camera jitter, added, capped |
| flash | the red damage sheet (dithered, never blended) |
| white | the white-out (the fusion discharge) |
| squash | the body's scale pulse on a spring (y down, xz up) |
| wobble | the torso's angular spring, pitch and roll (`roll` leans it toward the blow) |
| bass | the sub-bass thump's weight: heavier is lower, longer, louder |
| duck | how far the loops dip for a moment |
| dust | the particle burst multiplier |
| haptic | the pad's rumble, in milliseconds |
| push | a horizontal impulse on the mech (recoil, knockback), decaying over about a second |

Rows: step (k = 0.35 + 0.65 × pace, × scale²), nearStep (a heavy's footfall
felt through the ground within 40 m), blastoff, land (k = the landing force),
fireAc, fireGauss, fireMg, fireBolt, bolt, fireLrm, hit (k = damage / 10 by
section: legs 1.2, torso 1, arms 0.7), shutdown (the sag), restart (the
overshoot), sectionLost, death, explosion (by distance), punch, punched,
stomp, whiff, blast (the push), fusionFire.

## The rumble

`App::events` in `crates/game/src/app.rs`: the low motor from the bass column, the high
motor from the haptic column, for the haptic column's milliseconds; the
strongest buzz in progress wins until it runs out. Charging the jets hums the
pad. REDUCED MOTION turns the haptic column off and scales the camera
columns to 30%; the mech still wobbles.

## The pass, action by action (as built)

- **Footfalls.** The bob and the bass, scaled by scale²; dust at the foot in
  the ground's colour; a heavy's steps felt within 40 m (`nearStep`).
- **Landing.** Squash and a ring of dust; the landing digs the feet in (the
  speed drops, the legs hold for a beat).
- **Recoil.** BIG BOOMER and BIG BONKER rock the torso back and nudge the
  mech; BIG BONKER rocks any shooter a step back.
- **Hits taken.** The wobble spring toward the blow; the section's clang
  (arms ring, legs thud, the torso is dull); beams sizzle instead of jolting.
- **Knockback.** Mass-scaled (scale³); the feet shuffle because the gait is
  distance-driven; dust streaks while the push is strong; the aim jolts.
- **Shutdown.** The hips sag 0.4 m, the HUD goes dark, the power-down whine,
  the voice. The restart snaps up with an overshoot.
- **Section loss.** The part comes off as debris (an arm whole; a leg as
  thigh, shin and foot); one leg gone leans 8° and limps; both gone sits the
  mech down, still firing.
- **Death.** A quarter-second beat with a rising whine, the torso blows (arms
  and plates fly), the legs buckle, the body topples over 0.8 s, then a
  wreck that pops and burns. The player's eye goes down with it.
- **Punch and stomp.** The wind-up pose, the crunch, the shove, the camera
  kick on both ends; a stomp from a high blast-off is an insta-stomp.

## Acceptance criteria

1. Every row is wired: a hit on the player changes kick, shake, flash and
   the wobble spring by the table's numbers (test).
2. Springs converge: no NaN, no runaway, settled within 2 s for any kick
   under 3 (test).
3. A mech with both legs destroyed sits and keeps firing; one leg gone limps
   (test).
4. Death has the beat: 0.25 s between the torso at zero and the blast (test).
5. REDUCED MOTION cuts the camera columns to 30% and the haptics to nothing
   (test).
6. The Deck playtest: three words, two of them heavy, chunky, thunky or
   satisfying or their synonyms.
