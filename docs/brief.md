# Stompy, in one brief

What Stompy is, apart from how it was built. For an agent starting cold,
and for anyone (the owner included) who wants the whole game on one page.
The detail lives in [vision.md](vision.md), [architecture.md](architecture.md)
and [specs/](specs/); when they disagree with this page, they win.

## What it is

A 90s-style first-person mech sim. You pilot a big, slow, heavy machine
that stomps, punches, overheats and comes apart one limb at a time. A
deadpan cockpit computer reads out the bad news. It is allowed to be funny:
one of the mechs is called PURPLE PUNCHER.

It is made for fun, by one person, for their own Steam Deck. It is not
built for a market. Success is: genuinely fun to play on a Deck in your
hands. A Steam release may come later and must not steer anything.

## The rule above all: thunk

Everything is heavy and you feel it. Mechs speed up slowly, turn slowly
and land hard. Every footfall, hit, landing, recoil and punch gets several
of: camera kick; the body squashing or wobbling; sub-bass (and rumble on
the Deck); dust. If a feature makes the game lighter, twitchier or more
polite, it is wrong. When two good ideas conflict, the thunkier one wins.

## Platform

- Steam Deck first: 1280×800, a 7-inch screen, two hands.
- The controller is the primary input, and the Deck's whole layout is fair
  game: two sticks, triggers, bumpers, four back buttons, trackpads or gyro
  for fine aim.
- Mouse and keyboard on a desktop second.
- Touch still works; nothing is designed for it.
- Target: a steady 60 fps on the Deck.
- One web codebase (raw WebGL, no engine, no libraries), wrapped in an
  Electron shell for the Deck ([specs/40-steam-deck.md](specs/40-steam-deck.md)).

## The core (first, and great)

1. **Legs and torso turn apart.** One stick drives the legs (throttle and
   turn), the other twists and pitches the torso. Feet plant and never
   slide: the walk cycle runs on distance travelled, not time.
2. **Heat.** Firing builds heat. At 100 the reactor shuts down (no moving,
   no firing, a flat warning); it restarts at 45. Heat is the decision in
   every fight.
3. **Damage by section.** Torso, two arms, two legs, each with its own
   health. Lose a leg and you limp; lose both and a heavy mech sits down;
   lose the torso and you die.
4. **Weapons in three groups**, energy, ballistic and missile, each on its
   own trigger or bumper, plus one special:
   - energy beams ramp up on a target the longer they stay on it (the ramp
     belongs to the target and is shared by every beam on it);
   - ballistic guns use ammo;
   - missiles need a lock;
   - the fusion cannon (OOPS BUTTON) jumps heat straight to 140: a huge hit
     that shuts you down. One weapon, a whole decision.
5. **Melee.** A punch with a wind-up, knockback and a crunch. Landing on
   someone from the jump jets is a stomp.
6. **Jump jets.** Short, heavy hops and a hard landing.
7. **AI that uses its chassis and the ground.** Light mechs circle and jump
   over you, heavies advance together, snipers find high ground, hot or
   hurt mechs hide behind hills, and in woods they wait. Three difficulties.

## Content

- **Mechs:** BARRY (medium, a little of everything), SKEDADDLE (light,
  fast, fragile), SLOWPOKE (four legs, slow, does not stop), PURPLE PUNCHER
  (fists), BIG TROUBLE (small and rude), LONG LARRY (long legs, long gun).
- **Weapons:** BIG ZAPPER, LIL ZAPPER, BLINKY, ANGRY ZAPPER (energy); BIG
  BOOMER, RATATAT, BIG BONKER, TOASTER (ballistic); ANGRY BEES, FIRECRACKERS
  (missile); OOPS BUTTON.
- **Mechlab-lite:** swap weapons in fixed, category-locked hardpoints under
  a tonnage budget. No critical slots, no engine ratings.
- **Campaign:** short missions with simple objectives (destroy, survive,
  protect a convoy, reach extraction). Act I: LIL SNOOZERS, TOWER TOPPLER,
  HELPLESS LIL BUDDIES, FOUR LEGS BAD.
- **Places:** a desert at dusk, a glacier, a volcanic plain, a forest; night
  and weather.
- **Names are the owner's**, picked after seeing the thing move. Stable keys
  in code, every display name in one table (`src/data/names.js`),
  placeholders until the owner picks.

## Look and sound

- 1996 on a very good machine: flat-shaded, chunky, hand-built polygons.
- No textures, imported models, shadows or post-processing. Atmosphere is
  palettes, fog, weather, dust.
- A monospace green HUD readable at a glance: heat, a damage wireframe,
  target and ammo, without reading.
- Synthesised tones under a few CC0 samples.

## Tone

- Text is minimal. Briefs and blurbs are in a board-book voice: short,
  plain, present tense, numbers as words, no exclamation marks. `Four
  little trucks drive down the valley. Keep two trucks safe.`
- The cockpit voice is flat and dry. Warnings stay flat (`Warning. Heat
  critical.`); the jokes come after the fact (`Leg destroyed. Recommend
  hopping.`).
- No characters, no story, no references outside the game.

## The second arm (later, if it earns it)

Construction mechs: BIG SCOOPER digs ore out of voxel ground, a hauler
carries it, BIG STACKER builds a small base and a mech factory; raids come
for the base and you swap between your mechs mid-mission. Much of it is
built ([specs/20-build-and-fight.md](specs/20-build-and-fight.md) onward),
but it was built before it was played. The owner's first note on it:
**digging lacks cause and effect**. You can't see what the mech does to
change the ground, and the ground changes in steps. Whatever is done to
digging next, the bucket has to visibly bite and drag the dirt,
continuously, before anything is added to it.

## How to work

- **Find the fun first.** One mech walking, shooting, overheating and
  punching on the Deck, tuned until it is great in the hands; then the next
  thing.
- **Play before building.** The owner plays and writes down what feels
  right and what feels off, without proposing fixes; the next work is
  designed around the shape of those notes. No new system before the last
  one has been played. Plain bugs are fixed as they come in.
- **Keep the sim headless** (`src/sim`, `src/data`, `src/world` never touch
  the DOM, GL, audio or input) and tested.
- **Port the numbers, don't reinvent them.** `src/data/` holds every tuned
  value (chassis, weapons, heat, AI, feel); they are the result of a lot
  of tuning.
