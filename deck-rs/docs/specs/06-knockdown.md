# Knockdown: falling over and getting up

| | |
|---|---|
| Status | **Draft, asks open** (2026-11-28). Not built: the wrecking ball (#439) gets played on the Deck first. |
| Milestone | P1 (feel), after the wrecking ball has been played |
| Depends on | `00-core.md` (melee, the stagger), `01-thunk.md`, `03-anim.md`, `05-cockpit.md` |

## Summary

The owner (2026-11-28), after the wrecking ball: the mechs should be able to
fall or get knocked down, and then have to get up. A demigod on its back is
a big moment: for the one who did it, for the one inside it, and for the
tiny robots under it.

## Proposed

- **What puts a mech down.** A blow big enough for its mass. Every blow
  already has an impulse scaled by the masses (the knock, `melee::knock`);
  above a threshold the mech goes down instead of staggering. So a wrecking
  ball floors a SKEDADDLE every time, a BARRY sometimes, a SLOWPOKE (four
  legs) never. Also an insta-stomp from a high blast-off, and a big blast at
  your feet. A lost leg already sits a mech down; that stays as it is.
- **The fall.** The body topples the way the blow pushed it, pivoting about
  its feet (the death's topple, `Dying`, without the dying): the legs
  buckle, it goes over in about 0.6 s, and hits the ground with the biggest
  thump a body makes, a ring of dust and the ground shaking for those near.
  Tiny robots under it are honoured.
- **Down.** It lies on its side or back for about two seconds. Its feet are
  off the ground, so the gait stops; the sim holds it as a body lying where
  it fell. Down, it can't walk, turn or punch.
- **Getting up.** About 1.2 s: it rolls to its front, gets its knees and
  hands (or fists) under it, pushes up, and stands, with a heave and a
  thump as the feet plant. Each chassis in its own way (`03-anim.md`):
  SKEDADDLE springs up, PURPLE PUNCHER shoves itself up off its fists,
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

1. **What knocks a mech down?** Only PURPLE PUNCHER's wrecking ball, or any
   big enough blow (a high stomp, a big blast, BIG BONKER's shell)?
2. **Getting up: automatic, or yours?** After a set time it gets up by
   itself; or you press (A?) to get up, and mashing gets you up sooner; or
   both (it gets up by itself after a while, pressing gets you up sooner).
3. **Down: helpless?** No guns at all while down, or can the torso's guns
   still fire (wildly, at whatever they point at)?
4. **SLOWPOKE.** Never knocked down (four legs), or only by the biggest
   blows?
5. **The other side.** Can you stomp a downed mech for extra (the honour of
   the foot, at demigod scale)?

## Acceptance criteria

1. A blow over the threshold puts a mech down the way it was pushed; under
   it, a stagger (tests).
2. Down, it can't walk, turn or punch; it gets up as the asks decide (tests).
3. Its feet never slide: down, the gait stops; getting up, they plant where
   it stands (test).
4. From the cockpit the fall, the slam, the lying and the getting up read
   and feel like a demigod going over. **Deck check: open.**
