# Vision

## One line

A 90s-style first-person mech sim for one person's Steam Deck. You pilot a
big, slow, heavy machine that stomps, punches, overheats and falls apart one
limb at a time. A deadpan cockpit computer reads out the bad news. One of the
mechs is called PURPLE PUNCHER. It is allowed to be funny.

## The one rule above all: thunk

Everything is heavy and you feel it. Mechs speed up slowly, turn slowly and
land hard. Every footfall, hit, landing, recoil and punch gets several of:

- a camera kick,
- the mech body squashing or wobbling,
- sub-bass, plus rumble on the Deck,
- dust.

If a feature makes the game feel lighter, twitchier or more polite, it is
wrong. When two good ideas conflict, the more thunky one wins.

## Platform

- Steam Deck first: 1280 by 800, a 7 inch screen, held in two hands.
- The controller is the primary input, using the Deck's full layout: two
  sticks, triggers, bumpers, four back buttons, and the trackpads or gyro
  for fine aim.
- Mouse and keyboard on a Linux desktop are second.
- No touch, no phones.
- A locked 60 fps on the Deck.

## The core (built first; make it great before anything else)

1. **Legs and torso turn apart.** One stick drives the legs (throttle and
   turn), the other twists and pitches the torso. Feet plant and never
   slide: the walk cycle is driven by distance travelled, not time.
2. **Heat.** Firing builds heat. At 100 the reactor shuts down: no moving, no
   firing, a flat warning. It restarts at 45. Heat is the main decision in
   every fight.
3. **Damage by section.** Torso, two arms, two legs, each with its own
   health. Lose a leg and you limp. Lose both and a heavy mech sits down.
   Lose the torso and you die.
4. **Weapons in three groups**, energy, ballistic and missile, each on its
   own trigger or bumper, plus one special: beams ramp up the longer they
   stay on the same target (the ramp is the target's, shared by every beam on
   it); ballistic guns use ammo; missiles need a lock; the fusion cannon
   (OOPS BUTTON) jumps heat straight to 140, a huge hit that shuts you down.
5. **Melee.** A punch with a wind-up, knockback and a crunch. Landing on
   someone from your jump jets is a stomp.
6. **Jump jets.** Short, heavy hops with a hard landing.
7. **AI that uses its chassis and the terrain.** Light mechs circle and jump
   over you, heavies advance together, snipers find high ground, and hot or
   hurt mechs hide behind hills. Three difficulty settings.

## Content

- Mechs: BARRY (medium, all-rounder), SKEDADDLE (light, fast, fragile),
  SLOWPOKE (four legs, slow, relentless), PURPLE PUNCHER (fists), BIG TROUBLE
  (small and rude), LONG LARRY (long legs, long gun).
- Weapons: BIG ZAPPER, LIL ZAPPER, BLINKY, ANGRY ZAPPER, BIG BOOMER, RATATAT,
  BIG BONKER, TOASTER, ANGRY BEES, FIRECRACKERS and OOPS BUTTON.
- Mechlab-lite: swap weapons into fixed, category-locked hardpoints under a
  tonnage budget. No critical slots or engine ratings.
- Campaign: short missions with simple objectives (destroy, survive, protect
  a convoy, reach extraction). Act I is LIL SNOOZERS, TOWER TOPPLER, HELPLESS
  LIL BUDDIES and FOUR LEGS BAD.
- Places: desert at dusk, glacier, volcanic plain and forest, with night and
  weather.
- Names are the owner's. Stable keys in code, display names in one table,
  placeholders for new things until the owner picks.

## Look and sound

- 1996 on a very good machine: flat-shaded, chunky, hand-built polygon
  meshes. No textures, no imported models, no shadows, no post-processing.
- Atmosphere comes from palettes, fog, weather and dust.
- A monospace green HUD, readable at a glance at arm's length: heat, a
  damage diagram, the target and the ammo without reading.
- Synthesised tones layered under a few free (CC0) samples.

## Tone

- Text is minimal. Briefs and menu blurbs are in a board-book voice: short,
  plain, present tense, numbers as words, no exclamation marks. "Four little
  trucks drive down the valley. Keep two trucks safe."
- The cockpit voice is flat and dry. Warnings stay flat ("Warning. Heat
  critical."). Jokes only come after the fact ("Leg destroyed. Recommend
  hopping.").
- No characters, no story, no references outside the game.
- `cargo test` checks every brief and voice line against these rules.

## Non-goals

- A full mechlab with critical slots, engine ratings or per-section armour.
- Weapon groups beyond the three categories and the special.
- A story with characters, dialogue, cutscenes or branching.
- Parody or references to other games, memes or the real world.
- Textured or imported art, shadow maps, post-processing, alpha blending.
- Multiplayer (the browser version has it; this rebuild does not, until the
  owner asks).
- A market. Nothing here is built for a store page.

## The second arm (later, and only if it earns it)

Construction mechs: BIG SCOOPER digs ore out of voxel ground, a hauler
carries it, BIG STACKER builds a small base and mech factory, raids come for
the base and you swap between your mechs. The owner's note on the first
version: digging lacked cause and effect; the ground changed in steps and you
could not see what the mech did to it. If this is built, the bucket must
visibly bite and drag the dirt continuously before anything else goes on top.

## Reference points

MechWarrior 2 for the cockpit and the heat and damage model. Early Armored
Core for mission brevity. Katamari Damacy for how far good physics and a
straight face carry a game. Rocket League for hits you feel in your hands.
