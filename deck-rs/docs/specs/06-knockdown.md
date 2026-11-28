# Knockdown: falling over and getting up

| | |
|---|---|
| Status | **Built** (2026-11-28; the owner: "build now"). **Deck check: open.** |
| Milestone | P1 (feel), after the wrecking ball has been played |
| Depends on | `00-core.md` (melee, the stagger), `01-thunk.md`, `03-anim.md`, `05-cockpit.md` |

## Summary

The owner (2026-11-28), after the wrecking ball: the mechs should be able to
fall or get knocked down, and then have to get up. A demigod on its back is
a big moment: for the one who did it, for the one inside it, and for the
tiny robots under it.

## Proposed

- **What puts a mech down: the wrecking ball, for now** (the owner,
  2026-11-28: "just the wrecking ball for now should knock a mech down").
  A wrecking ball that lands floors any two-legged mech; nothing else knocks
  one down (stomps, blasts and shells stagger and shove as they do now). A
  lost leg already sits a mech down; that stays as it is.
- **SLOWPOKE stands** (the owner: "Slowpoke gets a good thunk but doesn't
  get knocked down"). On four legs it takes the wrecking ball's full feel
  and its stagger, and stays on its feet.
- **The fall.** The body topples the way the blow pushed it, pivoting about
  its feet (the death's topple, `Dying`, without the dying): the legs
  buckle, it goes over in about 0.6 s, and hits the ground with the biggest
  thump a body makes, a ring of dust and the ground shaking for those near.
  Tiny robots under it are honoured.
- **Down** (the owner, 2026-11-28: "you are effectively disabled and can't
  fire"). It lies on its side or back. Its feet are off the ground, so the
  gait stops; the sim holds it as a body lying where it fell. Down, it can't
  walk, turn, aim, punch or fire anything.
- **Getting up: you mash** (the owner: "while down you have to button mash
  to get up"). It never gets up by itself. Each press is a heave: the body
  shoves part of the way up, felt (a thump, a lurch of the view, a rumble),
  and sags back a little if the presses stop, so a steady mash gets you up
  and a slow one barely does. Proposed: A (the jets' button, free while
  down; Space on the keyboard), about eight quick presses from flat on the
  ground. The AI mashes at a rate set by difficulty. At the top, the last
  push: it rolls to its front, gets its knees and hands (or fists) under
  it, and stands, with a heave and a thump as the feet plant. Each chassis
  in its own way (`03-anim.md`): SKEDADDLE springs up, PURPLE PUNCHER shoves itself up off its fists,
  BARRY grinds up. While getting up it is open: a stomp lands, the next
  wrecking ball puts it straight back down.
- **From inside.** The view goes over with the body: the horizon rolls, the
  ground comes up fast, the slam (a row above `wrecked`), then the world on
  its side, sky in half the eye. The iris clamps on the slam and squints
  while down; the HUD crackles. Getting up, the view comes back level in
  stages, with a thump as the feet plant.
- **The AI.** Same rules for it. A mech that floors yours walks in to stomp;
  one that's floored tries to get up and back out.
- **Feel rows to add.** `knocked` (the slam of the fall), `up` (the heave and
  the plant).

## Ask

1. ~~What knocks a mech down?~~ **Answered:** only the wrecking ball, for now.
2. ~~Getting up~~ **Answered:** you button-mash; it never gets up by itself.
   Built with A (Space), eight presses from flat; to confirm on the Deck.
3. ~~Down: helpless?~~ **Answered:** effectively disabled; nothing fires.
4. ~~SLOWPOKE~~ **Answered:** a good thunk, never knocked down.
5. **The other side.** Can you stomp a downed mech for extra (the honour of
   the foot, at demigod scale)? Built without: a downed mech is low, so a
   stomp lands on it as on any mech, for the stomp's own damage.

## As built

- `sim/down.rs`. A wrecking ball that lands knocks down any two-legged mech
  on the ground (`can_fall`); SLOWPOKE takes the stagger and stands.
- **Thrown** (the owner, 2026-11-28: "the mech should be lifted a bit in the
  air and slide a bit when it hits the ground"). A wrecking ball throws what
  it hits off the ground: 5 to 9 m/s up by the blow's mass ratio (a
  SKEDADDLE highest, SLOWPOKE a hop), the shove carrying it back, the air
  hardly slowing it (`THROW_LIFT`, `AIR_DECAY`). The legs hang under it in
  the air. It comes down when it meets the ground (not the usual snap to it
  from 1.2 m), and skids: its feet slide with it, scraping dust, until the
  shove dies down (`SKID_MAX`), then plant. SLOWPOKE lands on its feet and
  skids; a mech going over lands on its back and slides.
- **Falling** (0.6 s, in the air when thrown): the blow turns it as it goes,
  so it always lands on its back; then, when it meets the ground, the slam (the `knocked` row: an eye drop 1.6, the view
  shaken, a deep thump, 280 ms of rumble, dust; a landing and a clang).
- **Lying**: no walking, turning, aiming, punching, jets or guns; for the
  player only A does anything. Each press (a hold counts once) heaves it an
  eighth of the way up (`MASH_PRESSES`) with the `heave` row (a thump, a
  lurch, a short rumble) and a footfall sound; half a second after the last
  press the heaves sag back at 0.15 a second.
  The AI mashes 3, 4.5 or 6 times a second by difficulty, thinking or not.
  It sits low: its top and its centre drop with the lean, so shots and
  stomps meet it where it lies.
- **A ragdoll from the blow** (the owner, 2026-11-28: it looked like it was
  lying down as it flew back; "the point of impact should fly back and the
  rest of the body should follow. It should ragdoll a bit"). Drawn only
  (`anim::Rag`), a few loose joints driven by the blow: the struck torso
  whips back against the hips first and rocks; the body is set tipping back
  and spins freely in the air, then topples the rest of the way onto its
  back on the ground and bounces; the legs hang from the hips and lag the
  body on a loose spring, so the feet trail, then swing up and kick; the
  arms are flung forward and flail. The hips sit as high as the legs hold
  them. Once it has lain a moment (or the mashing starts) the get-up's poses
  take over, blended in.
- **The get-up is a boxer's off the canvas**, not a hinge (the owner,
  2026-11-28: "it needs to get itself up in a realistic way like a boxer
  stumbling back onto its feet"). Drawn as poses the body moves through
  (`anim::down_pose`): the hips' height and place, how far they lean back
  and roll, the torso's lean, each foot on the ground, each arm. Flat on
  its back with the legs out; sitting up, knees in, a fist planted behind;
  rolling onto a knee, a fist pushing off the ground in front; up on one
  knee, a fist on the other; standing, hunched. The legs reach for the
  feet the pose sets, so the knees bend as they would. The mashing drives
  it up to the knee: each press visibly shoves it on, and it sinks back
  when the presses stop.
- **Rising** (0.9 s): from the knee to standing; the feet plant afresh where
  it stands (`init_feet`), the `up` row and a landing; then a **stumble**: a
  shove back that its legs step out of, a wobble, and weak legs for 0.6 s
  (`STUMBLE`). A death while down takes over.
- **From inside**: the eye rides the drawn body through the fall, the lying
  (sky through the eye) and the get-up (the view rolls onto the knee and
  comes back level as it stands); the iris clamps (pain) while down; the HUD shows DOWN, MASH A
  TO GET UP and a bar of the heaves. Getting up, it comes back level.
- The demo pilot mashes too.

## Acceptance criteria

1. A wrecking ball puts a two-legged mech down the way it was pushed;
   SLOWPOKE takes the feel and the stagger and stands; nothing else knocks a
   mech down (tests).
2. Down, it can't walk, turn, punch or fire; it gets up only by mashing, a
   steady mash gets it up and a slow one doesn't, and the AI mashes by
   difficulty (tests).
3. Its feet never slide: down, the gait stops; getting up, they plant where
   it stands (test).
4. From the cockpit the fall, the slam, the lying and the getting up read
   and feel like a demigod going over. **Deck check: open.**
