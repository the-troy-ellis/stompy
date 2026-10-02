# Backlog, as GitHub issues

Ready to file. Each entry: title, labels, size, spec link, body. Milestones
match [roadmap.md](roadmap.md). Labels to create first:

- Areas: `area:sim`, `area:render`, `area:hud`, `area:ui`, `area:audio`,
  `area:ai`, `area:net`, `area:server`, `area:content`, `area:tooling`,
  `area:docs`.
- Platform: `platform:touch` (needs real-phone verification beyond the
  checklist), `platform:desktop`.
- Size: `size:S`, `size:M`, `size:L`.
- State: `blocked`, `needs-owner` (an open question must be answered first),
  `good-first-issue`.

Body template for every issue:

```
Spec: docs/specs/<file>#<section>
Depends on: #<n>, #<m>
Done when: <the acceptance criteria numbers from the spec that this issue covers>
Notes: <anything specific to this slice>
```

Once filed, mark each entry below with its issue number so the specs can link
to it.

---

## M0 — Foundations

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M0: tooling, package.json, lint, build, gitignore | tooling | S | 00 §Stage 1 |
| | M0: extract pure leaf modules (math, store, dom, builder, data, terrain, mech parts) | tooling, sim | S | 00 §Stage 1 |
| | M0: first tests (terrain, math, data) | tooling | S | 00 §Stage 1, 01 |
| | M0: createGame, seeded RNG, fx sink; thread game/fx through the sim | sim, tooling | M | 00 §Stage 2 |
| | M0: move the sim into src/sim (mech, gait, combat, beams, fusion, missiles, ai, update) | sim | M | 00 §Stage 3 |
| | M0: sim unit tests (combat, mech, beams, gait, missiles, fusion, ai, update) | sim, tooling | M | 00 §Stage 3 |
| | M0: move render, HUD, audio, UI, input into modules; main.js under 300 lines | render, hud, ui, audio | M | 00 §Stage 4 |
| | M0: Playwright smoke test and static server script | tooling | S | 01 |
| | M0: move net client and protocol; protocol round-trip tests; PROTOCOL=1 in hello | net | S | 00 §Stage 5 |
| | M0: move server.py to server/, add unittest coverage | server | S | 00 §Stage 5 |
| | M0: GitHub Actions CI (lint, test, build, smoke, python) and gated Pages deploy | tooling | S | 01 §CI |
| | M0: debug readout behind ?debug=1 (frame time, draws, particles, seed) | hud, tooling | S | 01 §In-game diagnostics |
| | M0: README refresh (arena chassis note, docs link) and CLAUDE.md | docs | S | roadmap §M0 |
| | M0: ESLint rule forbidding DOM/render imports from src/sim and src/data | tooling | S | 00 §Acceptance 4 |

## M1 — Feel, thunk, melee and AI

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M1: feel table (data/feel.js), spring helper, FEEL debug panel | sim, render, tooling | S | 13 §Feel table |
| | M1: footfalls and landing squash with scale, dust, bass, haptics | sim, render, audio, platform:touch | M | 13 §Pass |
| | M1: hit wobble (body and view), recoil, muzzle flash | sim, render | M | 13 §Pass |
| | M1: shutdown sag, restart overshoot, HUD dim and hum duck | sim, render, hud, audio | S | 13 §Pass |
| | M1: section loss as debris; limp with one leg; sit down with none and keep firing | sim, render | M | 13 §Pass |
| | M1: death beat and topple | sim, render | S | 13 §Pass |
| | M1: sub-bass thump voice and hum ducking | audio | S | 13 §Audio layer |
| | M1: REDUCED MOTION and HAPTICS settings | ui | S | 13 §Reduced motion |
| | M1: knockback (push field, mass scaling, blast knockback) | sim | S | 12 §Knockback |
| | M1: shove and stomp (resolution, recover state, feedback) | sim, render, audio | M | 12 §Punch resolution, §Stomp |
| | M1: PUNCH input: E / mouse 4 / touch button / fist icon | ui, hud, platform:touch | S | 12 §Player experience |
| | M1: melee in the arena (pu, kb, me, st; server clamps) | net, server | S | 12 §Arena |
| | M1: AI punches and reach avoidance | ai | S | 12 §AI |
| | M1: voice line pools with once-per-minute limiter and seeded pick | audio | S | vision §The voice |
| | M1: AI perception (line of sight, last-known position, shout, search) | ai, sim | M | 05 §Perception |
| | M1: AI behaviour library (keepRange, useCover, ridge, harass, holdLine, avoid*) | ai, sim | M | 05 §Movement |
| | M1: AI fire discipline and section targeting | ai, sim | S | 05 §Fire discipline |
| | M1: per-chassis AI profiles for KESTREL, JACKAL, WARDEN | ai, content | S | 05 §Profiles |
| | M1: group behaviour (shared awareness, focus, flank) | ai, sim | S | 05 §Group |
| | M1: difficulty setting (EASY/NORMAL/HARD) in settings and Free Play | ui, ai | S | 05 §Difficulty |
| | M1: AI debug overlay | hud | S | 05 §Debug |
| | M1: hit feedback (section sparks, plate debris, crosshair hit-stop, shake by section) | render, hud | M | roadmap §M1 |
| | M1: multi-stage mech destruction | render, sim | M | roadmap §M1 |
| | M1: walking feel (footfall dust, slope slowdown, landing dig-in) | sim, render | S | roadmap §M1 |
| | M1: heat feel (view warp over 85, hum, HUD flicker) | render, hud, audio | S | roadmap §M1 |
| | M1: target info panel with section diagram and autocannon lead indicator | hud | S | roadmap §M1 |
| | M1: settings: mouse/touch sensitivity, FOV, voice volume | ui, platform:touch | S | roadmap §M1 |
| | M1: in-game frame-time readout toggle in settings | hud | S | 01 |

