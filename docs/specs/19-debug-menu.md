# Debug menu (a DEBUG tab: test range, cheats, jump to, tuning)

| | |
|---|---|
| Status | in progress: #296 (the tab and JUMP TO), #297 (the test range) and #298 (cheats) built; the owner picked a fifth DEBUG tab, with all four sections |
| Milestone | M8 (tooling; it does not change the game for players) |
| Size | M (split into four issues; see the end) |
| Depends on | [18-voxel-ground.md](18-voxel-ground.md) (the test grounds, digs, nav); [13-thunk.md](13-thunk.md) (the FEEL table); [14-look-and-performance.md](14-look-and-performance.md) (LOOK, the bench, the frame readout); [15-mission-editor.md](15-mission-editor.md) (the editor it jumps to) |
| Touch parity | Full. It is all buttons, ◀ ▶ pickers and switches, like the rest of the menu. The tuning tables are number boxes, which bring up the phone's keypad |

## Summary

With `?debug=1` the game today is the normal game plus a floating FEEL
panel over the play screen. Testing a feature means playing your way to it:
to see an arch fall you find a mission with an arch and then blast its leg
for a long time, because battle digs only nick rock. This spec gives debug
mode its own tab on the main menu. It has a **test range**: a flat field
with the landmark you want in front of you and the foes you want, or none.
It has **cheats** (no damage, no heat, endless ammo, no weight limit, big
digs, frozen foes), **jump to** (any mission, the editor, the bench, the
tutorial), and **tuning and overlays** (FEEL, gaits, LOOK, the frame readout
and pictures of the AI's map, digs and falls). The same switches are in the
pause menu during play. None of it exists without `?debug=1`.

## Player experience

Players never see any of this. The owner and testers open
`…/stompy/?debug=1`.

- **The main menu** gets a fifth tab after SETTINGS: DEBUG. With `?debug=1`
  the menu opens on it the first time (after that it remembers the last tab,
  as today). Without `?debug=1` there is no tab.
- **The DEBUG tab** has four rows of buttons, one per section, and the
  section's page below them. The mech picker on the right is the same one
  every tab has, so the range is flown in the picked mech and its FIT.
- **GO** on the DEBUG tab starts the test range. In the other sections GO
  does what the section says (start the picked mission, open the editor,
  play the bench).
- **The pause menu** in a debug run gets a DEBUG block under the settings:
  the cheats and overlays as switches, and FEEL, GAIT and LOOK as buttons
  that open their tables. A change applies at once when you resume. The
  floating FEEL panel over the play screen goes away.
- **The HUD** in a debug run shows the frame readout (as today) and one more
  line naming the cheats that are on, so a screenshot says how it was made:
  `CHEATS: NO HEAT · BIG DIGS`. In multiplayer the line says
  `CHEATS (OFF HERE)`.

The new text, in full:

| Where | Text |
|---|---|
| tab | DEBUG |
| section buttons | RANGE · CHEATS · JUMP TO · TUNING |
| range blurb | A flat field. Pick a thing to break. Pick who shows up. |
| range pickers | GROUND · FOES · HOW MANY · WHICH · TIME · WEATHER |
| ground names | FLAT · ARCH · MESA · TUNNEL · CAVE · PILLAR · ALL OF THEM |
| foes names | NONE · STANDING STILL · AWAKE |
| cheats | INVINCIBLE · NO HEAT · ENDLESS AMMO · NO WEIGHT LIMIT · BIG DIGS · FOES FROZEN |
| cheats blurb | Single player only. The arena does not care. |
| jump to | MISSION ◀ n ▶ · EDITOR · BENCH · WALK · TUTORIAL AGAIN |
| tuning | FEEL · GAIT · LOOK · COPY |
| overlays | FRAME TIME · AI LABELS · NAV · DIGS AND FALLS |
| HUD | CHEATS: … · CHEATS (OFF HERE) |
| voice on GO | Range open. Systems online. |

## Design

### Test range

A match on `{ flat: true }` ground, the player at the centre facing north,
with the picked landmark straight ahead. It runs in single player as a match
of kind `range`. It has no objectives and no debrief; the pause menu's MAIN
MENU ends it. When every foe is dead nothing happens: the range stays open.

| GROUND | What is built (in `src/data/range.js`) |
|---|---|
| FLAT | nothing |
| ARCH | the default arch at [0, 220] |
| MESA | the default mesa (r 66, top 120, lip 24) at [0, 260] |
| TUNNEL | a mesa at [0, 260] with a tunnel through it, north to south, at y 12 |
| CAVE | a cave at [0, 200], its mouth toward you |
| PILLAR | a 24 m pillar 44 m tall with a 64 m slab on top at [0, 180], built from editor strokes (the torque test's shape) |
| ALL OF THEM | each of the above on a ring 300 m out, ARCH ahead |

| FOES | |
|---|---|
| NONE | no foes |
| STANDING STILL | foes that never wake or move (the tests' `freeze`); they take hits and die |
| AWAKE | foes as in Free Play, already aware of you |

HOW MANY is 1 to 8 (default 1). WHICH is any chassis, or MIX for Free Play's
mix. Foes stand on a 200 m arc in front of you, off to the sides of the
landmark, so a shot at the landmark does not hit them. TIME and WEATHER are
Free Play's pickers. Every chassis is open, as `?debug=1` already opens them.

### Cheats

Each cheat is a switch, saved in the browser, and on only in single player
(`G.mode === 'sp'`: never in the arena or co-op, which trust each client's
numbers). They live in `G.cheats`, so the sim reads one place:

| Cheat | Rule |
|---|---|
| INVINCIBLE | as today (`sim/combat.js` `invincible`): hits spark, clang and jolt, and take nothing; fusion feedback costs nothing |
| NO HEAT | firing adds no heat, so you never shut down from heat |
| ENDLESS AMMO | firing takes no ammo |
| NO WEIGHT LIMIT | FIT allows any loadout, however heavy; the tonnage bar still shows the weight, in amber instead of red |
| BIG DIGS | every dig ignores the rock band and digs at `BIG_DIG.scale` (3) times its radius, so a blast takes out 27 times as much ground. Death digs too |
| FOES FROZEN | every foe stands still, as in STANDING STILL; turning it off wakes them |

`BIG_DIG` lives in `src/data/debug.js`, not in `data/weapons.js`: it is a
test tool, not balance. The range's GROUND and FOES pickers are not cheats.
They only set up the range.

### Jump to

| Button | What it does |
|---|---|
| MISSION ◀ n ▶ | GO plays that campaign mission (all twelve are open under `?debug=1`) |
| EDITOR | opens the editor (`?edit=1&debug=1`) |
| BENCH | plays the bench (ui/bench.js), as the FEEL panel's BENCH did |
| WALK | opens the walk viewer (below) in the picked mech |
| TUTORIAL AGAIN | forgets that mission 1's tutorial was done, then plays mission 1 |

### Tuning and overlays

FEEL, GAIT and LOOK are the FEEL panel's three tables, each its own page,
the same inputs and the same live effect. COPY puts the FEEL and GAIT tables
on the clipboard as JSON, as today. The overlays are switches, saved:

| Overlay | Draws |
|---|---|
| FRAME TIME | the frame readout (the setting of that name; on by default in debug) |
| AI LABELS | the foes' state labels and lines (today's AI overlay) |
| NAV | the nav squares within 160 m: a dot per floor and a line per link that is known, white if walkable, red if not (sim/ai/nav.js) |
| DIGS AND FALLS | the box of each dig and fall in the last 10 s, green; each overhang the torque rule weighed in that time, with its load / section, amber if it held and red if it broke |

The overlays are drawn on the HUD canvas, like the AI labels.

### Edge cases

- A cheat switched on in the pause menu during a mission applies at once.
  A campaign win with cheats on still counts, as `?debug=1` runs already do.
- `&lock` (the smoke test's way to see a new player's menu) hides the DEBUG
  tab, so the smoke test still sees the player's menu.
- `?debug=1&bench=1` still goes straight into the bench.

### As built in #296

- The tab is `src/ui/debugMenu.js`; `screens.js` asks it for its page,
  its LAUNCH label and its clicks. RANGE, CHEATS and TUNING say "Not built
  yet." until #297 to #299, and have no LAUNCH button.
- JUMP TO's LAUNCH plays the picked mission; EDITOR, BENCH and TUTORIAL
  AGAIN go on a tap. The section picked is saved (`debug.sec`); the first
  debug run opens on the tab (`debug.seen`).
- On a phone held sideways five tabs push LAUNCH off a 360-tall screen, so
  there they sit in two columns.
- The pause menu's DEBUG block comes with its first contents, in #298.

### As built in #297

- `src/data/range.js` has the grounds as mission-shaped `ground` defs and
  `rangeDef()`, which makes the match's def. The range is a match of kind
  `range` on flat ground with `objectives: []`. A match with no objectives
  at all never ends on its own (`sim/objectives.js`); dying still goes to
  the debrief, whose AGAIN builds the same range afresh.
- CAVE: a cave's mouth sits at the ground's height where it is laid, so the
  cave's mesa is set back 90 m and its mouth stands on the flat in front of
  it, 90 m deep.
- PILLAR is editor build strokes (7 m balls): a 3 × 3 column to 40 m and a
  64 m slab of them at 44 m. It holds under the torque rule until thinned.
- STANDING STILL foes carry `still` in their def, which sets `e.ai.still`;
  `sim/update.js` calls `stand()` for them instead of `think()`. #298's
  FOES FROZEN can use the same flag.
- Foes stand at ±35°, ±47°, ±59°, … on the 200 m arc, alternating sides.
- On a phone held sideways the RANGE page drops its blurb, and the pickers
  sit closer together, so LAUNCH stays on screen down to 667 × 375.

### As built in #298

- `G.cheats` is set by `ui/debugMenu.js` from the saved `debug.cheats`.
  It is empty without `?debug=1`. The FEEL panel's old INVINCIBLE setting
  carries over once, and its checkbox is gone. `sim/cheats.js`'s
  `cheat(G, key)` is true only in single player.
- INVINCIBLE, NO HEAT and ENDLESS AMMO cover your own mech only. NO HEAT
  sets your heat to 0 every frame, so the fusion cannon's overload no
  longer keeps you shut down.
- BIG DIGS triples the radius in `sim/dig.js` `dig()` and digs rock like
  soft ground. It covers every dig in single player, yours and the foes'.
  It was 2× at first, but the owner's AUTOCANNON shots at an arch did
  nothing. At 2× a 2.5 m shell digs 5 m, less than a cell (8 m), so after
  a dent or two the next solid corner was out of reach and the hole
  stopped. At 3× (7.5 m), real hits from the range's start (each digging
  where it meets the rock) drop an arch's crown in 3 AUTOCANNON or 3 BIG
  BONKER hits, and FIRECRACKERS in 5. A single LRM missile (1.5 m, 4.5 m
  here) still only marks it. Without BIG DIGS, 200 AUTOCANNON hits on a
  leg change the ground twice.
- FOES FROZEN reuses `stand()`. A foe frozen this way wakes, aware of
  you, once the switch goes off.
- NO WEIGHT LIMIT lets LAUNCH go over the budget on every tab but
  MULTIPLAYER. The tonnage bar shows amber and says NO WEIGHT LIMIT
  instead of OVERWEIGHT.
- The pause menu's DEBUG block comes first, above the controls, so a phone
  doesn't have to scroll to it. It isn't shown in the arena.

### As built in #299

- `src/ui/tuning.js` replaces `ui/feelPanel.js`; the floating panel is
  gone. TUNING has four pages, FEEL, GAIT, LOOK and OVERLAYS, the page
  picked saved (`debug.tune`). The same block sits in the pause menu's
  DEBUG block under the cheats. Its clicks never count as "click to
  resume", and keys typed into it don't reach the mech.
- FEEL and GAIT are the old tables, one per page, live as before; each has
  COPY, which gives both as one JSON (FEEL with GAIT inside). The tables
  scroll in a box 42% of the screen tall, so a phone keeps the rest of the
  menu. LOOK is the old row: lines, presets, antialias (reloads).
- Overlays are saved (`debug.overlays`). FRAME TIME and AI LABELS start
  on, as they were; NAV and DIGS AND FALLS start off. Without `?debug=1`
  the SETTINGS switch FRAME TIME still shows the readout.
- NAV: within 160 m, a white dot for each floor of each 32 m square, and a
  line for each link the nav has already worked out (it works links out
  only when a route asks), white if walkable and red if not.
  `sim/ai/nav.js` hands the HUD its `floorsOf` and `links`.
- DIGS AND FALLS reads `G.digLog`, which `sim/dig.js` fills only while the
  switch is on (null otherwise, one check a dig). Each dig is logged as its
  box, each fall as its cells' box where it came from, and each overhang the
  torque rule weighed with its load, section and middle
  (`world/voxels.js` `overhangs(b, k, ratios, weighed)`). The last 10 s
  are drawn: boxes green, the weighed ones as `load / section`, amber if
  it held and red if it broke.
- BENCH stays on JUMP TO; the bench no longer folds a panel away.

### Walk viewer

Added after #299, to settle how the gait looks (the owner: "technically
correct but not artistically correct"). JUMP TO → WALK puts the picked
mech on flat ground with nothing else about, walking north, and watches
it from outside.

- Its own screen state, `walk`: no cockpit, no touch controls, no pointer
  lock. The sim side is `src/sim/walkView.js` (the match, `G.walk`, and
  `walkStep`, which update.js runs as it runs the bench); the page side is
  `src/ui/walkView.js`.
- The panel, top left: WALK ◀ mech ▶ · MODEL (below) · SPEED (a slider, −35% to 100%) and
  STOP/GO · PATH STRAIGHT/CIRCLE · TIME 1× ½× ¼× ⅒×, II, STEP (one 1/60 s
  frame) · VIEW SIDE ¾ FRONT BACK COCKPIT · SHOW GRID, CHART, TUNING, EXIT.
  The picks are saved (`debug.walk`).
- The throttle eases to the speed (and to 0 on STOP) at the keys' rate,
  so starting and stopping look as they do in play. STRAIGHT is moved back
  to the middle past 200 m, feet and all, so nothing slides; CIRCLE turns
  at a third of the legs' rate.
- The camera goes round the mech, keeping its place relative to the mech's
  nose; drag to orbit (the view then has no preset lit), wheel or pinch to
  zoom. COCKPIT is the normal view from inside, HUD and all.
- GRID: a cross every 4 m on the ground round the mech, to see that a
  planted foot stays put. CHART: the last 3 s, bottom right: the hips'
  height (yellow), the lurch (cyan) and each foot's height (green).
- TUNING opens the FEEL, GAIT, LOOK and OVERLAYS pages under the panel,
  live as anywhere else.
- Keys: Space pauses, `.` or → steps, 1 to 4 pick the speed, Esc leaves.
- MODEL OLD/PENDULUM (added with the pendulum body, spec 16): which body
  rides the legs, saved, and in force for the whole debug session, play
  included. PENDULUM is the game's default; OLD is kept to compare. The
  chart adds the torso (orange) to see its lag.

## Code touchpoints

- `src/ui/debugMenu.js` (new): the DEBUG tab's HTML and clicks, and the
  pause menu's DEBUG block. `screens.js` adds `['debug', 'DEBUG']` to `MENU`
  when `?debug=1` and routes GO.
- `src/ui/feelPanel.js` → `src/ui/tuning.js`: the FEEL, GAIT and LOOK tables
  as pages for the tab and the pause menu, not a floating panel.
- `src/data/range.js` (new): the GROUND table as mission-shaped defs
  (`ground.landmarks`, `ground.strokes`) and the foe arc.
- `src/data/debug.js` (new): `BIG_DIG`, the cheat keys and their labels.
- `src/sim/cheats.js` (new): `cheat(G, key)`, true only in single player.
- `src/sim/combat.js`: `invincible` reads `cheat(G, 'god')`; firing skips heat
  and ammo under `heat` and `ammo`.
- `src/sim/dig.js`: `dig()` scales the radius and ignores the rock band under
  `digs`; it keeps a short log of digs, falls and torque checks
  (`G.digLog`, only when `G.debugDraw`) for the overlay.
- `src/sim/ai.js`: foes stand still under `freeze`.
- `src/ui/mechlab.js`: `fitOk` passes under `weight`.
- `src/render/hud.js`: the CHEATS line, and the NAV and DIGS overlays.
- `src/main.js`: drops `createFeelPanel`; `window.__stompy` stays.

## Acceptance criteria

1. With `?debug=1` the main menu has a DEBUG tab after SETTINGS; without it,
   or with `&lock`, there is none.
2. RANGE → GROUND ARCH → FOES NONE → GO puts you on flat ground facing an
   arch, with no foes, on a phone and on desktop.
3. With BIG DIGS on, a few BIG BONKER shots at an arch leg cut it through,
   and the crown falls (the torque rule).
4. Each cheat does what its row says in single player and nothing in the
   arena or co-op (headless tests).
5. STANDING STILL foes and FOES FROZEN foes never move or fire, and die to
   shots.
6. MISSION, EDITOR, BENCH and TUTORIAL AGAIN each go where they say.
7. FEEL, GAIT and LOOK edits in the pause menu apply on resume; COPY gives
   the JSON. The floating panel is gone.
8. The NAV and DIGS AND FALLS overlays draw what their rows say (screenshots).
9. The HUD names the cheats that are on.
10. The perf budgets hold: the overlays off cost nothing.

## Tests

- `test/cheats.test.js`: each cheat in single player, and none of them under
  `G.mode` `mp` or `coop`.
- `test/range.test.js`: each GROUND builds (a solid arch crown, a tunnel
  floor, the pillar's slab); foes stand on the arc, clear of the landmark;
  STANDING STILL foes do not move in 10 s.
- `test/dig.test.js`: a BIG DIGS dig removes more than a normal one in rock.
- Smoke: open `?debug=1`, DEBUG → RANGE → GO, and the match is a range with
  the picked ground; the `&lock` smoke still sees four tabs.
- Playtest on a phone: the whole tab with two thumbs, and the pause block.

## Performance

Nothing measurable with the overlays off: the cheats are a flag check where
heat, ammo and digs are already worked out. The NAV overlay draws at most a
few hundred dots and lines. The dig log only fills while the overlay is on.

## Open questions

1. Should the cheats also work in co-op when every pilot has them on?
   Recommended default: no. Co-op trusts each client, and a debug co-op run
   is rare.
2. Should a range be saved as an editor mission, or an editor mission be
   opened as a range? Recommended default: not now. The editor's PLAY already
   tries a mission.

## Issues

1. **#296 The DEBUG tab and JUMP TO** (S): the tab, its section buttons, GO
   routing, MISSION, EDITOR, BENCH, TUTORIAL AGAIN, the `&lock` rule.
2. **#297 The test range** (S): `data/range.js`, the RANGE page, the `range`
   match kind, foes STANDING STILL and AWAKE.
3. **#298 Cheats** (S): `sim/cheats.js`, the six switches on the tab and in the
   pause menu, the HUD line, `BIG_DIG`.
4. **#299 Tuning pages and overlays** (M): FEEL, GAIT, LOOK as pages, the floating
   panel removed, the NAV and DIGS AND FALLS overlays.
