# Roadmap

Seven milestones. Each is a GitHub milestone with the same name. Work inside a
milestone can mostly run in parallel; the milestones themselves are ordered by
dependency, not by preference. **M0 gates everything**: until the module split
lands, every other change is a merge conflict with it.

```
M0 Foundations ──► M1 Feel & AI ──► M2 Content & Mechlab ──► M3 Campaign ──► M6 Ship
                         │                 │                      ▲
                         └──► M4 Atmosphere ┘                      │
                         └──► M5a LAN polish ──► M5b Co-op ──► M5c Internet
```

Current milestone: **M5b** (M0–M5a shipped, bar the owner's items: M2's balance pass #79, M3's playthrough #114 and naming #115, M4's pixel default #135 and phone budget #166; M5a was #183–#191, M5b issues are #201–#206).

## M0 — Foundations

Goal: the same game, restructured so it can be tested and extended by many
hands. Zero gameplay change. Each step keeps the game playable.

- Module split per [specs/00-module-split.md](specs/00-module-split.md), in the
  staged order given there (pure modules first, then sim with the `game`/`fx`
  objects, then render/HUD/UI/input/net).
- `package.json` with `test`, `lint`, `build`, `serve` scripts; esbuild bundle
  to `dist/`; ESLint flat config; `.gitignore` for `dist/` and `node_modules/`.
- Seeded RNG for the sim ([specs/01-testing.md](specs/01-testing.md)).
- First headless tests: terrain height vs mesh, section routing, heat
  thresholds, melt curve, blast falloff, gait no-slide, protocol round-trip.
- Playwright smoke test using the preinstalled Chromium.
- Python `unittest` for `server.py` (handshake, origin check, message
  handling, round end).
- GitHub Actions: lint + test + build on every PR; deploy `dist/` to GitHub
  Pages on push to `main` (behind a repo setting, so it is harmless until
  hosting is decided).
- Docs: `CLAUDE.md` at the root pointing here; README refreshed (it still
  says every arena pilot flies a KESTREL).

Exit: `npm test` green in CI, `dist/stompy.js` plays identically to today on
desktop and a phone, the playtest checklist passes, and the file structure
matches [architecture.md](architecture.md).

## M1 — Feel, thunk, melee and AI

Goal: the fights feel like Stompy before there are more of them.

- **Thunk pass** ([specs/13-thunk.md](specs/13-thunk.md)): one tunable table
  for all feedback; footfalls with kick, sub-bass and dust scaled by chassis;
  landing squash with a spring; hit wobble on the body and the view; recoil
  that rocks the torso and nudges the mech; knockback; shutdown sag; a death
  with a beat before the collapse; oversized explosions; hum ducking on big
  hits. A REDUCED MOTION setting damps it all.
- **Melee** ([specs/12-melee.md](specs/12-melee.md)): PUNCH on every chassis
  (a shove for most, a real punch for PURPLE PUNCHER when it arrives in M2),
  stomps when landing from jets on a mech, knockback with mass scaling, AI
  that punches back and that keeps out of reach, arena support.
- AI rewrite as per-chassis behaviours with shared utilities
  ([specs/05-ai.md](specs/05-ai.md)): cover and ridgelines, jump jets, focus
  on the damaged section, retreat to cool, light mechs harass, heavies hold
  range, group cohesion. Difficulty setting (EASY / NORMAL / HARD) that scales
  accuracy, awareness and aggression, never HP.
- Hit feedback: section-specific sparks and smoke, armour-plate debris that
  bounces and stays for a while, a short hit-stop on the crosshair.
- Death: multi-stage destruction (torso blows, legs buckle, wreck settles),
  more and heavier debris; a mech that loses both legs sits down before it
  dies.
- Heat feel: the view warps a little above 85 heat, the hum rises, the HUD
  bars flicker before shutdown.
- Target info panel: show the target's section damage diagram and range, and
  a lead indicator for the autocannon.
- Voice: the dry-line pools from the tone guide, with the once-per-minute
  limiter and seeded pick.
- Settings: mouse sensitivity, touch aim sensitivity, field of view, voice
  volume, reduced motion.

Exit: a HARD mission-4 fight is winnable but tense; a tester who plays sixty
seconds says it feels heavy and fun without being prompted; playtesters can
tell a JACKAL from a WARDEN by behaviour alone.

## M2 — Content and mechlab

Goal: more things to fight with and against, and a way to choose.

- Three new chassis ([specs/06-chassis-and-weapons.md](specs/06-chassis-and-weapons.md)):
  PIPSQUEAK (light reverse-joint skirmisher), BEANPOLE (medium forward-joint
  sniper) and PURPLE PUNCHER (assault brawler with fists, the melee chassis).
  Each needs a body plan or a variant of one, meshes, menu entry, AI
  behaviour and a place in the campaign.
- Six new weapons: THUNDERCLAP (PPC), PEPPER LASER (pulse), FIRECRACKERS
  (SRM-6), BIG BONKER (gauss), PEASHOOTER (machine gun), TOASTER (flamer).
  Each maps to an existing category so the controls do not change. The
  original five keep their plain names; renaming them is an open question.
- Mechlab-lite ([specs/02-mechlab.md](specs/02-mechlab.md)): hardpoints per
  chassis with a category and a location; a tonnage budget; three system
  slots (heat sinks, armour, jump jets); loadouts saved per chassis; the
  loadout travels in the arena state message and the server bounds-checks it.
- Free play gains chassis mix and difficulty pickers.

Exit: six chassis selectable, twelve weapons, mechlab usable with two thumbs
in under a minute, arena accepts and renders custom loadouts, and PURPLE
PUNCHER punching a JACKAL off a ridge gets a laugh in a playtest.

## M3 — Campaign

Goal: twelve hand-authored missions with objectives, then contracts.

- Objective framework ([specs/03-objectives.md](specs/03-objectives.md)):
  destroy structures, survive a timer against waves, protect a moving convoy,
  reach an extraction point, plus the existing eliminate. Nav markers on the
  HUD and radar; the cockpit voice announces state changes; a minimal
  objective line top-centre.
- World entities: destructible structures (the outposts become real), convoy
  vehicles with waypoints, nav points, reinforcement triggers.
- The twelve missions ([specs/04-campaign.md](specs/04-campaign.md)) with
  placement data (seed, spawn rings, structure positions, waves), difficulty
  curve, chassis unlocks, and a final mission against the assault chassis.
- Contracts after mission twelve pick an objective type too.
- Debrief shows objective results; campaign screen shows a twelve-slot strip.
- After the strip (#106) and before Acts II–III: the look-and-performance
  groundwork from [specs/14-look-and-performance.md](specs/14-look-and-performance.md)
  (perf harness, instanced effects with a shape per kind, particle pool,
  allocation diet, the 240-line pixelated look by default, dither fades).

Exit: campaign playable end to end on desktop and phone in about two hours,
every objective type used at least twice, no text longer than two sentences.

## M4 — Atmosphere

Goal: the same places feel different each time. Runs in parallel with M2/M3
once M0 is in.

- Time of day: night variants of each palette with headlights (one spotlight
  in the shader) and a brighter IR mode; dusk/dawn tints.
- Weather ([specs/07-atmosphere.md](specs/07-atmosphere.md)): rain, snow, dust
  storm, fog bank, lightning, wind on smoke. Weather changes visibility and
  radar range, which the AI respects.
- Props and buildings: a prop library (towers, tanks, pipes, walls, bunkers,
  antennas) placed by the terrain generator per biome, frustum-culled,
  optionally destructible (ties into M3 structures).
- Explosions: shockwave ring, more debris, scorch quads on terrain, persistent
  burning wrecks with a smoke column, delayed secondary pops.
- Particle system rework: one instanced draw, a hard cap, LOD by distance.
  The look and the performance plan behind it (instanced effects, a
  particle pool, one draw per mech, a PIXELS setting, culling, a perf
  harness) are in [specs/14-look-and-performance.md](specs/14-look-and-performance.md).
- Ambient audio bed per biome and weather.

Exit: a night dust-storm mission on the volcanic plain holds the frame budget
on the 2021 phone with six mechs.

## M5a — LAN arena polish

Goal: the arena is a feature you would show someone, not a demo.

- Configurable relay URL (query parameter, settings field, `localStorage`),
  defaulting to today's behaviour.
- Lobby: who is connected before you launch, their chassis and colour, ping.
- Team deathmatch and a map/mode vote at round end.
- Spectator camera while dead, kill feed, end-of-round summary.
- Fix the duplicate `sp` key in the state message; add a protocol version to
  `hello` so old clients get a clear message.
- Reconnect without losing your score for 30 s.
- Server: bounds-check loadouts, rate-limit `fx`, log to a file, systemd unit
  example.

Spec: [specs/08-lan-polish.md](specs/08-lan-polish.md).

## M5b — Co-op campaign

Goal: two to four pilots fly campaign or free-play missions together.

- Host-authoritative AI and objectives: the host client runs `think()` and
  objective state and relays enemy state; guests send hits on enemies to the
  host. Spec: [specs/09-coop.md](specs/09-coop.md).
- Rooms on the relay (a room per host) so a co-op game and the arena can
  share one server.
- Mission difficulty scales enemy count with pilot count, never enemy HP.
- Shared debrief; campaign progress saved on every client.

## M5c — Internet play

Goal: play with someone who is not on your Wi-Fi.

- Room codes, a public relay behind TLS, the client speaks `wss://` when the
  page is `https://`.
- Hosting recommendation and scripts (Caddy reverse proxy in front of the
  Python relay on one small VPS; GitHub Pages for the site). Spec:
  [specs/10-internet-play.md](specs/10-internet-play.md).
- Latency: wider interpolation window, lag indicator, shot-origin tolerance.
- Abuse limits: per-IP connection cap, message rate limits, name filter.

## M6 — Ship

Goal: it is a product.

- PWA: manifest, service worker caching the bundle and sounds, installable,
  offline single player.
- Gamepad support on desktop and phones (standard mapping).
- Mission 1 as a silent tutorial: HUD prompts that appear once and never
  again, in the house voice (`W: GO. S: LESS GO.`).
- Accessibility pass: colour-blind-safe radar and section colours, HUD scale
  setting, reduced-motion setting.
- Performance pass against the budget table; load-time pass.
- Deploy: one workflow for Pages, one zip for itch.io, a tagged release.
- Final README and credits.

Spec: [specs/11-release.md](specs/11-release.md).

## What is deliberately not scheduled

See the non-goals in [vision.md](vision.md). Also not scheduled, pending a
decision from the owner: music (the game has none; a short synthesised menu
loop would fit the register), renaming the original five weapons to match the
new ones, AI use of the fusion cannon (today never; a
HARD-only boss use is proposed in specs/05-ai.md as an open question), and a
replay/ghost system (determinism makes it cheap later).
