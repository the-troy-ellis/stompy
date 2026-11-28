# Animation with personality

| | |
|---|---|
| Status | layer 1 built on BARRY (2026-11-28). Layers 2 and 3 next, on BARRY, then the others. **Deck check: open.** |
| Milestone | P1/P2 (the core's feel and the engine) |
| Depends on | `01-thunk.md` (the feel table), `02-look.md` (BARRY's model) |

## Summary

The owner (2026-11-27): make the animation more detailed and expressive, so
the mechs have personality. Three layers, BARRY first:

1. **The machine's own motion**, every mech: what any heavy machine does.
2. **States you can read from across the map**: shutdown, restart, hot,
   hurt, standing about.
3. **Personality**: each chassis its own versions of the same moves, and
   its habits. Proposed, for the owner to rewrite: BARRY steady and
   workmanlike; SKEDADDLE twitchy, bird-like; SLOWPOKE lumbering; PURPLE
   PUNCHER swagger and a boxer's bounce; LONG LARRY careful, its dish
   scanning; BIG TROUBLE scrappy and bouncy.

**All of it is drawn only.** Where a mech is, where its feet are, what it
hits and what the sim's springs do are unchanged; the invariants hold. It
lives in `crates/game/src/anim.rs`, with a profile per chassis; a chassis
without one draws as before.

## Layer 1 (built, BARRY)

- **Arms** swing against the leg on their own side (0.09 rad at full pace)
  and trail a torso turn on a spring.
- **Feet** roll a little in the air: toes down as one leaves the ground, toes
  up as it comes in heel first. Planted feet stay flat, where the sim put
  them.
- **Toes** (the owner, 2026-11-28: the feet looked like flippers; they should
  curl when they lift and plant when they land). Three toes of two segments
  each, hinged at knuckles on the front of the foot (`models::TOES`). As a
  foot lifts, the heel peels up and the toes stay on the ground; in the air
  they curl under and close together like a claw; before landing they open
  and reach; down, they spread and grip, then settle flat (`anim::toe_pose`).
- **Pistons** are live: the knee's runs from the back of the thigh to the
  back of the shin, the ankle's from the shin to the heel, each a fat
  cylinder and a rod that slides as the joint bends (`models::KNEE`,
  `ANKLE`). The models carry the lugs they hang from.
- **The antenna** is its own piece on a whippy spring, thrown by the
  torso's jolts sideways and fore and aft.
- **The pods** ride their own hinge on a stiffer spring: each footfall
  thumps them down and they settle, nodding.
- **Recoil**: the gun (or the pods) nearest the last shot's muzzle kicks
  back hard in 0.04 s and returns by 0.3 s, twice as far for a big gun; the
  arm rocks up a touch with it. The cockpit's own guns kick too.

Clips: `--watch` (or `--watch-from A`) films your own mech from outside,
`--record N K dir` saves the frames.

## Acceptance criteria

1. A kick is out in under three frames and home by a third of a second;
   toes curl in the air, reach before landing and lie flat down (tests:
   `anim::tests`).
2. BARRY's triangle budget still holds with the pods and antenna apart
   (test: `models::tests`).
3. Clips before and after, from the front and from behind, in the PR.
4. On the Deck: it reads as heavier and more alive, not busier. **Deck
   check: open.**