## M2 — Content and mechlab

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M2: hardpoints, tonnage and systems data; loadout validate/apply/stats | sim, content | M | 02 §Data |
| | M2: FIT screen (mechlab UI) with live mech preview | ui, platform:touch | M | 02 §Player experience |
| | M2: loadout in the arena state message; server-side validation with parity fixture | net, server | S | 02 §Arena |
| | M2: weapon THUNDERCLAP (bolt kind, HUD scramble, wobble) | sim, hud, content | S | 06 §Weapons |
| | M2: weapon PEPPER LASER (meltRate) | sim, content | S | 06 |
| | M2: weapon FIRECRACKERS (dumb-fire volley, small knockback) | sim, content | S | 06 |
| | M2: weapon BIG BONKER (tracer, recoil, knockback) | sim, render, content | S | 06 |
| | M2: weapon PEASHOOTER (bursts, tracers, shell cap) | sim, render, content | S | 06 |
| | M2: weapon TOASTER (target heat, cone particles) | sim, render, content | S | 06 |
| | M2: GEO per-chassis overrides and torso/arm styles in mech parts | render, sim | S | 06 §Body plan mechanics |
| | M2: chassis PURPLE PUNCHER (plan, fists, mesh, brawler profile, real punch, menu) | content, render, ai, sim | L | 06 §PURPLE PUNCHER, 12 |
| | M2: chassis PIPSQUEAK | content, render, ai | M | 06 §PIPSQUEAK |
| | M2: chassis BEANPOLE | content, render, ai | M | 06 §BEANPOLE |
| | M2: unlock-aware mech selector with LOCKED state and new role lines | ui | S | 06 §Menu |
| | M2: KNUCKLES system slot for PURPLE PUNCHER | sim, ui | S | 02 §Data |
| | M2: Free Play pickers for chassis mix and difficulty | ui | S | roadmap §M2 |
| | M2: sfx recipes for the six new weapons from existing clips | audio | S | 06 |
| | M2: balance pass on all twelve weapons and six chassis (with notes) | content, needs-owner | M | 06 |

## M3 — Campaign

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M3: entities (structure, vehicle, nav): data, step, hit-test, damage, draw | sim, render | M | 03 §Entities |
| | M3: prop meshes needed by missions (relay, tank, truck, launcher, pad) | render, content | S | 03, 07 §Props |
| | M3: objective framework and ELIMINATE/DESTROY | sim | M | 03 §State machine |
| | M3: SURVIVE with waves | sim, ai | S | 03 §Waves |
| | M3: ESCORT (convoy movement, blocking, AI preference) | sim, ai | M | 03 |
| | M3: EXTRACT with optional timer; extra flat zones in terrain | sim | S | 03 |
| | M3: objective HUD line, markers, radar blips, voice lines | hud, audio | S | 03 §Player experience |
| | M3: debrief with per-objective results | ui | S | 03 |
| | M3: turret entity (mission 9 launchers) | sim, content | S | 04 §Code touchpoints |
| | M3: campaign strip, replay, unlocks, REALLY? confirm-restart | ui | S | 04 §Progression |
| | M3: debrief verdict words | ui | S | 04 §Debrief verdicts |
| | M3: mission 10 PURPLE PUNCHER entrance (reveal wave entry) | content, sim | S | 04 §Code touchpoints |
| | M3: missions 1–4 (Act I) | content | M | 04 |
| | M3: missions 5–8 (Act II) | content | M | 04 |
| | M3: missions 9–12 (Act III) | content | M | 04 |
| | M3: contracts after 12 with objective types and full roster | content, sim | S | 04 §After twelve |
| | M3: scripted "perfect player" harness and win/fail tests for all twelve | tooling, sim | S | 04 §Acceptance 1 |
| | M3: full NORMAL playthrough report (time, attempts, text audit) | content, docs | S | 04 §Acceptance 2–4 |

