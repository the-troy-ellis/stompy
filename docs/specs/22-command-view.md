# Command view: orders from above

| | |
|---|---|
| Status | built: parts 1 to 3 (the owner, 2026-10-25: "start working on the top down view so we can start sending commands to autonomous mechs like in an RTS game"; picked time keeps running, and crew jobs first) |
| Milestone | M10 (proposed) |
| Size | L, split in three: the view, orders, then polish |
| Depends on | [15-mission-editor.md](15-mission-editor.md) (the shared top camera, gestures, picking and map markers it built for this); [20-build-and-fight.md](20-build-and-fight.md) (the crew, SWAP); [21-mining.md](21-mining.md) (diggers and haulers that work on their own) |
| Touch parity | Full: one finger taps and picks, two fingers pan, pinch and twist (the editor's gestures); every order is a button. No keyboard needed |

## Summary

A button lifts you out of the cockpit to a map of the match from above,
while the world keeps going. Tap one of your mechs, tap an order, tap the
ground: it goes there, digs there, stays, or follows. Drop back into any of
them with one tap. Your crew has done its jobs on its own since spec 21;
this is how you tell it which jobs.

## Player experience

### Going up and coming down

- **MAP** (a touch button under the crew strip; Tab on a keyboard, View
  on a gamepad) goes up. It shows only in a match with a crew of two or
  more.
- The cockpit drops away and the camera rises to look down on the mech you
  were in, about 400 m of ground across the screen. The mech you left is
  parked, as after a SWAP: it stands, or does its job (a digger digs).
- **The world keeps running.** Raids still come, shots still land, the
  factory still builds. You are not safe up here; you are just elsewhere.
- **BACK** (top right; Tab or Esc) drops you into the mech you came from.
  **DRIVE** (in the order bar, with one mech picked) drops you into that
  one instead.
- If the mech you came from dies while you're up, nothing happens to you:
  pick another and DRIVE. With none left alive, the mission is lost as now.

### What you see

- The ground from above in the match's own light, with fog off so the whole
  base reads. The editor's 100 m grid and compass, faint.
- **Your crew** as markers in their own colour: a chevron pointing where
  each faces, its name, and what it is doing (`DIGGING`, `HAULING`,
  `LOADING`, `GOING`, `STAYING`, `FOLLOWING`). The one you came from is
  marked `▶`.
- **Buildings:** the silo, factory, bays and wall slabs, outlined.
- **Foes** as red markers where your radar would show them, no further.
  No fog of war beyond that.
- An order is drawn from its mech: a line to a GO flag, a line to a DIG
  face with a little pick, a link to the digger a hauler follows.

### Giving orders

- **Pick:** tap one of your mechs. Drag a box round several. Tap empty
  ground with nothing picked to clear.
- **The order bar** (bottom of the screen) shows what the picked mechs can
  do:

  | button | who | then | what it does |
  |---|---|---|---|
  | `GO` | any | tap ground | walks there and stays |
  | `DIG` | diggers | tap a face or a spot | walks up to it, faces it and digs there, on its own from then on (its site, spec 21) |
  | `FOLLOW` | haulers | tap a digger | waits behind that digger and takes its loads |
  | `STAY` | any | (at once) | stops where it stands |
  | `WORK` | diggers, haulers | (at once) | back to its own job, as a parked one does |
  | `DRIVE` | one picked | (at once) | you're in it |

- **A tap on the ground with mechs picked and no order chosen is `GO`**:
  the common order needs one tap.
- The voice answers each order, flat: `Going.` `Digging.` `Staying.`
  `Following.` `Back to work.`

### Desktop

Left click picks and orders, left drag boxes, right or middle drag pans, the
wheel zooms, Q/E rotate (the editor's controls). Keys 1–9 press the order
bar's buttons in order.

### Gamepad

View goes up and comes down. Up there, a crosshair in the middle of the
screen is where you tap: the left stick pans the ground under it, the right
stick turns (sideways) and zooms (up and down). `A` taps at the crosshair,
`X` picks the next crew mech and looks at it, the D-pad's left and right
light the order bar's buttons in turn and `Y` presses the lit one, `B` lets
go (the order waiting for its tap, or the site, then the picks). Start
pauses. A line at the top says so: `A: TAP. X: NEXT MECH. ◀ ▶ AND Y:
ORDERS. B: LET GO.`

New text, in full: `MAP` · `BACK` · `GO` · `DIG` · `FOLLOW` · `STAY` ·
`WORK` · `DRIVE` · `ATTACK` · `GUARD` · `GOING` · `STAYING` · `FOLLOWING` ·
`ATTACKING` · `GUARDING` · `A: TAP. X: NEXT MECH. ◀ ▶ AND Y: ORDERS. B: LET GO.` · voice `Attacking.` · `Guarding.` · `Going.` ·
`Digging.` · `Staying.` · `Following.` · `Back to work.`

## Design

### State

- `G.command` is null in the cockpit, and up there
  `{ cam, from, picked: Set, order: null | 'go' | 'dig' | 'follow' }`.
  `from` is the mech you came up from.
- Going up parks `G.player` (`crew.js` `park`). Coming down un-parks the one
  you drop into and makes it `G.player`, as `swap` does, with its wipe.
- The sim never imports the view. Orders are plain data on the mech:
  `m.order = { kind: 'go' | 'dig' | 'follow' | 'stay', x, y, z, yaw, target }`.
  The view writes them through `sim/orders.js` `give(G, mechs, order)`, so
  a headless test can give the same orders.

### Who runs what

A parked crew mech, each frame (`update.js`, where `mine`/`haul`/`stand`
run now):

1. `m.order` set → `obey(G, m, dt)` (`sim/orders.js`):
   - `go`: walk there by `walkTo` (`miner.js`, the nav's way round). Within
     `arrive`, the order becomes `stay`. A trip that gets nowhere in
     `stuck` seconds becomes `stay` where it is.
   - `stay`: stand (`halt`).
   - `dig`: walk to a stand point 9 m short of the tapped spot, facing it.
     There, set `m.site` (as a bite would) and clear the order, so the
     digger's own `mine` takes over from that site.
   - `follow`: a hauler's `haul`, but always behind `target` while that
     digger lives and works; when it doesn't, the order clears.
2. No order → as now: a digger `mine`s, a hauler `haul`s, the rest stand.

`WORK` clears `m.order`. The mech you drive ignores its order; leaving it
(SWAP or MAP) brings the order back into force.

### The camera

`render/topCamera.js` as the editor uses it, centred on `from`, `dist` set
so about 400 m spans the screen's width, the map's edge kept in view
(`settle`). `scene.js` draws from it when `G.command` is set (as it does for
`G.state === 'edit'`) but keeps the palette, time of day and weather, with
fog off.

### Picking

`sim/pick.js` (`pickNearest`, `pickInside`) on the crew's ground positions,
in screen space, as the editor picks markers. A tap within 24 px of a crew
mech picks it; foes and buildings can't be picked in this slice. With
`DIG` chosen, the tap's ground point (`screenToGround`) is the spot; with
`FOLLOW`, the nearest crew digger to the tap.

### Edge cases

- Only single player with a crew, as the crew is. Online, MAP is hidden.
- A picked mech that dies is unpicked; its order goes with it.
- Picking only fighters hides `DIG`, `FOLLOW` and `WORK`.
- A `DIG` tap where there is nothing to dig: the digger goes, finds no
  ground in reach, and gives the site up as spec 21 says. It stands.
- Pausing (Esc in the cockpit) still pauses the world.

## As built

### Part 1: the view (#350)

- `sim/crew.js` `canCommand`, `commandUp`, `commandDown`. While up,
  `update.js` gives the cockpit no input, runs the mech you left as a parked
  one, and holds the death handover until you come down.
- `ui/command.js`:
  - The overlay, gestures, picking, the camera (`view()`, which `scene.js`
    draws from) and the markers. `main.js` draws them instead of the HUD.
  - About 400 m across the screen when you go up, turned to where the mech
    you left faces.
- `input.js`:
  - Tab goes up; Tab or Esc comes down.
  - Up there the mouse doesn't take pointer lock, and letting go of it
    doesn't pause.
  - The touch UI hides. MAP sits top right under the radar, shown only with
    a crew.
- Building labels come from `NAMES.buildings` by tag.

### Part 2: orders

- `sim/orders.js`: `give`, `obey`, `can`, `ORDER` (arrive 4 m, stand-off
  9 m by scale), `SAY`. `update.js` runs `obey` first for every parked crew
  mech, then its own job.
- **DIG** stands short of the face, not the tapped spot. A level line at
  bucket height finds the face; a tap on a mesa's rim lands on top, and
  ground under an overhang hides how far in the face is. On arrival it looks
  again and walks on (up to four times) until the face is in the bucket's
  reach. Then the spot is its site and `mine` takes over.
- **FOLLOW** is `haul` with that digger and no other. The crew strip and the
  map say `FOLLOWING`. It clears when the digger dies or stops digging.
- **GO** that gets nowhere in 8 s becomes STAY where it is.
- **The order bar** shows only what the picked mechs can take, and DRIVE
  only with one picked. GO, DIG and FOLLOW light up and wait for their tap;
  STAY and WORK act at once. Keys 1–6 press them.
- **Orders on the map:** a line to a GO flag, a line to a DIG stand point
  with a tick toward the face, a dashed line to the digger a hauler follows.
- **Tests:** `test/orders.test.js`. The smoke run `command` also gives a GO
  by a ground click.

### Fighters: ATTACK and GUARD

- **`ATTACK` (key 8):** a fighter (any crew mech without a hopper) goes
  after the foe you tap, with the foes' own brain: `ai.js` `think`, now
  given a `prey`. Told where the foe is, it never wanders off looking. When
  the foe is dead, it stays where it is.
- **`GUARD` (key 9):** it waits 18 m off the side of one of your buildings
  (`GUARDING`). It fights the nearest foe that comes within 160 m of the
  building, and lets it go once either is more than 260 m from it
  (`ORDER.guard`, `leash`, `post`). With the building gone, it stays.
- **Taps:** with fighters picked, a bare tap on a foe is ATTACK, and on a
  built building of yours GUARD. Only foes the map shows (in your crew's
  radar reach) can be picked.
- **On the map:** a red line and a ring on the foe for ATTACK; a dashed
  line and a ring round the building for GUARD. The voice says
  `Attacking.` and `Guarding.`
- **How well they fight:** as well as foes do, which is worse than you.
  On the range, against a JACKAL standing still, a crew KESTREL killed it
  in 13 s. Against one dodging, it took a couple of minutes to land hits.
- **Tests:** `test/orders.test.js`, ATTACK and GUARD against a JACKAL on the
  range.

### Part 3: polish

- Box picking and the keys (1–9) were already in from parts 1 and 2.
- **The gamepad** (§ Gamepad above): `ui/command.js` `pad(pad, dt)`, which
  `input.js` hands the pad to while you're up. In the cockpit, View goes up
  when there's a crew and pauses when not (it paused before). `gamepad.js`
  reads X and Y as presses of their own too. `PADCAM` sets the sticks'
  speeds.
- **Smoke runs:**
  - `touch-command`: MAP, a tap on the KESTREL, a tap on the ground (GO),
    DRIVE, and the touch controls come back.
  - `command-build`: up, `7` (`BUILD FACTORY`), the ghost follows the mouse
    round the silo until it fits, and a click puts the factory site down.
    It's spec 23's missing step.
  - `command-pad`: View, X twice to the KESTREL, the stick pans, A gives GO
    at the crosshair, the D-pad lights DRIVE and Y drives it.

## Code touchpoints

- `src/sim/orders.js` (new): `give`, `obey`, and `ORDER` (arrive and
  stand-off distances).
- `src/sim/miner.js`: `walkTo` and `halt` exported for `orders.js`; `haul`
  takes an optional digger to follow.
- `src/sim/update.js`: parked crew mechs with an order `obey` first.
- `src/sim/crew.js`: `commandUp(G)`, `commandDown(G, m)`, beside `swap`.
- `src/ui/command.js` (new): the view's buttons, gestures (`input/pointer.js`),
  the camera and the marker drawing (`render/markers.js` `drawMap`, given
  the crew, buildings and foes). Loaded with the game; small.
- `src/render/scene.js`: the top camera when `G.command` is set.
- `src/input/input.js`: Tab and the gamepad's View button; MAP's touch
  button.
- `src/render/hud.js`: in the command view, only the crew strip and the
  base panel.

## Acceptance criteria

1. In a match with a crew, MAP (touch), Tab and the gamepad's View button
   go up; BACK comes down into the mech you left. Without a crew, or
   online, there is no MAP.
2. Up there, time runs: a factory's build and a raid's walk both go on.
3. Tap a crew mech, tap GO, tap the ground: it walks there and stays.
   A bare tap on the ground with it picked does the same.
4. A digger told DIG at a mesa face walks to it and digs there, and carries
   on hauling as in spec 21.
5. A hauler told FOLLOW a digger waits behind that digger and takes its
   loads.
6. STAY stops a mech; WORK sends a digger or hauler back to its own job.
7. DRIVE drops you into the picked mech.
8. All of it on a phone held sideways, one finger and two.

## Tests

- `test/orders.test.js` (headless): `give` and `obey` for each order;
  GO's arrive-then-stay; DIG setting the site where it stops; FOLLOW sticking
  to its digger; WORK clearing; the mech you drive ignores its order.
- `test/command.test.js`: going up parks and coming down un-parks; MAP is
  absent without a crew; picking by screen position with the top camera.
- Smoke: FIRST FACTORY, up, pick the digger, GO, back down; the digger
  walked; a touch run does the same with taps.

## Performance

The world draws once from above instead of from the cockpit: the same cost.
Markers are a few dozen canvas shapes. Orders are one more branch per
parked crew mech a frame.

## Build order

1. **The view:** MAP and BACK, the camera, markers for the crew, buildings
   and foes, picking, DRIVE. No orders yet.
2. **Orders:** `orders.js`, the order bar, GO, DIG, FOLLOW, STAY, WORK, the
   lines and flags, the voice.
3. **Polish:** box picking, keys 1–6, the gamepad, smoke runs.

## Open questions

- **Fighters.** Built: ATTACK and GUARD (§ As built, Fighters). The owner
  asked for them on 2026-10-27.
- **Orders from the cockpit.** Default: no; the map is where orders come
  from. Revisit if going up feels slow in a fight.
- **A minimap in the cockpit.** Default: no; the radar is the cockpit's map.
- **Co-op.** A commander seat while others pilot is in spec 15's list of
  shapes. Default: single player only until the crew is online.
