# Stompy for the Steam Deck: the plan of record

This folder is the plan for the Deck rebuild. It exists so that the owner, or
any agent, can pick up a piece of work cold, build it the way the project
wants, and hand it off without a conversation. The game is in `deck/src`; the
reference implementation (the browser version, with every tuned number) is
the repository around it.

Read in this order the first time:

| Doc | What it answers |
|---|---|
| [vision.md](vision.md) | What this rebuild is, what it is not, and the pillars that settle arguments. The brief, kept. |
| [architecture.md](architecture.md) | The code as it is: the sim, the platform, the renderer, how they talk, the invariants. |
| [controls.md](controls.md) | The Deck layout, the gyro, the paddles, and the keyboard and mouse second. |
| [deck-setup.md](deck-setup.md) | Building it, putting it on the Deck, the Steam Input layout, playtesting. |
| [roadmap.md](roadmap.md) | The milestones, what is in each, what the owner plays before the next starts. |
| [workflow.md](workflow.md) | How work is claimed, tested, playtested on the Deck and merged. The definition of done. |
| [issues.md](issues.md) | The backlog, as ready-to-file issues. |
| [specs/](specs/) | One spec per feature: what was built, what it touches, acceptance criteria, tests. |

If you read one spec before any other, read [specs/01-thunk.md](specs/01-thunk.md):
it is what the game is supposed to feel like, and it is the pillar that wins
every argument.

## Where this stands (M0, built, not yet played)

The core slice from the brief is built and runs: one mech walks on planted
feet, turns its legs and torso apart, fires all three weapon groups and the
OOPS BUTTON, overheats and shuts down at 100 and restarts at 45, loses limbs
one at a time, punches, stomps, blasts off on its jets and lands hard, with
every one of those felt through the camera, the body springs, the sub-bass
and the pad's rumble. Six chassis, eleven weapons, three difficulties, the AI
profiles, Free Play on four places at four times of day, and Act I's two
ELIMINATE missions (LIL SNOOZERS, FOUR LEGS BAD) are in. Every number is the
reference's.

**Nothing ships past this until the owner has played it on the Deck.** The
brief's own rule. The next milestone (M1) is that playtest and the tuning it
asks for. See [roadmap.md](roadmap.md).

## Decisions already made

These came from the owner's brief and are not up for re-litigation in a PR.

- **Thunk above all.** When two good ideas conflict, the thunkier one wins.
  A feature that makes the game lighter, twitchier or more polite is wrong.
- **Steam Deck first.** 1280 by 800, a 7 inch screen, two hands on the pad.
  The Deck's whole layout is used. A locked 60. Mouse and keyboard on a Linux
  desktop are second. No touch, no phones.
- **Made for fun, by one person, for their own Deck.** Not a market. A Steam
  release may come later and must not steer anything.
- **Port the numbers, do not reinvent them.** `src/data` in the reference is
  the result of a lot of tuning. Balance numbers change only in issues about
  balance.
- **The sim is headless and tested.** `deck/src/sim`, `data` and `util` never
  include SDL or GL; `make lint` enforces it.
- **Names are the owner's.** Stable keys in code, display names in one table
  (`src/data/names.c`), placeholders for anything new, and a NAMING section
  on any PR that makes a new thing visible.
- **Tone:** minimal, not solemn. Board-book briefs, a flat cockpit voice,
  jokes after the fact, silly hardware names, no characters, no references.
- **Look and sound:** 1996 on a very good machine. Flat-shaded hand-built
  polygons at the screen's own resolution, no textures, no imported models,
  no shadows, no post-processing, no blending (a dither is the one
  see-through). Synthesised tones, with a few CC0 samples to come.
- **Tech:** C11, SDL2 and OpenGL 3.3 core. SDL is the platform (the Deck
  ships it). Any other library needs the owner's yes first: ask, with a
  justification (what it does, why writing it here is worse, its licence,
  its size), and wait for the answer. Single-file, permissively licensed
  libraries are the easiest yes.
- **The second arm (construction) comes later, and only if it earns it.**
  When it does, the bucket must visibly bite and drag the dirt continuously
  before anything else is built on it.
