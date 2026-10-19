# Portrait cockpit: the phone held upright

| | |
|---|---|
| Status | parked (owner, 2026-10-14): the direction is set, the fine tuning waits. Nothing to build yet. |
| Milestone | none yet |
| Size | L when it comes back: a second HUD layout, a second touch layout, a render viewport, a smoke run |
| Depends on | [11-release.md](11-release.md) (the manifest locks landscape), [14-look-and-performance.md](14-look-and-performance.md), the touch gestures in #275 |
| Touch parity | This is the touch layout for a phone held upright |

## Summary

Landscape stays the main way to play. This is a second layout for a phone
held upright, built like a cockpit: instruments along the top, a square
window in the middle, and every control in one band at the bottom, so both
thumbs rest at the same height. A square view holds about 70 degrees both
ways and draws fewer pixels than the landscape view.

The mockup is [mockups/portrait-cockpit.html](../mockups/portrait-cockpit.html).
It is playable in a browser: open it on a phone held upright. It is also
published as the owner's private artifact "Portrait Cockpit".

## Decided so far

- **Landscape is unchanged.** Portrait is picked by the screen's shape, and
  turning the phone mid-mission switches between them.
- **Top band:** compass tape; radar, the target box and your own damage
  wireframe side by side; heat and jet bars and the speed under them.
- **The window is square**, between cockpit struts. Dragging in it aims.
  A double tap in it punches.
- **Between the window and the controls:** a row of warning lamps (HEAT,
  JETS, AMMO, LOCK, REACH, HIT), then the weapon readouts as a dash strip.
- **Controls, all in one band at the bottom, centred on one line:**
  - LEGS stick in the left corner: up and down set the throttle, which stays
    where you leave it; sideways turns. Tap, then tap and hold: the jets burn.
  - AIM stick in the right corner: twist and tilt. A double tap punches.
  - Fire buttons between them: ENERGY, BALLISTIC, MISSILE, FUSION, with TGT
    above. A held fire button aims as it slides, so one thumb can shoot and
    aim at once (FUSION already works this way in landscape).
- **No JUMP or PUNCH buttons**, here or in landscape. They are double taps on
  the sticks (#275).

## Open questions (for when it comes back)

1. The AIM stick, or no AIM stick and bigger fire buttons that aim as they
   slide (the mockup's FIRE BUTTONS ONLY option)?
2. Do the lamps earn their space, or should the window grow into it?
3. Where does ZOOM go, and STOP, PAUSE and LIGHTS?
4. In the meantime: should an upright phone in the landscape game show a
   "turn it sideways" prompt? iOS ignores the orientation lock, so today it
   draws the landscape layout squeezed into a tall screen.

## Not decided

A one-handed layout and the dash strip as fire buttons were tried in the
mockup and dropped: both break "every control at the bottom".
