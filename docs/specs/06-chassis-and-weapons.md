# New chassis and weapons

| | |
|---|---|
| Status | draft (names and numbers are proposals) |
| Milestone | M2 |
| Size | L (each chassis is an M issue; each weapon an S issue) |
| Depends on | M0; AI profiles from [05-ai.md](05-ai.md) for the enemy versions |
| Touch parity | no new controls; every weapon maps to an existing category |

## Summary

Three new chassis to round out light, medium-long-range and assault roles,
and six new weapons spread across the three categories so that mechlab-lite
has real choices. Everything is built the way the existing three are: a body
plan in `GEO`, hand-built flat-shaded parts, a profile for the AI.

## Weapons

Numbers are a starting point for balance issues; `tons` and `fp` are for
mechlab. Categories never change, so no new buttons.

| Key | Name | Cat | Kind | Numbers | Tons | Character |
|---|---|---|---|---|---|---|
| `ppc` | PPC | energy | `bolt` (new) | dmg 14, heat 11, cd 3.5, range 600, speed 420 | 7 | A slow blue bolt. Big heat. Its hit scrambles the target's HUD for 1.5 s (radar and target box flicker). |
| `plaser` | PULSE LASER | energy | `beam` | dps 2.6, hps 8, range 300, melts 1.5× faster | 3 | Short range melt specialist. Stuttering beam visual (width flickers at 12 Hz). |
| `srm` | SRM-6 | missile | `missile` | dmg 2.6 ×6, heat 4, cd 3, range 260, speed 160, ammo 18 volleys, no homing | 3 | Dumb-fire spread. The hold-to-guide works on it too. |
| `gauss` | GAUSS RIFLE | ballistic | `shell` | dmg 20, heat 1, cd 3.2, range 800, speed 700, ammo 12 | 12 | The sniper's gun. Loud, bright tracer, heavy recoil kick. |
| `mg` | MACHINE GUN | ballistic | `shell`, burst | dmg 0.8 per round, 6 rounds per 0.3 s burst, heat 0.2, cd 0.5, range 220, ammo 60 bursts | 1 | Strips a melted section fast. Tracers. |
| `flamer` | FLAMER | energy | `beam` | dps 0.8, hps 3, range 90, adds 6 heat/s to the target | 1.5 | Forces shutdowns at knife range. Orange cone of fire particles. |

New weapon kinds in code: `bolt` is a `shell` with its own mesh colour and an
on-hit callback (`onHit(target)` → scramble); `beam` gains optional
`meltRate` and `targetHeat`; `shell` gains optional `burst: { n, dt }`.

Existing weapons get `tons`: `laser` 5, `mlaser` 2, `ac` 8, `lrm` 6.

## Chassis

Three new body plans or variants. Names follow the bird/animal register.

### MANTIS — light reverse-joint skirmisher (unlock after mission 6)

| | |
|---|---|
| Legs | `reverse` variant: `l1 2.4, l2 2.9`, hip lower, longer stride, `swing 0.46` |
| Scale | 0.8 |
| Speed / turn | 22 / 1.9 |
| Sink | 8 |
| Jets | fuel 1.5×, climb 1.2× (stock jets level 2) |
| HP | T 28, LA 12, RA 12, LL 16, RL 16 |
| Hardpoints | LA missile (SRM-6), RA energy (MED LASER), T ballistic (MG) |
| Tons | 25 |
| Look | Narrow torso, long shins, SRM box on the left shoulder, a single eye slit. |
| AI | `harass` with SRMs; breaks off at 50% torso |

### HERON — medium forward-joint sniper (unlock after mission 8)

| | |
|---|---|
| Legs | `forward` variant: taller, `hip 5.4`, `l1 3.0, l2 2.8` |
| Scale | 1.0 |
| Speed / turn | 13 / 0.9 |
| Sink | 11 |
| Jets | none (level 0; jets slot allows level 1 at 1.5 t) |
| HP | T 60, LA 26, RA 26, LL 36, RL 36 |
| Hardpoints | RA ballistic (GAUSS), LA energy (PPC), T energy (MED LASER) |
| Tons | 50 |
| Look | Long barrel arm, a tall sensor mast on the torso, narrow stance. |
| AI | `ridge`; relocates after three shots |

