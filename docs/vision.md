# Vision

## One line

Stompy is a 90s-style mech sim you can play in a browser tab or on a phone
held sideways: big thunky machines that stomp, punch and overheat, heat that
matters, legs and torso that turn apart, and a deadpan cockpit computer that
reads out the bad news. It is called Stompy. One of the mechs is called
PURPLE PUNCHER. It is allowed to be funny.

## What finished looks like

- A **twelve-mission campaign** across three biomes (dusk desert, glacier,
  volcanic plain) plus night and weather variants, with objectives beyond
  "kill everything": knock down structures, survive a timer, protect a convoy,
  reach an extraction point. After mission twelve, open contracts continue
  procedurally.
- **Six chassis** across light, medium, heavy and assault, each with a
  distinct body plan, silhouette, role and personality. The three that exist
  (KESTREL, JACKAL, WARDEN) plus three new ones, among them PURPLE PUNCHER,
  an assault brawler with fists.
- **Melee.** A punch with a wind-up, a knockback, and a crunch. Everyone can
  shove; PURPLE PUNCHER can really punch. Landing from jump jets on someone
  is a stomp.
- **A dozen weapons** across the three fire categories (energy, ballistic,
  missile) plus the fusion cannon, with names like BIG BONKER, and a
  **mechlab-lite** screen to fit them into category-locked hardpoints under
  a tonnage budget.
- **Thunk.** Every footfall, hit, landing, recoil and shutdown has weight you
  can feel: camera kick, squash, wobble, sub-bass, dust.
- **Enemy AI** that uses the terrain, its jump jets, and its chassis's
  strengths, with a difficulty setting.
- **Atmosphere**: night missions with headlights, rain, snow, dust storms,
  lightning, buildings and props, debris that stays, wrecks that burn.
- **Multiplayer**: a polished LAN free-for-all and team deathmatch, co-op
  campaign for two to four pilots, and internet rooms by code.
- **Shipped**: installable as a PWA, works offline in single player, gamepad
  support, a settings screen that covers sensitivity and field of view, and a
  one-command deploy.

## Design pillars

When two good ideas conflict, the pillar higher in this list wins.

1. **Thunk.** Everything in Stompy is heavy and you feel it. Mechs accelerate
   slowly, turn slowly, land hard, and the camera, the sound and the mech's
   own body all react. Weapons have recoil, recharge and heat. A punch has a
   wind-up and a follow-through. If a feature makes the game feel lighter,
   twitchier or more polite, it is wrong for Stompy.
2. **Fun, not solemn.** The sim underneath is real: heat, sections, ammo,
   melt. The surface is not po-faced. Humour lives in the hardware (names,
   silhouettes, what happens when things break), in the physics (squash,
   wobble, a WARDEN sitting down when its legs go) and in a cockpit computer
   that is flat about absurd things. Never in walls of text, never at the
   expense of a tense moment.
3. **Readable at a glance.** Flat shading, high-contrast palettes, a HUD that
   tells you heat, damage, target and ammo without reading. A phone player at
   arm's length must be able to parse the screen.
4. **Two thumbs.** Every control fits the touch layout: a floating stick,
   drag to aim, hold-to-fire buttons by category, one punch button. Desktop
   gets more buttons, never more *necessary* buttons.
5. **Depth from systems, not menus.** Heat, melt, ammo, per-section damage,
   knockback, the fusion cannon's trade-off. New depth should come from how
   systems interact in a fight, not from screens between fights.
6. **Say less.** Mission names, one-line briefs, HUD markers, the cockpit
   voice. The world is explained by what you see and what shoots at you.
   A joke that needs a second sentence is cut.
7. **Period-correct.** It should look and sound like it could have shipped in
   1996 on a very good machine. Flat shading, chunky geometry, synthesised
   tones layered under CC0 clips, a monospace HUD. Polygons only: no
   textures, no sprites, no blending; effects are small solid shapes too, and
   the only see-through is a dither. The 3D view renders at about 240 lines in
   big hard-edged pixels: that is the look, not a fallback ([specs/14-look-and-performance.md](specs/14-look-and-performance.md)). Modern niceties are fine
   where invisible (smooth interpolation, high DPI, 60 fps).

## Non-goals

- A full mechlab with critical slots, engine ratings or per-section armour.
- Weapon groups or any control scheme that needs more than two simultaneous
  thumbs and a tap.
- A story with characters, dialogue, cutscenes or branching. Funny is not the
  same as talky.
- Parody. Stompy is its own thing with its own silly names; it does not
  reference other games, memes or the real world.
- Textured or imported art, shadow maps, post-processing.
- Server-authoritative simulation or anti-cheat. The relay validates bounds
  and keeps score; clients are trusted.
- Persistent progression beyond campaign position, unlocked chassis and saved
  loadouts. No currency, no salvage, no XP.
- Native apps. The PWA is the app.

## Reference points

