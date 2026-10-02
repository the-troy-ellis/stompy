# Vision

## One line

Stompy is a 90s-style mech sim you can play in a browser tab or on a phone
held sideways: slow, heavy machines, heat that matters, legs and torso that
turn apart, and a cockpit computer that reads out the bad news.

## What finished looks like

- A **twelve-mission campaign** across three biomes (dusk desert, glacier,
  volcanic plain) plus night and weather variants, with objectives beyond
  "kill everything": destroy a structure, survive a timer, protect a convoy,
  reach an extraction point. After mission twelve, open contracts continue
  procedurally.
- **Six chassis** across light, medium, heavy and assault, each with a
  distinct body plan, silhouette and role. The three that exist (KESTREL,
  JACKAL, WARDEN) plus three new ones.
- **A dozen weapons** across the three fire categories (energy, ballistic,
  missile) plus the fusion cannon, and a **mechlab-lite** screen to fit them
  into category-locked hardpoints under a tonnage budget.
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

1. **Weight.** Everything in Stompy is heavy. Mechs accelerate slowly, turn
   slowly, land hard. Weapons have recoil, recharge and heat. Nothing is
   instant. If a feature makes the game feel lighter or twitchier, it is wrong
   for Stompy.
2. **Readable at a glance.** Flat shading, high-contrast palettes, a HUD that
   tells you heat, damage, target and ammo without reading. A phone player at
   arm's length must be able to parse the screen.
3. **Two thumbs.** Every control fits the touch layout: a floating stick, drag
   to aim, hold-to-fire buttons by category. Desktop gets more buttons, never
   more *necessary* buttons.
4. **Depth from systems, not menus.** Heat, melt, ammo, per-section damage,
   the fusion cannon's trade-off. New depth should come from how systems
   interact in a fight, not from screens between fights.
5. **Say less.** Mission names, one-line briefs, HUD markers, the cockpit
   voice. The world is explained by what you see and what shoots at you.
6. **Period-correct.** It should look and sound like it could have shipped in
   1996 on a very good machine. Flat shading, chunky geometry, synthesised
   tones layered under CC0 clips, a monospace HUD. Modern niceties are fine
   where invisible (smooth interpolation, high DPI, 60 fps).

## Non-goals

- A full mechlab with critical slots, engine ratings or per-section armour.
- Weapon groups or any control scheme that needs more than two simultaneous
  thumbs and a tap.
- A story with characters, dialogue, cutscenes or branching.
- Textured or imported art, shadows maps, post-processing.
- Server-authoritative simulation or anti-cheat. The relay validates bounds
  and keeps score; clients are trusted.
- Persistent progression beyond campaign position, unlocked chassis and saved
  loadouts. No currency, no salvage, no XP.
- Native apps. The PWA is the app.

## Reference points

MechWarrior 2 for the cockpit and the heat/damage model. Early Armored Core for
mission brevity and the "one more contract" loop. Kenney's asset style for the
visual register. The existing fusion cannon for the kind of system Stompy
wants: a single weapon that creates a whole decision.

## Tone guide for text

Every string in the game should pass these tests:

- Can it be shorter? Make it shorter.
- Is it a proper noun that will never be explained? Keep at most one per
  mission (`Redwater`, `the Combine` are the budget so far).
- Would a cockpit computer say it? Then the voice says it, in that register:
  `Reactor shutdown.` `Target destroyed.` `Objective complete.`
- Would a mission briefing officer say it? Then it is too long.

Mission briefs are one sentence, at most two. Mission names are one or two
words. Debrief shows numbers, not prose.