## M4 — Atmosphere

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M4: palette night/dawn variants and time ramps | render, content | S | 07 §Time of day |
| | M4: headlights (spotlight uniform, lamp quads, L key / LIGHTS button, AI sight) | render, sim, hud, platform:touch | M | 07 §Headlights |
| | M4: instanced particle path with fallback and caps | render | M | 07 §Particle system |
| | M4: weather state, factors, wind; Free Play WEATHER/TIME pickers | sim, ui | S | 07 §Weather |
| | M4: rain and lightning | render, audio | S | 07 |
| | M4: snow and fog | render | S | 07 |
| | M4: dust storm | render, sim | S | 07 |
| | M4: prop library | render, content | M | 07 §Props |
| | M4: prop placement per biome; frustum and distance culling | render, sim | M | 07 §Props |
| | M4: explosions: shockwave, plates, scorch, secondaries, burning glow | render, sim | M | 07 §Explosions |
| | M4: ambient audio beds per biome and weather | audio | S | 07 §Ambient |
| | M4: particles LOW/MED/HIGH setting; reduced-motion hook | ui, render | S | 07, 11 |
| | M4: frame budget verification on reference phones (worst case) | tooling, docs | S | 07 §Acceptance 6 |

## M5a — LAN arena polish

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M5a: protocol v2: version check, sq rename, validation, fx rate limit | net, server | S | 08 §Protocol |
| | M5a: configurable relay URL (query, setting, default) | net, ui | S | 08 §Relay URL |
| | M5a: lobby with pilot list, ping, READY | ui, net, server | M | 08 §Lobby |
| | M5a: team deathmatch | server, net, sim | M | 08 §Modes |
| | M5a: round-end summary and vote | ui, server | S | 08 §Vote |
| | M5a: spectator camera | render, hud | S | 08 §Spectate |
| | M5a: reconnect with score token | net, server | S | 08 §Reconnect |
| | M5a: kill feed | hud | S | 08 §Kill feed |
| | M5a: server flags, logging, systemd unit, per-IP cap, fuzz test | server | S | 08 §Server operations |

## M5b — Co-op

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M5b: rooms on the relay (codes, host, succession, GC, routing) | server | M | 09 §Rooms |
| | M5b: role in game state; host-authoritative enemies (es, ehit, fx routing) | net, sim | L | 09 §Authority |
| | M5b: entity and objective sync (ent, entx, obj, over) | net, sim | M | 09 |
| | M5b: co-op UI: HOST/JOIN, lobby mission info, shared debrief, progress save | ui | M | 09 §UI |
| | M5b: scaling with pilot count; co-op respawn rules | sim | S | 09 §Scaling, §Death |
| | M5b: in-memory fake relay and host/guest convergence test | tooling, net | M | 09 §Acceptance 6 |

## M5c — Internet

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M5c: origins allow-list, /health, limits, admin kick | server | S | 10 |
| | M5c: deploy kit: Caddyfile, systemd, deploy.sh, Dockerfile, README | server, docs | S | 10 §Hosting |
| | M5c: interpolation delay buffer and RTT/LAG readout | net, hud | M | 10 §Latency |
| | M5c: private arena rooms by code | server, ui | S | 10 §Room codes |
| | M5c: RELAY_DEFAULT build define and Pages wiring | tooling | S | 10 |
| | M5c: cross-network playtest report | docs, needs-owner | S | 10 §Acceptance 1 |

## M6 — Ship

| # | Title | Labels | Size | Spec |
|---|---|---|---|---|
| | M6: PWA manifest, icons script, service worker, update line | tooling, ui | M | 11 §PWA |
| | M6: gamepad input | ui, platform:touch, platform:desktop | M | 11 §Gamepad |
| | M6: silent tutorial in mission 1 | hud, ui | M | 11 §Silent tutorial |
| | M6: HUD scale and colour modes | hud | M | 11 §Accessibility |
| | M6: reduced motion; grouped, scrollable settings screen | ui | S | 11 |
| | M6: performance pass (offscreen dashboard, terrain chunks, lazy sounds) | render, hud, audio | M | 11 §Performance pass |
| | M6: release tooling: zip, tag deploy, GitHub Release notes, version footer | tooling | S | 11 §Deploy |
| | M6: README rewrite and credits | docs | S | 11 |

## Unscheduled / needs-owner

| Title | Labels | Note |
|---|---|---|
| Music: synthesised menu loop | audio, needs-owner | Not in scope until asked. |
| AI fusion cannon on HARD assault | ai, needs-owner | Proposal in 05 §Open questions. |
| Replays from the seeded sim | sim, tooling | Cheap after M0; no player demand yet. |
| Chassis names (PIPSQUEAK/BEANPOLE) and mission names/briefs/verdicts | content, needs-owner | Proposals in 06 and 04; PURPLE PUNCHER is fixed. |
| Rename the original five weapons (BIG ZAPPER, THUMPER, TEN PACK…) | content, needs-owner | Proposal in 06 §Open questions. |