MechWarrior 2 for the cockpit and the heat/damage model. Early Armored Core for
mission brevity and the "one more contract" loop. Kenney's asset style for the
visual register. Katamari Damacy for how far good physics and a straight face
carry a game. Rocket League for hits you feel in your hands. The existing
fusion cannon for the kind of system Stompy wants: a single weapon that
creates a whole decision. The name PURPLE PUNCHER for the kind of name
Stompy wants.

## Tone guide

### Where humour goes

| Place | Yes | No |
|---|---|---|
| Mech and weapon names | PURPLE PUNCHER, BIG BONKER, PEASHOOTER | Names that need explaining, references |
| Silhouettes and animation | Giant fists, a torso that rears back to punch, a mech that sits down when both legs go | Faces, eyes that blink, anything cutesy |
| Physics | Squash on landing, wobble when hit, knockback that sends a JACKAL skidding | Ragdolls, slapstick that breaks readability |
| Cockpit voice | Flat delivery of absurd facts, after the fact: `Target punched.` | Quips during warnings the player must act on; jokes about the player's death that land before the debrief |
| Mission names and briefs | Names in the same silly register as the hardware (the owner's Act I: LIL SNOOZERS, TOWER TOPPLER, HELPLESS LIL BUDDIES, FOUR LEGS BAD). Briefs in the board-book voice (below): `Four little trucks drive down the valley. JACKALs come to catch them. Keep two trucks safe.` | Sober war-film titles; long sentences; winking asides |
| HUD | `OVERWEIGHT`, `PUNCH` | Jokes in instruments that must be read in half a second |
| Debrief | A one-word verdict line (`STOMPED.` / `SQUASHED.`) above the numbers | Prose |

### The board-book voice

Descriptions read like a toddler's board book: *Go, Dog. Go!*, Busytown.
Very action-first, very simple, and describing rather than infantilizing.
It covers mission briefs, mech role lines, menu blurbs and unlock text.
The cockpit voice (below) stays the dry machine.

- **Say what is happening.** Short present-tense sentences with concrete
  verbs: `Two scouts sleep by the road. Wake them up. Knock them down.`
- **Name the things, and say what they do.** Things have jobs: `Three tall
  towers talk and talk.` `IT PUNCHES.`
- **Contrast and repetition are welcome.** Big and little, up and down, one
  two three: `One big mech walks on four legs. Two little mechs walk with it.`
- **Plain imperatives for the player.** `Stomp all three.` `Keep two trucks
  safe.`
- **Not infantilizing.** No baby talk, misspellings, cheering or exclamation
  marks, no questions at the player, no moralising. The game's own words stay:
  JACKAL, relay, LRM. The humour comes from saying silly things plainly.
- **Measurable.** One to four sentences, eight words or fewer each, numbers
  as words, every sentence ending in a full stop (`test/tone.test.js` checks
  every brief and role line).

### The voice

The cockpit computer is a dry, competent machine. It states facts in the
same tone whether the fact is `Reactor online.` or `Leg destroyed. Recommend
hopping.` Rules:

- Warnings the player must act on stay flat and short: `Warning. Heat
  critical.` `Warning. Resonance scan.` No jokes here, ever.
- Dry lines are for resolved events: kills, losses already suffered, mission
  end. At most one dry line per minute; a pool per event, picked by seeded
  random, so they do not repeat in one mission.
- Never a line longer than six words plus a period. Never an exclamation
  mark. Never addresses the player by a name.

Starter pool (the owner edits `src/data/voice.js`; `src/sim/voice.js` does the
picking and the limiting; agents propose additions in a PR's NAMING section):

| Event | Lines |
|---|---|
| Enemy destroyed | `Target destroyed.` · `Target stomped.` · `That one is done.` |
| Enemy destroyed by punch | `Target punched.` · `Fist contact confirmed.` |
| Enemy destroyed by stomp | `Target stomped. Literally.` |
| Own leg destroyed | `Leg destroyed. Recommend hopping.` · `Leg destroyed. Speed is now optional.` |
| Own arm destroyed | `Arm destroyed.` · `Arm destroyed. We have another.` |
| Reactor shutdown | `Reactor shutdown. Please hold.` |
| Reactor online | `Reactor online.` · `Reactor online. Carry on.` |
| Mission complete | `Mission complete.` · `Mission complete. Good stomping.` |
| Mission failed | `Mission failed.` (flat, then the debrief verdict does the humour) |
| New chassis | `New chassis available.` · `New chassis available. It is purple.` (PURPLE PUNCHER only) |

### Who names what

The owner picks names after seeing the thing move, so agents propose and
never decide. Candidates should be sayable in the cockpit voice's flat
delivery, one or two words, and should make the silhouette funnier rather
than explain it. See the naming rules in [workflow.md](workflow.md).

### Tests every string must pass

- Can it be shorter? Make it shorter.
- Is it a proper noun that will never be explained? Keep at most one per
  mission (`Redwater` is the budget so far; drop `the Combine`).
- Would a dry cockpit computer say it? Then the voice says it, in that
  register.
- Would a mission briefing officer say it? Then it is too long.
- Does the joke need the player to know something outside the game? Cut it.
