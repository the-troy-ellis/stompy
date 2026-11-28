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
  piston, sliding just behind the ring. Each is two plates hinged at their
  outer ends, so the lids make shapes. The owner (2026-11-28): the giant
  eye means every demigod is a cyclops, and the eyelid can be expressive.
  The face, by priority:

  | Face | Lids | When |
  |---|---|---|
  | Surprised | wide open for 0.3 s, then a hard flinch | a big hit (4% of the whole machine in a frame) |
  | Pleased | the bottom lid rises in an arch, an eye that smiles | 0.5 to 3.5 s after the player's kill: the joke after the fact |
  | Glare | a V, inner ends down | firing in the last 1.2 s, or zoomed in |
  | Worried | tented, outer ends low | the torso under 30% |
  | Locked | a milder V | a target locked |
  | Sleepy | a heavy droop | nothing touched for 8 s |
  | Relaxed | a little droop | otherwise |

  Over every face the heat squints the eye as it climbs past 55; shut down
  (or dead), the lids slam shut flat. A small hit flinches the lids for a
  moment. The faces move on springs, and are kept gentle (the owner,
  2026-11-28: some blocked the view too much). **No face covers the
  middle of the view**: the lips stay 0.24 clear of it however hot, so a
  glare flattens as the heat squints the eye rather than closing over what
  it glares at (test). A V or an arch turns each half about its outer end;
  a tent turns it about the middle.
- **The blink is an aperture**, not a human blink (the owner liked the
  blink, and asked for it more like an aperture): every 2.5 to 6.5 s both
  lids snap to the middle in 0.05 s, outer ends leading, so the eye closes
  as a shrinking diamond; it holds a moment and opens over 0.1 s. Slanted
  tails on the plates cover the middle as the halves tent.
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
  six links of chain from a hook at the top of the eye, outside the
  eyelids, so they close over it (it never swings in far enough to touch
  them). It swings on two
  springs, pushed by the head's jolts (sideways, fore and aft), by its turns
  and tips (the head rotates under the hook), and a little by each
  footfall's drop.
- The cockpit's own arms (bug 2's fix) still reach in from the lower
  corners and fire from their tips; the eye was sized so they show. Only
  the guns (or fists) are drawn from inside: the shoulder drums and upper
  arms floated in view (the owner, 2026-11-28).
- The green HUD stays on top of it all.

## The rest (next)

From the mockups, each as its own head: SKEDADDLE's beak slit and jittery
lamps, SLOWPOKE's wide glass between pillars and its pendulum weight, BIG
TROUBLE's cramped eye and patched plates, LONG LARRY's tall visor and the
scope that drops when you zoom, PURPLE PUNCHER's letterbox and the little
punching bag that swings when you punch. Props are robot things, not a
pilot's.

## Acceptance criteria

1. The lids rest open, squint when hot and shut when off; the faces make
   their shapes and go by priority; no face covers the crosshair, however
   hot; a blink takes a sixth of a second; the coils run from cold steel
   through red and orange to near white (tests: `cockpit::tests`).
2. Screenshots of the states (`--cockpit-pose 0` to `4`: cool, hot,
   critical, shut down, hurt) and the faces (`5` glare, `6` worried, `7`
   pleased, `8` sleepy, `9` surprised, `10` locked; `11` and `12` a blink
   half and nearly shut), and a clip in the PR.
3. On the Deck: it feels like being inside BARRY, the view is not cramped,
   and the face reads without getting in the way. **Deck check: open.**
