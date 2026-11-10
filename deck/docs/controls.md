# Controls

The pad is the primary input and the Deck's whole layout is used. Everything
here is in `src/platform/controls.c` (pure, so the mapping is testable) and
`src/platform/platform.c` (SDL). Settings live in SETTINGS.

## Steam Deck

| Control | Does |
|---|---|
| Left stick, sideways | Turns the legs, at the chassis's turn rate. |
| Left stick, up and down | Nudges the throttle setting (it holds; the HUD's amber notch is the setting). |
| Right stick | Twists and pitches the torso. Fine control near the centre, speed at the edge. Steers a guided volley. |
| Gyro | Fine aim, added to the torso, while a finger rests on the **right trackpad** (GYRO: RIGHT PAD, the default). GYRO: ALWAYS and OFF are in SETTINGS. |
| RT | Energy weapons, held (beams stay on; bolts refire). |
| RB | Ballistic weapons, held. |
| LT | Missiles. Tap to fire a volley; hold to fly it from the nose camera; let go to detonate. |
| LB | OOPS BUTTON (the fusion cannon): hold the scan on one mech for three seconds. |
| A | Jump jets: hold to charge, let go to blast off. Steer the flight with the left stick. |
| B | Centre the torso over the legs. |
| X | Next target (nearest first). |
| Y | Zoom (toggle). |
| Right stick click, R4, L4 | Punch. |
| R5 | Centre the torso (so the right thumb never leaves the stick). |
| L5, D-pad down | Full stop. |
| Start, View | Pause. |
| View held + Y, or F3 | The debug readout (fps, draws, particles). |

Menus: D-pad or the left stick moves, A picks, B goes back, left and right
change a value.

### Why the throttle holds

A mech sim's throttle is a setting, not a pedal: you set a speed and your
thumb goes back to turning. The stick nudges the setting up and down, the
D-pad and L5 stop. A DIRECT mode (stick position is the throttle) is an open
question for the first Deck playtest ([roadmap.md](roadmap.md) M1).

### The gyro

SDL reads the Deck's gyro directly (rad/s on three axes). Held flat, the
vertical axis turns the torso and the sideways axis pitches it. It is on only
while a finger rests on the right trackpad, which SDL also reports, so the
Deck can be set down or shifted in the hands without the aim wandering. If
Steam Input is set to turn the gyro into mouse motion instead (see
[deck-setup.md](deck-setup.md)), that works too: mouse motion is fine aim.

## Keyboard and mouse (Linux desktop, second)

| Key | Does |
|---|---|
| A, D | Turn the legs. |
| W, S | Throttle up and down. |
| Mouse | Torso twist and pitch (relative mouse, captured while playing). |
| Left button | Energy. Right button: ballistic. Middle button or F: missiles. G: OOPS BUTTON. |
| Space | Jump jets (hold, let go). |
| E, mouse button 4 | Punch. |
| C | Centre torso. R: next target. Z: zoom. X: full stop. |
| Escape | Pause; back in menus. Enter: pick. |
