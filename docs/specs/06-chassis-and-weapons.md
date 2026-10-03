# New chassis and weapons

| | |
|---|---|
| Status | in progress (#65 THUNDERCLAP, #66 PEPPER LASER, #67 FIRECRACKERS shipped; names and numbers are proposals; PURPLE PUNCHER is confirmed) |
| Milestone | M2 |
| Size | L (each chassis is an M issue; each weapon an S issue) |
| Depends on | M0; AI profiles from [05-ai.md](05-ai.md); melee from [12-melee.md](12-melee.md) for PURPLE PUNCHER |
| Touch parity | no new controls; every weapon maps to an existing category |

## Summary

Three new chassis to round out light, long-range and assault-brawler roles,
and six new weapons spread across the three categories so that mechlab-lite
has real choices. Everything is built the way the existing three are: a body
plan in `GEO`, hand-built flat-shaded parts, a profile for the AI. Names are
toy-line, not field-manual: the register the game is called Stompy in.

## Naming

The owner names things after seeing them. Every name below except PURPLE
PUNCHER is a placeholder so the spec reads well. Build each chassis and
weapon under its **key** (left column), give it a plain working label in
`src/data/names.js`, and end the PR that makes it visible with a NAMING
section (turntable and combat screenshots, a personality line, three to five
candidates). Rules in [../workflow.md](../workflow.md). Candidates should be
readable at a glance, reference nothing outside the game, and be funnier in
the cockpit voice's flat delivery. The existing five weapons keep their
plain names until the owner decides otherwise.

## Weapons

Numbers are a starting point for balance issues; `tons` and `fp` are for
mechlab. Categories never change, so no new buttons.

| Key | Placeholder name | Cat | Kind | Numbers | Tons | Character |
|---|---|---|---|---|---|---|
| `ppc` | THUNDERCLAP | energy | `bolt` (new) | dmg 14, heat 11, cd 3.5, range 600, speed 420 | 7 | A slow blue bolt with a crack of thunder. Big heat. Its hit scrambles the target's HUD for 1.5 s (radar and target box flicker) and gives a strong wobble kick. |
| `plaser` | PEPPER LASER | energy | `beam` | dps 2.6, hps 8, range 300, melts 1.5× faster | 3 | Short range melt specialist. Stuttering beam (width flickers at 12 Hz) with a sizzle. |
| `srm` | FIRECRACKERS | missile | `missile` | dmg 2.6 ×6, heat 4, cd 3, range 260, speed 160, ammo 18 volleys, no homing | 3 | Dumb-fire spread that pops. Hold-to-guide works on it too. Small knockback per hit. |
| `gauss` | BIG BONKER | ballistic | `shell` | dmg 20, heat 1, cd 3.2, range 800, speed 700, ammo 12 | 12 | The sniper's gun. Loud, bright tracer, heavy recoil that rocks the shooter back a step, and a knockback on the target worth a shove. |
| `mg` | PEASHOOTER | ballistic | `shell`, burst | dmg 0.8 per round, 6 rounds per 0.3 s burst, heat 0.2, cd 0.5, range 220, ammo 60 bursts | 1 | Strips a melted section fast. Tracers, a rattle, no respect. |
| `flamer` | TOASTER | energy | `beam` | dps 0.8, hps 3, range 90, adds 6 heat/s to the target | 1.5 | Forces shutdowns at knife range. Orange cone of fire particles. A shut-down enemy is a punchable enemy. |

New weapon kinds in code: `bolt` is a `shell` with its own mesh colour and an
on-hit callback (`onHit(target)` → scramble, wobble); `beam` gains optional
`meltRate` and `targetHeat`; `shell` gains optional `burst: { n, dt }` and
`knock` (m/s applied through `push`).

Existing weapons get `tons`: `laser` 5, `mlaser` 2, `ac` 8, `lrm` 6.

## Chassis

Chassis keys: `puncher`, `light1`, `sniper1`. Only `puncher` has its name.

### PURPLE PUNCHER (`puncher`) — assault brawler (unlock after mission 11)

The mech the game is named after, more or less. Purple. Fists. The one
confirmed name in this document.

| | |
|---|---|
| Legs | `forward` variant: thick, `hip 5.0`, `l1 2.6, l2 2.6`, `stride [3.0, 3.4]`, heavy footfalls (nearby mechs feel them) |
| Scale | 1.3 |
| Speed / turn | 9 / 0.6 |
| Sink | 12 |
| Jets | none stock (system slot allows level 1: a jumping PURPLE PUNCHER is a stomp delivery system) |
| HP | T 110, LA 50, RA 50, LL 60, RL 60 |
| Colours | `col [0.45, 0.22, 0.6]`, `acc [0.95, 0.75, 0.2]` (purple with yellow knuckles) |
| Melee | the real punch block from [12-melee.md](12-melee.md): dmg 30, reach 14×scale, knock 22, stomp 18 |
| Hardpoints | T ballistic (AUTOCANNON), T missile (FIRECRACKERS). Arms carry fists, not hardpoints. |
| Tons | 80 (the fists are free; its guns are modest) |
| Look | Boxy torso wider than tall, shoulders like a fridge, two oversized fists on short thick arms (separate `buildFist` parts so they swing), a low cockpit slit, flat head. It should read as "that one punches" from 400 m. |
| AI | `brawler`: closes to reach using the cannon on the way, punches, never retreats, alpha below 40% torso. Stomps if it has jets. |
| Menu role line | `ASSAULT · IT PUNCHES` |

Its arrival in mission 10 is the campaign's set piece: a shape on the ridge
that is the wrong colour, then the footfalls.

### `light1` (placeholder PIPSQUEAK) — light reverse-joint skirmisher (unlock after mission 6)

| | |
|---|---|
| Legs | `reverse` variant: `l1 2.4, l2 2.9`, hip lower, longer stride, `swing 0.46` |
| Scale | 0.8 |
| Speed / turn | 22 / 1.9 |
| Sink | 8 |
| Jets | fuel 1.5×, climb 1.2× (stock jets level 2) |
| HP | T 28, LA 12, RA 12, LL 16, RL 16 |
| Hardpoints | LA missile (FIRECRACKERS), RA energy (MED LASER), T ballistic (PEASHOOTER) |
| Tons | 25 |
| Look | Narrow torso, long shins, FIRECRACKERS box on the left shoulder, a single eye slit. Hops more than it walks. |
| AI | `harass` with FIRECRACKERS; stomps from above; breaks off at 50% torso; gets shoved a very long way |
| Menu role line | `REVERSE-JOINT · SMALL, RUDE` |

### `sniper1` (placeholder BEANPOLE) — medium forward-joint sniper (unlock after mission 8)

| | |
|---|---|
| Legs | `forward` variant: taller, `hip 5.4`, `l1 3.0, l2 2.8` |
| Scale | 1.0 |
| Speed / turn | 13 / 0.9 |
| Sink | 11 |
| Jets | none (jets slot allows level 1 at 1.5 t) |
| HP | T 60, LA 26, RA 26, LL 36, RL 36 |
| Hardpoints | RA ballistic (BIG BONKER), LA energy (THUNDERCLAP), T energy (MED LASER) |
| Tons | 50 |
| Look | Long barrel arm, a tall sensor mast on the torso, narrow stance; the gauss recoil visibly rocks it on its stilts. |
| AI | `ridge`; relocates after three shots; keeps out of punching range of everything |
| Menu role line | `FORWARD-JOINT · LONG GUN, LONG LEGS` |

### Existing three, role lines refreshed

- KESTREL: `REVERSE-JOINT · DOES A BIT OF EVERYTHING`
- JACKAL: `FORWARD-JOINT · FAST, FLIMSY`
- WARDEN: `QUADRUPED · SLOW, STUBBORN`

### Body plan mechanics

`GEO` gains per-chassis overrides: a chassis may name `legs: 'forward'` and a
`geo: { hip, l1, l2, stride, swing }` partial that `geoOf(m)` merges. The
mesh builders already size legs from `l1`/`l2`; torso and arm builders take a
`style` string per chassis for the distinct silhouettes (`buildTorso(ch)`
with a switch; `buildFist` for PURPLE PUNCHER). Keep each chassis's parts
under 700 triangles.

Footfall feedback scales with `scale²` per the feel table; PURPLE PUNCHER's
steps are felt by anyone within 40 m.

## Menu

`MECH_ORDER` becomes the unlock-aware list; locked chassis show as a dark
silhouette with `LOCKED` in the role line, cycle-able but not launchable.
PURPLE PUNCHER's silhouette is still purple when locked (the one exception,
on purpose).

