# The cockpit: the demigod's head, from inside

| | |
|---|---|
| Status | BARRY's built (2026-11-28). The other five next, from the mockups' window shapes. **Deck check: open.** |
| Milestone | P3, the demigods' look and feel (`../parity.md`) |
| Depends on | `../world.md` (robots: there is no pilot), `02-look.md`, `03-anim.md` |

## Summary

The owner (2026-11-28): the cockpits need to be 3D, unique, with personality.
In this world there is no pilot (`world.md`): you see through the demigod's
own eye, so the cockpit is its **head, from inside**. Each demigod's is its
own; the mockups (window shapes for all six) came first.

## Design

- **Built in the view's own space** (`crates/game/src/cockpit.rs`): x to
  the left, y up, z ahead, in metres from the eye, a right-handed frame so
  faces keep their winding. Drawn with the camera after everything else, so
  every kick, bob, shake and lurch moves it with you; lit by the world's
  light in dithered steps like any machine; no fog.
- **No instruments.** The owner (2026-11-28): the first try's dials and
  lamps were a pilot's, and there is no pilot. The head shows its state
  through its own workings (the green HUD is already the robot's readout):
- **BARRY**: a porthole eye (an oval 0.88 by 0.5 at a metre) with a lip, a
  raised faceted ring and 24 rivets, the panel round it dished in toward
  the eye past the screen's edge.
- **Eyelids**: steel shutters top and bottom with a rolled lip, ribs and a
  piston, sliding just behind the ring. They rest almost open, squint as
  the heat climbs past 55, slam shut when the machine shuts down (or dies),
  and flinch half-closed for a moment when the torso is hit.
- **Heat coils**: a row of fins across the bottom of the eye: cold steel,
  then dull red, orange, and near white at shutdown, flickering when
  critical, with puffs of steam rising and thinning out. Shut down, they
  cool to a dull red.
- **Jet capacitors**: two cages of thin bars in the frame's upper corners,
  outside the eye, each filling with a column of light as the jets
  recharge, humming bright when ready, dark when off.
- **Cracks** spread across the eye in three stages as the torso drops below
  three quarters, a half and a quarter.
- **The maintenance tag** the tiny robots tied on, in BARRY's accent, on
  three links of chain from a hook at the top of the eye. It swings on two
  springs, pushed by the head's jolts (sideways, fore and aft), by its turns
  and tips (the head rotates under the hook), and a little by each
  footfall's drop.
- The cockpit's own arms (bug 2's fix) still reach in from the lower
  corners and fire from their tips; the eye was sized so they show.
- The green HUD stays on top of it all.

## The rest (next)

From the mockups, each as its own head: SKEDADDLE's beak slit and jittery
lamps, SLOWPOKE's wide glass between pillars and its pendulum weight, BIG
TROUBLE's cramped eye and patched plates, LONG LARRY's tall visor and the
scope that drops when you zoom, PURPLE PUNCHER's letterbox and the little
punching bag that swings when you punch. Props are robot things, not a
pilot's.

## Acceptance criteria

1. The lids rest open, squint when hot and shut when off; the coils run
   from cold steel through red and orange to near white (tests:
   `cockpit::tests`).
2. Screenshots of the five states (`--cockpit-pose 0` to `4`: cool, hot,
   critical, shut down, hurt) and a walking clip in the PR.
3. On the Deck: it feels like being inside BARRY, and the view is not
   cramped. **Deck check: open.**
