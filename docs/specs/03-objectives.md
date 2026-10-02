# Mission objectives and world entities

| | |
|---|---|
| Status | ready |
| Milestone | M3 |
| Size | L (split: framework + eliminate/structures; survive + waves; convoy; extraction) |
| Depends on | M0; M1's AI for waves and escorts |
| Touch parity | HUD markers and voice; no new controls |

## Summary

A small objective framework with five types: ELIMINATE (today), DESTROY
(structures), SURVIVE (timer with waves), ESCORT (a convoy to a point),
EXTRACT (reach a point, optionally under a timer). Missions compose one or two.
The HUD shows a nav marker and one line; the voice reports changes. World
entities (structures, vehicles, nav points) are introduced to serve them.

## Player experience

Top centre of the view, under the hostile count, one line in the HUD font:
`DESTROY RELAY 2/3` or `SURVIVE 1:42` or `ESCORT 640 m` or `EXTRACT 1.2 km`.
A diamond marker at the objective's screen position with its distance under
it, clamped to the view edge with an arrow when off-screen, and a matching
blip on the radar. Secondary objectives are dimmer and listed under the
primary.

Voice, in the existing register, one line per transition: `Objective
updated.` `Structure destroyed.` `Convoy under fire.` `Convoy lost.`
`Reinforcements inbound.` `Extraction point reached.` `Mission objectives
complete.` `Mission failed.`

Debrief shows each objective with a tick or cross, then the stats.

## Design

### Objective definitions

Mission definitions gain `objectives: [...]`, each one of:

```js
{ type: 'eliminate' }                                   // all team-1 mechs
{ type: 'destroy', targets: ['relay'], label: 'RELAY' } // structure tags
{ type: 'survive', seconds: 150, waves: [{ at: 0, foes: [...] }, { at: 60, foes: [...] }] }
{ type: 'escort', convoy: 'c1', to: 'nav_exit', minAlive: 2, label: 'CONVOY' }
{ type: 'extract', at: 'nav_lz', within: 180 }          // seconds, optional
```

Plus a `fail` rule per mission (default: player dead). `secondary: true` on
an objective makes it optional (counts in debrief, never fails the mission).

### State machine

`src/sim/objectives.js`: `initObjectives(game, def)` creates
`game.objectives = [{ def, state: 'active'|'done'|'failed', progress, ... }]`
and the entities the mission placed. `tickObjectives(game, dt, fx)` runs each
frame after the mech loop. The mission is won when every non-secondary
objective is `done` and lost when any non-secondary is `failed` or the player
is dead. `destroy()` and the entity damage path call into it rather than
checking "no enemies alive" directly (that check moves inside the ELIMINATE
objective).

### Entities

`game.entities = []`, each `{ kind, id, tags, x, y, z, yaw, hp, max, alive,
mesh, radius, height }`. Kinds:

- **structure**: static; drawn from a prop mesh; `rayCyl` hit volume like a
  mech; damage goes to a single `hp`; destroying spawns debris and a wreck
  variant (collapsed box) and flags its tags. Structures are also the
  buildings M4 scatters, with `hp: Infinity` when decorative.
- **vehicle**: moves along a waypoint list at a fixed speed, stops when the
  lead is blocked by a mech within 15 m, is destroyed at `hp` 0. A convoy is
  a tag shared by several vehicles. Enemy AI gains a `prefer: 'convoy'`
  flag per mission for escorts (M1's AI spec defines target selection).
- **nav**: no geometry; a marker position with a trigger radius (default 40 m).

Entities are hit-testable in `rayHit` (shells, beams, missiles and blasts all
hit them), targetable with T/TGT (structures only), and block movement by
their footprint (vehicles push mechs like mechs do; structures are solid
cylinders).

### Waves

`spawnWave(game, foes, { from: 'north'|'ring'|navId, dist })` places mechs
using the same ring maths as `startMatch`, awake, with `ai.aware = true`. A
voice line precedes each by 3 s. Wave sizes scale with difficulty (M1's
setting) by ±1 mech, never by HP.

### Placement in mission data

Positions are given as polar `[bearing°, distance]` from the start, so a
mission file reads like a sketch. The terrain's flat start zone stays; a
mission may add `flat: [[bearing, dist, radius]]` zones that `makeTerrain`
flattens for structures and the extraction pad.

### Arena and co-op

Objectives are single-player and co-op only. In co-op the host owns
`game.objectives` and `game.entities` and relays their state (M5b).

## Code touchpoints

- `src/data/missions.js`: objective and placement fields; `missionDef` for
  contracts picks an objective type by `n % 5`.
- `src/sim/objectives.js` (new), `src/sim/entities.js` (new: create, step
  vehicles, damage, destroy).
- `src/sim/combat.js`: `rayHit` includes entities; `damage` dispatches by
  target kind; `destroy` notifies objectives.
- `src/sim/ai.js`: target selection hook (`pickTarget`) so escorts matter.
- `src/sim/update.js`: tick entities and objectives.
- `src/world/terrain.js`: extra flat zones.
- `src/mesh/props.js` (new, shared with M4): structure and vehicle meshes.
- `src/render/scene.js`: draw entities; `src/render/hud.js`: objective line,
  markers, radar blips, debrief rows.
- `src/audio/voice.js`: the lines above.

## Acceptance criteria

1. Each of the five types can be completed and failed in a test mission
   (headless, scripted input where needed, e.g. teleporting the player for
   EXTRACT).
2. The marker points at the objective on screen and clamps to the edge when
   off-screen (screenshot on desktop and phone).
3. A convoy stops behind a mech standing in its path and resumes when the
   mech moves.
4. Destroying a structure with each weapon type works; blasts damage
   structures within radius.
5. Objective lines never exceed 24 characters; voice lines are from the list.
6. Debrief shows per-objective results.

## Tests

`objectives.test.js` per type; `entities.test.js` (vehicle follows waypoints
at its speed; blocked-by-mech; damage and destroy); `combat.test.js` additions
(ray hits a structure before a mech behind it).

## Performance

Entities add draws: budget 60 structures and 8 vehicles per mission, culled
by the M4 frustum check (until then, a distance cull at the fog's far edge).

## Open questions

- Should ESCORT vehicles fire back? Default: no; they are cargo. Keeps the
  tone and the AI simple.
- Timer visibility for EXTRACT: shown always or only under 60 s? Default:
  always; the HUD line is already there.
