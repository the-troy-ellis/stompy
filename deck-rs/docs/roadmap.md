# Roadmap

The brief's way of working: find the fun first, playtest on the Deck before
building more, and no new system ships before the owner has played the last
one. So each milestone ends on the Deck in the owner's hands, and the next
one starts from what they said.

| Milestone | What it is | Done when |
|---|---|---|
| **M0** The core, built | Everything in [specs/00-core.md](specs/00-core.md): one mech that walks, shoots, overheats, punches, jumps and falls apart, felt. Six chassis, eleven weapons, the AI, Free Play, two Act I missions. | **Now.** Built and tested headless; screenshots under software GL. Not yet played on a Deck. |
| **M1** Played, then tuned | The owner plays it on the Deck. The first Deck playtest decides: stick feel and dead zones, gyro on or off and how strong, the throttle (hold or direct), rumble strength per event, the cockpit arms, the HUD's size, the FOV. Then the tuning pass on feel: footfalls, landings, hits, punches (the FEEL rows, live-tunable). | Three words from the owner that include heavy, chunky, thunky or satisfying. Issues filed for what was wrong. |
| **M2** The campaign's rest of Act I | Structures and vehicles (towers to topple, trucks to escort), waves, the DESTROY, ESCORT, SURVIVE and EXTRACT objectives, the debrief verdicts for them, mission 1's silent tutorial prompts. TOWER TOPPLER and HELPLESS LIL BUDDIES playable. | Act I winnable on NORMAL in a stock BARRY. |
| **M3** Mechlab-lite | The FIT screen: hardpoints by category, systems (sinks, armour, jets, KNUCKLES), the tonnage bar, saved per chassis. Enemies stay stock. | A JACKAL with two BLINKYs and sinks sustains fire longer than stock (test). |
| **M4** Atmosphere | Weather particles (rain, snow, dust, fog), night with headlights, the dusk-to-night ramp drawn, the ambience beds per biome, the few CC0 samples under the synthesis, a recorded cockpit voice (the owner's, or a flat TTS render they pick). | A night mission is playable and the voice says the lines. |
| **M5** Acts II and III | The glacier and the volcanic plain, the forest, LONG LARRY's and BIG TROUBLE's and PURPLE PUNCHER's entrances, contracts after twelve. | All twelve missions winnable headlessly by the perfect-player harness and by the owner. |
| **Later** | The second arm (construction: BIG SCOOPER, the hauler, BIG STACKER, raids), only if it earns it, with the bucket biting the dirt visibly and continuously first. A Steam release, which must not steer anything. | |

## What M1 is waiting on (the first Deck playtest)

Questions only the owner's hands can answer. Each is a knob already in the
game or a one-line change:

1. Does the throttle want to hold (now) or follow the stick (DIRECT)?
2. Is the gyro on the right pad's touch right, or always on, or off? How
   strong (GYRO SENS)?
3. Are the paddles right: R4 and L4 punch, R5 centre, L5 stop?
4. Does rumble on every footfall please or tire? (`FEEL[FE_STEP].haptic`,
   10 ms now.)
5. Are the cockpit arms in the way, or do they sell the cockpit?
6. Is the HUD readable at arm's length (HUD SCALE)? Is the ring in the right
   corner?
7. Which of the three words.

## Not planned

Multiplayer, touch, phones, a browser build, a market. The reference has the
first three; this rebuild has the Deck.
