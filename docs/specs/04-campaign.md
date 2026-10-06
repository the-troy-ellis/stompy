# The campaign

| | |
|---|---|
| Status | in progress (#109 Act I: `m01`-`m04` shipped and named by the owner; #106 strip, replay, unlocks and REALLY? shipped; #110 Act II and #111 Act III: `m05`-`m12` shipped with placeholder names; #108 PURPLE PUNCHER's entrance in 10 shipped; #107 verdicts shipped with the draft words) |
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
| 1 | LIL SNOOZERS | ELIMINATE | 2 JACKAL | Today's mission 1. Also the silent tutorial (M6 prompts). One enemy starts unaware. The shove is taught here by a JACKAL that gets too close. |
| 2 | TOWER TOPPLER | DESTROY 3 relay towers; ELIMINATE secondary | 2 JACKAL, 1 JACKAL wave at the 2nd tower | Teaches structures and that noise brings company. Towers can be punched down. |
| 3 | HELPLESS LIL BUDDIES | ESCORT 4 trucks 1.6 km, min 2 alive | 3 JACKAL from the flanks in two waves | Teaches escort. Trucks take the valley road the terrain flattens. |
| 4 | FOUR LEGS BAD | ELIMINATE | 1 WARDEN, 2 JACKAL | Dusk → night during the mission (M4 time ramp). WARDEN unlock. |

### Act II — The glacier

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 5 | Hold the Ridge | SURVIVE 2:30 | waves: 2 JACKAL, 2 JACKAL + 1 PIPSQUEAK, 1 WARDEN | Fog. Radar range halved. Meet PIPSQUEAK by being stomped on from above. |
| 6 | Pop the Tanks | DESTROY 2 tanks; EXTRACT within 3:00 after | 1 WARDEN, 2 PIPSQUEAK, 1 JACKAL | PIPSQUEAK unlock. |
| 7 | Beanpoles | ELIMINATE | 2 BEANPOLE, 2 JACKAL | Snow. BIG BONKER from the far slope; the terrain has a ridge to use. Getting close enough to shove a BEANPOLE is its own reward. |
| 8 | Headlights | ESCORT 3 trucks across the glacier; SURVIVE until they clear | 2 WARDEN, 2 BEANPOLE, waves of JACKAL | Night with headlights. BEANPOLE unlock. |

As shipped (#110): the names above are working titles; until the owner picks,
the game shows `MISSION 5` to `MISSION 8`. Fog (5), snow (7) and night (8) are
`weather` and `time` fields that M4's atmosphere reads; until then they play
in the plain glacier palette, and 5's halved radar comes with the fog's radar
factor. 5's waves are 2 JACKAL at once, 2 JACKAL + 1 PIPSQUEAK at 0:50 and
the WARDEN at 1:40. In 8 the WARDENs walk straight at the convoy and the
BEANPOLEs wait on the slope by the route; the JACKALs come at 0:40 and 2:00.
The ridges in 5 and 7 are whatever the seed makes: the terrain generator has
no authored ridges.

### Act III — The plain (volcanic)

| # | Name | Objective | Foes | Notes |
|---|---|---|---|---|
| 9 | Unpark It | DESTROY the missile battery (3 launchers, structures that fire LRMs); ELIMINATE | 2 WARDEN, 2 JACKAL | Structures that shoot: a static turret entity using the LRM weapon. |
| 10 | Furnace | SURVIVE 3:00 near a refinery; secondary: keep 2 of 3 storage tanks | waves escalate; at 2:00 a PURPLE PUNCHER walks in from the ridge | Dust storm. The set piece: a purple shape in the dust, then the footfalls you can feel. |
| 11 | The Squeeze | EXTRACT 2.2 km through a canyon within 4:00; ELIMINATE secondary | 1 PURPLE PUNCHER, 2 BEANPOLE, 3 JACKAL ambushes along the route | Canyon walls make knockback matter both ways. PURPLE PUNCHER unlock. |
| 12 | Everything | ELIMINATE | 2 PURPLE PUNCHER, 2 WARDEN, 2 PIPSQUEAK | Night, lightning. The finale. No new mechanic, everything at once, two of them. |

As shipped (#111): working titles again (`MISSION 9` to `MISSION 12` in the
game). 9's three launchers are turrets (#105) beside two scenery tanks; DESTROY
and ELIMINATE are both required. 10's waves: 2 JACKAL at once, JACKAL +
PIPSQUEAK at 0:40, WARDEN + 2 JACKAL at 1:20, PURPLE PUNCHER from the ridge
at 2:00 (an entrance, below), 2 PIPSQUEAK at 2:30; keeping two
of the three storage tanks is a new PROTECT objective
([03](03-objectives.md)), secondary. 11 starts in one corner of the map and
ends in the other (~2.2 km, a mission `start`), with the ambushers asleep
along the way; the map has no authored canyon, so the walls are whatever the
seed makes. 12 is at night; lightning comes with M4's weather. The dust in 10
is a `weather` field like Act II's.

### After twelve: contracts

`missionDef(n)` for n ≥ 12 picks biome by `n % 3`, weather/time by a seeded
roll, and an objective type by `n % 5`, scaling foes as today with the full
chassis roster weighted toward lighter mechs. Named `Contract 13`, `Contract
14`, as now; the brief counts them in the board-book voice: `Five mechs are out
there. One of them is big. Go and stomp them.`

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
objectives }`, the best run), `camp.unlocked` (chassis list). A save from
before (`mech.mission`, `mech.best`) migrates once. RESTART CAMPAIGN clears
the mission and the results after a confirm step (a second tap on the same
button within 3 s, no dialog; the button reads `REALLY?` in between); chassis
already unlocked stay unlocked, since they were earned and the selector
would otherwise take away a mech the player flies. The logic is
`src/ui/campaign.js`. Free Play only draws unlocked chassis; a mix with none
open yet (HEAVY on a fresh save) falls back to its `fallback` (KESTREL).

The campaign panel in the menu shows a strip of twelve squares (done, current,
locked) above the current mission's name, biome and one-line brief; tapping a
done square selects it for replay.

## Debrief verdicts

One word above the numbers, from the tone guide: on a win `STOMPED.`, on a
win with no damage taken `UNTOUCHED.`, on a win by punching the last enemy
`PUNCHED.`; on a loss `SQUASHED.`, on a loss by overheating while an enemy
was shut down too `AWKWARD.`, on a loss to a stomp `FLATTENED.`

As shipped (#107): the words live in `NAMES.verdicts` (drafts until the owner
picks) and show in every debrief, Free Play too. Ties: UNTOUCHED beats
PUNCHED beats STOMPED; AWKWARD (you died shut down while an enemy was shut
down too) beats FLATTENED beats SQUASHED. Any melee kill but a stomp counts
as PUNCHED; a failed objective with the mech still standing is SQUASHED.

## Briefs (the full text)

Every brief is in the board-book voice (tone guide in `vision.md`): one to
four plain sentences, eight words or fewer each. 1–4 are shipped; 5–12 are
proposals the owner edits.

1. Two scouts sleep by the road. Wake them up. Knock them down.
2. Three tall towers talk and talk. Knock them down. Someone will come.
3. Four little trucks drive down the valley. JACKALs come to catch them. Keep two trucks safe.
4. One big mech walks on four legs. Two little mechs walk with it. Stomp all three.
5. Fog rolls over the ridge. Mechs walk out of it. Stay on the ridge.
6. Two fuel tanks sit in the snow. Pop them. Then run to the pad.
7. Two tall mechs stand on the far slope. Their guns are long. Get close.
8. Three trucks cross the ice at night. Their lights are on. Get them across.
9. Three launchers sit by the refinery. They shoot back. Knock them over.
10. Hold the refinery for three minutes. Keep the tanks in one piece.
11. The canyon is long. The clock is short. Run to the end.
12. Everyone is here. Big ones, little ones, purple ones. Stomp them all.

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
  for its first 8 s. As shipped (#108): `from: 'ridge'`, a nav point on the
  ridge 300 m north-east, about 100 m above the refinery and in plain sight
  of it, and `reveal: 8`; while it walks in its steps are
  heard and felt from anywhere, so the footfalls come before the first shot.

## Acceptance criteria

1. All twelve missions load, are winnable headlessly with a scripted "perfect"
   player (a test harness that kills enemies by direct damage calls and
   teleports to nav points), and fail when their fail rule triggers.
2. Playthrough on NORMAL by a tester in a stock KESTREL: every mission won
   within three attempts; total time under two and a half hours.
3. Each objective type appears at least twice; each biome hosts four missions;
   at least three missions are at night or in weather.
4. Text audit: every brief passes `test/tone.test.js` (the board-book voice);
   no new proper nouns beyond Redwater; every verdict and brief passes the tone tests.
5. Unlocks appear after missions 4, 6, 8 and 11; replay works from the strip.
6. Mission 10's PURPLE PUNCHER entrance is visible from the refinery and its
   footfalls are felt before it fires (playtest).

## Open questions

- Mission names and briefs above: approve or edit.
- Whether the finale should feature AI use of the fusion cannon (see
  [05-ai.md](05-ai.md)). Default: no.
- Whether contracts should be endless or stop at a number. Default: endless.
