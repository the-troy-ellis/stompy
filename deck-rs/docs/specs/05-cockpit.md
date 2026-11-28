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
- **BARRY**: a big rounded-square eye (a superellipse 0.95 by 0.57 at a
  metre, nearly the whole screen: the owner, 2026-11-28, found the first
  oval made the battle hard to see) with a lip, a raised faceted ring and
  rivets, the panel round it dished in toward the eye past the screen's
  edge.
- **The iris**: a six-blade aperture just behind the ring, in place of
  eyelids. The owner (2026-11-28): the giant eye means every demigod is a
  cyclops, and the eye can be expressive; then "a full 6 blade aperture
  that can move blades semi independently to allow for expression". Each
  blade is a steel plate with a rolled edge, a rib and the pin it turns
  on, tipped a little in depth along its length so the six overlap each
  other round the circle, each over the next, as an iris's do. Each blade
  has its own pair of springs: how far in (its edge's distance from the
  middle, in proportion to the oval) and how far turned; their stiffnesses
  differ a little, so the blades ripple rather than move as one, and they
  slide along their edges as they close. The opening is what the six
  edges leave: a hexagon, always convex (so there is no V or arch; the
  faces are shapes). The face, by priority:

  The owner (2026-11-28): the faces are subtle, except for pain and being
  close to destroyed. By priority:

  | Face | Iris | When |
  |---|---|---|
  | Pain (strong) | clamps in hard for 0.4 s | a big hit (4% of the whole machine in a frame) |
  | Close to destroyed (strong) | the top blade pulls back and the upper pair close in, a peak that grows as the torso goes, every blade trembling on its own beat | the torso under 35%, starting gently and full at 5% |
  | Pleased (subtle) | the bottom blades rise a little | 0.5 to 3.5 s after the player's kill: the joke after the fact |
  | Glare (subtle) | the top comes down a little, the upper pair a touch toward level | firing in the last 1.2 s, or zoomed in |
  | Locked (subtle) | the whole iris tightens a touch, focusing | a target locked |
  | Sleepy (subtle) | the top droops a little | nothing touched for 8 s |
  | Relaxed | open, the blades all but out of sight | otherwise |

  The subtle faces keep every blade within a fifth of rest (test). Over
  every face the heat squints the eye as it climbs past 55 (the top and
  bottom blades most); shut down (or dead), the iris twists shut. A small
  hit flinches every blade in a little. Hurt below half, one blade sticks:
  it lags and twitches. **No face covers the middle of the view**: every
  edge stays 0.24 clear of it however hot (test).
- **The blink** (the owner liked the blink, and asked for it more like an
  aperture): every 2.5 to 6.5 s the iris twists shut to a point in 0.05 s,
  each blade a hundredth of a second after the last, holds a moment, and
  opens over 0.1 s.
- **Heat coils**: a row of fins across the bottom of the eye: cold steel,
  then dull red, orange, and near white at shutdown, flickering when
  critical, with puffs of steam rising and thinning out. Shut down, they
  cool to a dull red.
- **Jet capacitors**: two small cages of thin bars standing either side of
  the coils at the bottom of the eye, clear of the HUD, each filling with a column of light as the jets
  recharge, humming bright when ready, dark when off.
- **Cracks** spread across the eye in three stages as the torso drops below
  three quarters, a half and a quarter.
- **The maintenance tag** the tiny robots tied on, in BARRY's accent, on
  six links of chain from a hook at the top of the eye, outside the iris,
  so it closes over the tag (which never swings in far enough to touch
  it). It swings on two
  springs, pushed by the head's jolts (sideways, fore and aft), by its turns
  and tips (the head rotates under the hook), and a little by each
  footfall's drop.
- The cockpit's own guns (bug 2's fix) reach in from behind the frame at
  the sides of the view, each barrel aimed down the crosshair's line so
  they meet where your shots go, and fire from their tips. Only the guns
  (or fists) are drawn from inside, and they hang from the head, not the
  torso, so they stay put against the frame while the head bobs; their
  back ends are always behind the frame (the owner, 2026-11-28: the arms
  floated, attached to nothing).
- The green HUD stays on top of it all.

## The rest (next)

From the mockups, each as its own head: SKEDADDLE's beak slit and jittery
lamps, SLOWPOKE's wide glass between pillars and its pendulum weight, BIG
TROUBLE's cramped eye and patched plates, LONG LARRY's tall visor and the
scope that drops when you zoom, PURPLE PUNCHER's letterbox and the little
punching bag that swings when you punch. Props are robot things, not a
pilot's.

## Acceptance criteria

1. The iris rests open, squints when hot and shuts when off; the faces
   make their shapes, symmetric, and go by priority; no face covers the
   crosshair, however hot; a blink snaps shut, holds and opens; the coils run from cold steel
   through red and orange to near white (tests: `cockpit::tests`).
2. Screenshots of the states (`--cockpit-pose 0` to `4`: cool, hot,
   critical, shut down, hurt) and the faces (`5` glare, `6` nearly destroyed, `7`
   pleased, `8` sleepy, `9` pain, `10` locked; `11` and `12` a blink
   half and nearly shut), and a clip in the PR.
3. On the Deck: it feels like being inside BARRY, the view is not cramped,
   and the face reads without getting in the way. **Deck check: open.**