### BISON — assault forward-joint (unlock after mission 11)

| | |
|---|---|
| Legs | `forward` variant: thick, `hip 5.0`, `l1 2.6, l2 2.6`, `stride [3.0, 3.4]`, heavier footfalls |
| Scale | 1.3 |
| Speed / turn | 8 / 0.55 |
| Sink | 12 |
| Jets | none |
| HP | T 110, LA 48, RA 48, LL 60, RL 60 |
| Hardpoints | LA ballistic (AUTOCANNON), RA ballistic (AUTOCANNON), T energy (PPC), T missile (LRM-10) |
| Tons | 85 |
| Look | A wall. Boxy torso wider than tall, shoulder cannons, a low cockpit slit, a flat-topped head. |
| AI | `holdLine`; alpha below 40%; never retreats |

### Body plan mechanics

`GEO` gains per-chassis overrides: a chassis may name `legs: 'forward'` and a
`geo: { hip, l1, l2, stride, swing }` partial that `geoOf(m)` merges. The
mesh builders already size legs from `l1`/`l2`; torso and arm builders take a
`style` string per chassis for the distinct silhouettes (`buildTorso(ch)`
with a switch). Keep each chassis's parts under 600 triangles.

Footfall sound and camera kick scale with `ch.scale` (BISON steps should be
felt).

## Menu

`MECH_ORDER` becomes the unlock-aware list; locked chassis show as a dark
silhouette with `LOCKED` in the role line, cycle-able but not launchable.
`MECH_INFO` gains the role lines:

- MANTIS: `REVERSE-JOINT · LIGHT SKIRMISHER`
- HERON: `FORWARD-JOINT · LONG-RANGE`
- BISON: `FORWARD-JOINT · ASSAULT`

## Arena

Chassis already travel in `ch`. Add the three to `CHASSIS`; the server's
allow-list (M5a adds one) includes them. Balance in free-for-all is by
tonnage honesty: the BISON is slow enough to be fusion-scanned.

## Code touchpoints

- `src/data/weapons.js`, `chassis.js`, `geo.js`, `src/data/systems.js`.
- `src/sim/combat.js`: `bolt` kind, bursts, `onHit`, target heat from beams
  in `beams.js`.
- `src/sim/mech.js`: HUD scramble timer (`m.scramble`).
- `src/render/hud.js`: scramble effect (radar blips jitter, target box
  dropped while `scramble > 0`); tracers for MG/gauss in `scene.js`.
- `src/mesh/mechParts.js`: three builders or styles.
- `src/audio/sfx.js`: `ppc`, `gauss`, `mg`, `flamer` recipes from existing
  clips plus synthesis (no new assets needed; note which clips).
- `src/ui/menu.js`: locked state.

## Acceptance criteria

1. Each chassis walks with no foot slide at all throttles, on slopes, and
   after a jump landing (gait test parameterised over all six chassis).
2. Each weapon fires from the player and from the AI, is drawn, makes a
   sound, and hits a target in a headless test with the expected damage.
3. PPC scramble lasts 1.5 s and is visible on the HUD; flamer raises target
   heat at 6/s; MG fires 6 rounds per burst; pulse laser reaches full melt in
   2 s (tests).
4. Menu shows six chassis with unlock state; the three new ones render in the
   menu at the right framing on phone and desktop (screenshots).
5. `MECH_INFO.fire` bars and mechlab stats are consistent with the tables.
6. Arena: two clients, one in each new chassis, see each other correctly.

## Performance

Three more part sets in GPU memory (negligible). Bursts add shells: cap live
shells at 200, oldest dropped silently.

## Open questions

- Names: MANTIS, HERON, BISON. Alternatives if the owner prefers all birds:
  SWIFT, HERON, CONDOR.
- Should any chassis lack the fusion cannon (the BISON, for balance)? Default:
  all have it.
