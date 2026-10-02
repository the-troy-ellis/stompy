# The campaign

| | |
|---|---|
| Status | draft (mission list is a proposal for the owner to edit) |
| Milestone | M3 |
| Size | L (each mission is an S issue once the framework exists) |
| Depends on | [03-objectives.md](03-objectives.md), [05-ai.md](05-ai.md), [06-chassis-and-weapons.md](06-chassis-and-weapons.md), [07-atmosphere.md](07-atmosphere.md) for night/weather variants (missions degrade gracefully to plain palettes if M4 is late) |
| Touch parity | n/a |

## Summary

Twelve hand-authored missions in three acts of four, each act in one biome,
escalating from two scouts to the assault chassis, using every objective type
at least twice. Then open contracts. Text stays minimal: a name, one line,
the objective readout.

## Structure

Three acts, one biome each, with the fourth mission of each act at night or in
weather. Each act introduces one new chassis to fight and unlocks one to fly.

Unlocks: KESTREL and JACKAL from the start. WARDEN after mission 4. The three
new chassis after missions 6, 8 and 11. Unlocks are shown as the mech
appearing in the selector with no fanfare beyond the voice saying `New
chassis available.` once.

### Act I — Redwater (dusk desert)

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 1 | Proving Grounds | ELIMINATE | 2 JACKAL | Today's mission 1. Also the silent tutorial (M6 prompts). One enemy starts unaware. |
| 2 | Relay | DESTROY 3 relay towers; ELIMINATE secondary | 2 JACKAL, 1 JACKAL wave at 2nd tower | Teaches structures and that noise brings company. |
| 3 | Convoy | ESCORT 4 trucks 1.6 km, min 2 alive | 3 JACKAL from the flanks in two waves | Teaches escort. Trucks take the valley road the terrain flattens. |
| 4 | Hammerfall | ELIMINATE | 1 WARDEN, 2 JACKAL | Dusk → night during the mission (M4 time ramp). WARDEN unlock. |

### Act II — The glacier

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 5 | Ridge Patrol | SURVIVE 2:30 | waves: 2 JACKAL, 2 JACKAL + light skirmisher, 1 WARDEN | Fog. Radar range halved. Teaches the new light chassis by fighting it. |
| 6 | Pumping Station | DESTROY 2 tanks; EXTRACT within 3:00 after | 1 WARDEN, 2 light skirmishers, 1 JACKAL | Light skirmisher unlock. |
| 7 | White Out | ELIMINATE | 2 medium snipers, 2 JACKAL | Snow. Introduces the sniper chassis (PPC/gauss) at long range; the terrain has a ridge to use. |
| 8 | Icefall | ESCORT 3 trucks across the glacier; SURVIVE until they clear | 2 WARDEN, 2 snipers, waves of JACKAL | Night with headlights. Sniper unlock. |

### Act III — The plain (volcanic)

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 9 | Iron Rain | DESTROY the LRM battery (3 launchers, structures that fire LRMs); ELIMINATE | 2 WARDEN, 2 JACKAL | Structures that shoot: a static turret entity using the LRM weapon. |
| 10 | Furnace | SURVIVE 3:00 near a refinery; secondary: keep 2 of 3 storage tanks | waves escalate to include 1 assault | Dust storm. Introduces the assault chassis. |
| 11 | Breach | EXTRACT 2.2 km through a canyon within 4:00; ELIMINATE secondary | 1 assault, 2 snipers, 3 JACKAL ambushes along the route | Assault unlock. |
| 12 | Hammer | ELIMINATE | 2 assault, 2 WARDEN, 2 light skirmishers | Night, lightning. The finale. No new mechanic, everything at once. |

### After twelve: contracts

`missionDef(n)` for n ≥ 12 picks biome by `n % 3`, weather/time by a seeded
roll, and an objective type by `n % 5`, scaling foes as today with the full
chassis roster weighted toward lighter mechs. Named `Contract 13`, `Contract
14`, as now.

## Difficulty curve

Measured in a "threat" number: sum of enemy tonnage × awareness factor, per
minute of expected mission length. The table above climbs roughly linearly
with a dip at 5 and 9 (new biome, new mechanic). The difficulty setting (M1)
scales accuracy, awareness distance, wave size ±1 and the AI's heat
discipline, never HP or damage.

Each mission is tuned to be completable in a stock KESTREL on NORMAL by a
competent player in two tries, and comfortably by a player who fits their
mech for it (mechlab-lite's payoff: fog missions reward short-range energy;
the sniper act rewards the gauss; the escort rewards speed).

## Progression and saving

`store` keys: `camp.mission` (next unplayed), `camp.best[n]` (`{ won, time,
objectives }`), `camp.unlocked` (chassis list). RESTART CAMPAIGN clears all
three after a confirm step (a second tap on the same button within 3 s, no
dialog).

The campaign panel in the menu shows a strip of twelve squares (done, current,
locked) above the current mission's name, biome and one-line brief; tapping a
done square selects it for replay.

## Briefs (the full text)

Every brief is one sentence. These are proposals; the owner edits.

1. Two scouts on the convoy route. Run them down.
2. Three relay towers. Expect company when the first one falls.
3. Four trucks need to reach the pass. Two must make it.
4. A heavy and its escorts. Watch your heat; it will be dark before you finish.
5. Hold the ridge until the storm passes. Visibility is poor.
6. Blow both fuel tanks and get to the pad before the response arrives.
7. Two long-range mechs on the far slope. Close the distance or match it.
8. Get the trucks across the ice. It is night; they will see your lights.
9. A missile battery is shelling the refinery. Take the launchers out.
10. Hold the refinery for three minutes. The tanks are worth protecting.
11. The canyon is the only way out. Four minutes.
12. Everything they have left.

## Code touchpoints

- `src/data/missions.js`: the twelve definitions with placement data; the
  contract generator.
- `src/ui/menu.js`: the strip, replay selection, unlock display.
- `src/sim/state.js`: `startMission` honours `unlocked`; `camp.*` keys.
- `src/audio/voice.js`: `New chassis available.`
- Entities for turrets (mission 9) in `src/sim/entities.js`: a `turret` kind
  that aims and fires an LRM volley on a cooldown at the player within range.

## Acceptance criteria

1. All twelve missions load, are winnable headlessly with a scripted "perfect"
   player (a test harness that kills enemies by direct damage calls and
   teleports to nav points), and fail when their fail rule triggers.
2. Playthrough on NORMAL by a tester in a stock KESTREL: every mission won
   within three attempts; total time under two and a half hours.
3. Each objective type appears at least twice; each biome hosts four missions;
   at least three missions are at night or in weather.
4. Text audit: no brief over one sentence; no new proper nouns beyond
   Redwater.
5. Unlocks appear after missions 4, 6, 8 and 11; replay works from the strip.

## Open questions

- Mission names and briefs above: approve or edit.
- Whether the finale should feature AI use of the fusion cannon (see
  [05-ai.md](05-ai.md)). Default: no.
- Whether contracts should be endless or stop at a number. Default: endless.
