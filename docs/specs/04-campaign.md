# The campaign

| | |
|---|---|
| Status | in progress (#109 Act I: `m01`-`m04` shipped on placeholder names; the mission list is still a proposal for the owner to edit) |
| Milestone | M3 |
| Size | L (each mission is an S issue once the framework exists) |
| Depends on | [03-objectives.md](03-objectives.md), [05-ai.md](05-ai.md), [06-chassis-and-weapons.md](06-chassis-and-weapons.md), [12-melee.md](12-melee.md), [07-atmosphere.md](07-atmosphere.md) for night/weather variants (missions degrade gracefully to plain palettes if M4 is late) |
| Touch parity | n/a |

## Summary

Twelve hand-authored missions in three acts of four, each act in one biome,
escalating from two scouts to PURPLE PUNCHER, using every objective type at
least twice. Then open contracts. Text stays minimal: a name, one wry line,
the objective readout. The campaign's humour is in what it asks you to do
and what shows up, not in how much it talks.

Mission names, briefs and verdicts below are drafts. Missions are keyed
`m01`–`m12` in code; the playable PR for each ends with a NAMING section
(a recording of the mission's first minute and its set piece, plus two or
three name and brief candidates) for the owner to pick from. Placeholder
chassis names (PIPSQUEAK, BEANPOLE) will change; PURPLE PUNCHER will not.

## Structure

Three acts, one biome each, with the fourth mission of each act at night or in
weather. Each act introduces one new chassis to fight and unlocks one to fly.

Unlocks: KESTREL and JACKAL from the start. WARDEN after mission 4.
PIPSQUEAK after 6, BEANPOLE after 8, PURPLE PUNCHER after 11. Unlocks are the
mech appearing in the selector with the voice saying `New chassis
available.` once (`New chassis available. It is purple.` for the last).

### Act I — Redwater (dusk desert)

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 1 | First Stomp | ELIMINATE | 2 JACKAL | Today's mission 1. Also the silent tutorial (M6 prompts). One enemy starts unaware. The shove is taught here by a JACKAL that gets too close. |
| 2 | Tower Trouble | DESTROY 3 relay towers; ELIMINATE secondary | 2 JACKAL, 1 JACKAL wave at the 2nd tower | Teaches structures and that noise brings company. Towers can be punched down. |
| 3 | Trucks Don't Fight Back | ESCORT 4 trucks 1.6 km, min 2 alive | 3 JACKAL from the flanks in two waves | Teaches escort. Trucks take the valley road the terrain flattens. |
| 4 | Big Boy | ELIMINATE | 1 WARDEN, 2 JACKAL | Dusk → night during the mission (M4 time ramp). WARDEN unlock. |

### Act II — The glacier

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 5 | Hold the Ridge | SURVIVE 2:30 | waves: 2 JACKAL, 2 JACKAL + 1 PIPSQUEAK, 1 WARDEN | Fog. Radar range halved. Meet PIPSQUEAK by being stomped on from above. |
| 6 | Pop the Tanks | DESTROY 2 tanks; EXTRACT within 3:00 after | 1 WARDEN, 2 PIPSQUEAK, 1 JACKAL | PIPSQUEAK unlock. |
| 7 | Beanpoles | ELIMINATE | 2 BEANPOLE, 2 JACKAL | Snow. BIG BONKER from the far slope; the terrain has a ridge to use. Getting close enough to shove a BEANPOLE is its own reward. |
| 8 | Headlights | ESCORT 3 trucks across the glacier; SURVIVE until they clear | 2 WARDEN, 2 BEANPOLE, waves of JACKAL | Night with headlights. BEANPOLE unlock. |

### Act III — The plain (volcanic)

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 9 | Unpark It | DESTROY the missile battery (3 launchers, structures that fire LRMs); ELIMINATE | 2 WARDEN, 2 JACKAL | Structures that shoot: a static turret entity using the LRM weapon. |
| 10 | Furnace | SURVIVE 3:00 near a refinery; secondary: keep 2 of 3 storage tanks | waves escalate; at 2:00 a PURPLE PUNCHER walks in from the ridge | Dust storm. The set piece: a purple shape in the dust, then the footfalls you can feel. |
| 11 | The Squeeze | EXTRACT 2.2 km through a canyon within 4:00; ELIMINATE secondary | 1 PURPLE PUNCHER, 2 BEANPOLE, 3 JACKAL ambushes along the route | Canyon walls make knockback matter both ways. PURPLE PUNCHER unlock. |
| 12 | Everything | ELIMINATE | 2 PURPLE PUNCHER, 2 WARDEN, 2 PIPSQUEAK | Night, lightning. The finale. No new mechanic, everything at once, two of them. |

### After twelve: contracts

`missionDef(n)` for n ≥ 12 picks biome by `n % 3`, weather/time by a seeded
roll, and an objective type by `n % 5`, scaling foes as today with the full
chassis roster weighted toward lighter mechs. Named `Contract 13`, `Contract
14`, as now; the brief is one of a small pool (`Open contract. Pay is by the
kill.` · `Open contract. Try not to lose the legs.` · `Open contract. Someone
out there needs stomping.`).

## Difficulty curve

Measured in a "threat" number: sum of enemy tonnage × awareness factor, per
minute of expected mission length. The table above climbs roughly linearly
with a dip at 5 and 9 (new biome, new mechanic). The difficulty setting (M1)
scales accuracy, awareness distance, wave size ±1 and the AI's heat
discipline, never HP or damage.

Each mission is tuned to be completable in a stock KESTREL on NORMAL by a
competent player in two tries, and comfortably by a player who fits their
mech for it (mechlab-lite's payoff: fog missions reward short-range energy;
the BEANPOLE act rewards BIG BONKER; the escort rewards speed; PURPLE PUNCHER
rewards not being next to it).

## Progression and saving

`store` keys: `camp.mission` (next unplayed), `camp.best[n]` (`{ won, time,
objectives }`), `camp.unlocked` (chassis list). RESTART CAMPAIGN clears all
three after a confirm step (a second tap on the same button within 3 s, no
dialog; the button reads `REALLY?` in between).

The campaign panel in the menu shows a strip of twelve squares (done, current,
locked) above the current mission's name, biome and one-line brief; tapping a
done square selects it for replay.

## Debrief verdicts

One word above the numbers, from the tone guide: on a win `STOMPED.`, on a
win with no damage taken `UNTOUCHED.`, on a win by punching the last enemy
`PUNCHED.`; on a loss `SQUASHED.`, on a loss by overheating while an enemy
was shut down too `AWKWARD.`, on a loss to a stomp `FLATTENED.`

## Briefs (the full text)

Every brief is one sentence. These are proposals; the owner edits.

1. Two scouts are poking around the convoy route. Go stomp them.
2. Three relay towers; knock them down and expect someone to complain.
3. Four trucks need to reach the pass. Two of them, at least.
4. A heavy and its friends; mind your heat, it gets dark before you finish.
5. Sit on the ridge until the weather clears; you will have company.
6. Blow both fuel tanks and be gone before anyone asks questions.
7. Two BEANPOLEs on the far slope with very long guns: get close, or get closer.
8. Get the trucks across the ice at night; they will see your lights, which is the point.
9. Someone parked a missile battery by the refinery. Unpark it.
10. Hold the refinery for three minutes; the tanks are flammable, which cuts both ways.
11. The canyon is the only way out, and you have four minutes.
12. Everything they have left, against everything you have.

## Code touchpoints

- `src/data/missions.js`: the twelve definitions with placement data; the
  contract generator and brief pool.
- `src/ui/menu.js`: the strip, replay selection, unlock display, REALLY?.
- `src/ui/screens.js`: debrief verdicts.
- `src/sim/state.js`: `startMission` honours `unlocked`; `camp.*` keys.
- `src/audio/voice.js`: unlock lines.
- Entities for turrets (mission 9 launchers) in `src/sim/entities.js`: a
  `turret` kind that aims and fires an LRM volley on a cooldown at the
  player within range.
- Mission 10's scripted entrance: a wave entry with `from: navId` and a
  `reveal` flag that forces the enemy to walk (not spawn awake and shooting)
  for its first 8 s.

## Acceptance criteria

1. All twelve missions load, are winnable headlessly with a scripted "perfect"
   player (a test harness that kills enemies by direct damage calls and
   teleports to nav points), and fail when their fail rule triggers.
2. Playthrough on NORMAL by a tester in a stock KESTREL: every mission won
   within three attempts; total time under two and a half hours.
3. Each objective type appears at least twice; each biome hosts four missions;
   at least three missions are at night or in weather.
4. Text audit: no brief over one sentence; no new proper nouns beyond
   Redwater; every verdict and brief passes the tone tests.
5. Unlocks appear after missions 4, 6, 8 and 11; replay works from the strip.
6. Mission 10's PURPLE PUNCHER entrance is visible from the refinery and its
   footfalls are felt before it fires (playtest).

## Open questions

- Mission names and briefs above: approve or edit.
- Whether the finale should feature AI use of the fusion cannon (see
  [05-ai.md](05-ai.md)). Default: no.
- Whether contracts should be endless or stop at a number. Default: endless.
