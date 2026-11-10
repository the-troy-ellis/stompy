# Workflow

How a piece of work moves from an issue to `main`. Agents and people alike.

## Claiming work

1. Work comes from GitHub issues on the repository, labelled `deck`, with a
   milestone (M1 to M5), a size and a link to its spec. [issues.md](issues.md)
   is the seed list; once filed, GitHub is the truth.
2. One issue per branch per PR. Branch from `main`: `deck/m1/throttle-direct`.
3. No new system ships before the owner has played the last one on the Deck.
   A PR that adds a system while the previous milestone's playtest is open
   waits.

## Definition of done

A PR is done when all of these hold:

1. **Acceptance criteria** in the spec are met, each demonstrable (a test, a
   screenshot from `tools/shot.sh`, or a reviewer step).
2. **Tests**: new sim logic has checks in `test/`; `make test` and `make lint`
   are green; `make` builds with no warnings.
3. **The Deck**: the playtest checklist below was run on a real Deck, in Game
   mode, with the pad. Not a desktop with a controller; not device
   emulation.
4. **Budget**: anything touching `update`, the scene, the HUD or particles
   reports the draw count and whether 60 held on the Deck (F3).
5. **Docs**: spec status moved; the architecture map updated if files moved.
6. **Tone**: new strings pass the tone tests (`make test`: briefs in the
   board-book voice, the voice flat and short, no exclamation marks).
7. **Thunk**: anything that adds an action or an impact ships with its feel
   row, its sound, its rumble and its body reaction. A silent, still action
   is not done.
8. **NAMING**: a PR that makes a new mech, weapon, mission or verdict visible
   ends with a NAMING section (screenshots, one line on its personality,
   three to five candidates). Agents never pick the final name.

## The playtest checklist (on the Deck, about eight minutes)

**Menu**
- [ ] The title, the main menu, the mech turning. The sticks and the D-pad
      move, A picks, B backs.
- [ ] SETTINGS values persist across a restart.

**Free Play, three hostiles, dusk desert**
- [ ] Walk, turn, throttle hold, full stop (L5), jump (hold A, let go) and
      land. Feet do not slide. The landing is felt.
- [ ] Torso twist and pitch on the right stick; gyro with a finger on the
      right pad; centre (B or R5); zoom (Y); next target (X).
- [ ] RT beams: the heat arc climbs, the target's melt makes the beam fat and
      white. RB fires BIG BOOMER with a kick. LT taps a volley; LT held flies
      it; let go detonates.
- [ ] LB on a target for three seconds: the discharge, the white-out, the
      shutdown, the torso damage, the voice.
- [ ] Overheat to shutdown and recover: the sag, the dark HUD, the voice
      lines once each.
- [ ] Punch a SKEDADDLE that gets close (R4): it skids. Get stomped or stomp.
- [ ] Lose an arm (its weapon goes red), lose a leg (speed halves), die (the
      beat, the fall, the debrief).
- [ ] Win: the debrief's verdict, AGAIN, REPLAY, MAIN MENU.
- [ ] Pause and resume with Start.

**Always**
- [ ] Nothing printed on stderr. 60 held (F3) through a fight with deaths.
- [ ] Rumble on steps, hits, landings, the discharge.

## Naming things

The owner names mechs, weapons, missions and verdicts after seeing them.
Keys are not names: code, saves and data use stable keys (`CH_LIGHT1`,
`W_PPC`, `m07`); display names live in `src/data/names.c` and nowhere else.
Build with a placeholder, show it, then ask in the PR's NAMING section.
Confirmed so far: every chassis, every weapon, Act I's missions. The verdicts
are drafts.

## Things agents get wrong here

- Adding a library without asking. Ask the owner first, with the
  justification: what it does, why writing it here is worse, its licence and
  its size. Only add it once they say yes, and record it in the PR.
- Changing balance numbers in a PR about something else.
- Making it lighter, twitchier or more polite. Thunk wins.
- Making it solemn. If a name would fit a military manual, try again.
- Testing with a controller on a desktop and calling it the Deck.
- Adding text. Every string gets the tone tests. Prefer a HUD marker or a
  voice line. The second sentence is where the joke dies.