## Arena

Chassis already travel in `ch`. Add the three to `CHASSIS`; the server's
allow-list (M5a adds one) includes them. Balance in free-for-all is by
tonnage honesty: PURPLE PUNCHER is slow enough to be fusion-scanned and
kited, and devastating if you let it close.

## Code touchpoints

- `src/data/weapons.js`, `chassis.js`, `geo.js`, `src/data/systems.js`,
  `src/data/feel.js` rows for the new weapons.
- `src/sim/combat.js`: `bolt` kind, bursts, `onHit`, shell `knock`; target
  heat from beams in `beams.js`.
- `src/sim/mech.js`: HUD scramble timer (`m.scramble`).
- `src/render/hud.js`: scramble effect (radar blips jitter, target box
  dropped while `scramble > 0`); tracers for PEASHOOTER/BIG BONKER in
  `scene.js`.
- `src/mesh/mechParts.js`: three builders or styles plus fists.
- `src/audio/sfx.js`: `thunderclap`, `bonker`, `peashooter`, `toaster`
  recipes from existing clips plus synthesis (no new assets needed; note
  which clips).
- `src/ui/menu.js`: locked state, role lines.

## Acceptance criteria

1. Each chassis walks with no foot slide at all throttles, on slopes, and
   after a jump landing (gait test parameterised over all six chassis).
