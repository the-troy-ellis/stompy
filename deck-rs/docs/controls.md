# Controls

The pad is the primary input and the Deck's whole layout is used. Everything
here is in `crates/game/src/controls.rs` (pure, with unit tests) and
`crates/game/src/platform.rs` (SDL). Settings live in SETTINGS.

## Steam Deck

| Control | Does |
|---|---|
| Left stick, sideways | Turns the legs, at the chassis's turn rate. |
| Left stick, up and down | The throttle: as far as the stick is pushed, and back to zero when you let go (back is a slow reverse). Walking forward with the torso left alone for a moment, it swings back over the legs. |
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
| View held + Y, or F3 | The debug readout: fps, draws, particles, shots; then mechs alive, the sim's and the 3D drawing's ms a frame, and triangles (for measuring battles). |

Menus: D-pad or the left stick moves, A picks, B goes back, left and right
change a value.

### Watching a battle (Free Play, VIEW: WATCH)

| Pad | Keys and mouse | |
|---|---|---|
| Left stick | W A S D | Fly. |
| Right stick, or the gyro | The mouse | Look. |
| A | Space | Rise. |
| B | C | Sink. |
| RT held | Left button held | Fly four times as fast. |
| X | R | Jump to the fighting: behind your side, looking at theirs. |
| Start, View | Esc | Pause. |

Your own mech is parked off the field and nobody targets it; the battle ends
when either side is gone.

### The throttle is the stick

The owner (2026-11-28): the throttle drops back to zero when the stick isn't
pushed forward. So the stick's position is the throttle, like a pedal (the
legs' own inertia still eases the speed in and out), and W and S do the same.
The first build held a setting instead; this was the open question for the
first Deck playtest.

### The torso recentres as you walk

The owner (2026-11-28): walking forward without twisting, the torso comes
back over the legs. After 0.6 s with the twist left alone (a light touch on
the gyro doesn't count; aiming does), it swings back, gently (a share of 1.8
a second, softer than B's snap). Standing still, it stays where you put it.

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