2. Each weapon fires from the player and from the AI, is drawn, makes a
   sound, has its feel-table row, and hits a target in a headless test with
   the expected damage.
3. THUNDERCLAP scramble lasts 1.5 s and is visible on the HUD; TOASTER
   raises target heat at 6/s; PEASHOOTER fires 6 rounds per burst; PEPPER
   LASER reaches full melt in 2 s; BIG BONKER knocks a JACKAL ≥ 3 m (tests).
4. PURPLE PUNCHER's punch uses its own melee block; with one arm destroyed
   it still punches at full strength; with both, it shoves (test).
5. Menu shows six chassis with unlock state; the three new ones render in the
   menu at the right framing on phone and desktop (screenshots). PURPLE
   PUNCHER is unmistakably purple and unmistakably has fists at menu scale.
6. `MECH_INFO.fire` bars and mechlab stats are consistent with the tables.
7. Arena: two clients, one in each new chassis, see each other correctly.

## Performance

Three more part sets in GPU memory (negligible). Bursts add shells: cap live
shells at 200, oldest dropped silently.

## Open questions

- Names: decided by the owner from each chassis's and weapon's NAMING
  section once it is visible. Nothing here is fixed except PURPLE PUNCHER.
- Renaming the original five to match (`needs-owner`): LG LASER → BIG ZAPPER,
  MED LASER → ZAPPER, AUTOCANNON → THUMPER, LRM-10 → TEN PACK, FUSION CANNON
  stays (it is the serious one, which is the joke). Default: leave them until
  the owner picks.
- Should PURPLE PUNCHER lack the fusion cannon? Default: it has it; a mech
  that can punch you or dissolve you is a good villain.
