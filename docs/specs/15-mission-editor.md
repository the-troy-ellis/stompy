# Mission editor (and the command view's groundwork)

| | |
|---|---|
| Status | approved; filed as #245–#248 |
| Milestone | M7 (proposed; after M6) |
| Size | L (split: view and picking; placing; objectives and waves; export and play from here) |
| Depends on | M3's objectives, entities and placement ([03-objectives.md](03-objectives.md)); M4's scenery |
| Touch parity | Full: one finger selects and drags, two fingers pan and zoom; no keyboard needed |

## Summary

An editor mode inside the game, `?edit=1`, that shows a mission from above on
its real terrain and lets you place and move its foes, entities, routes, pads
and waves, then exports the mission as the same plain JS that
`src/data/missions.js` holds today. Missions stop being laid out blind
(`at: [20, 600]` is a guess until someone plays it), and the editor stays a
better way to *write* mission data, never a second format.

The editor is also the first build of a **command view**: a top-down camera,
picking on the ground, selecting things and drawing paths. A later mode will
reuse those to give orders to mechs from above. That mode's shape is not
decided (see Open questions), so this spec does not build it. It does require
that the shared parts are built as shared modules, not editor internals.

## Player experience

This is a tool for whoever writes missions, not a player feature. It is
reached by URL only (`?edit=1`, optionally `&mission=m06`) and not from the
main menu until the owner says so.

- **The view:** the mission's terrain from above, in the game's own renderer
  and palette, with the time of day forced to day so everything is visible.
  Pan with two fingers (or the right or middle mouse button, or the arrow
  keys), zoom with a pinch or the wheel, rotate with a two-finger twist or
  Q/E. One finger is for selecting, never for panning, so a drag never
  wonders which it is. A compass and a 100 m grid sit over the terrain; the
  map's centre (where `at` is measured from), the player's start and its
  facing, and the map's edge (`BOUND`) are always drawn.
- **Markers:** every foe, entity, nav point, pad and wave origin is drawn as
  its real mesh plus a flat marker in the HUD's colours (team 1 foes in the
  hostile colour, structures, vehicles, nav points and pads each with their
  own shape). Convoy routes are lines with numbered points. A sleeping foe
  (`aware: false`) has its marker hollow, and every foe shows its facing.
- **Selecting:** tap or click selects one thing; one finger (or the left
  button) dragged from empty ground draws a box that selects many. Tapping
  empty ground clears the selection. The panel on the right shows the selection's
  fields.
- **Placing:** a palette at the bottom (FOE, STRUCTURE, TURRET, VEHICLE, NAV,
  PAD, ROUTE) adds a thing where you tap next. Drag a selected thing to move
  it; it follows the ground. A drag handle sets facing. In ROUTE, each tap
  adds a point and tapping a point removes it.
- **Line of sight:** a long press on a foe (or L with one selected) shades
  the ground it can see from its own eye height, using the AI's own sight
  test, so the shading is exactly what that foe will see. This is the "is it on a ridge or
  in a gully" check that is impossible today.
- **The panel:** the seed (a field plus REROLL, redrawing the terrain live),
  palette, weather, time of day and ramp, and the selected thing's fields:
  for a foe `type`, `profile`, `aware`, `face`; for an entity `id`, `kind`,
  `mesh`, `label`, `tags`, `height`, `radius`, `hp`, `pad`, and a vehicle's
  `speed` and `path`. Objectives and waves are ordered lists with add,
  remove and reorder. Each objective edits its own fields: `type`, `label`,
  `targets`, `seconds` and its own `waves` (SURVIVE), `convoy`, `to` and
  `minAlive` (ESCORT), `at`, `within` and `after` (EXTRACT), `secondary`.
  Each wave edits `at` (seconds) or `when {obj, done}`, `foes`, `from`
  (`'ring'`, a bearing, or a nav point's id), `dist` and `reveal`.
- **Wave markers:** a wave from a bearing is drawn as an arrow at that
  bearing and `dist` (520 m when unset) from the start, since waves are
  placed from the player and the player starts there; one from a nav point is
  a line from that point; a `'ring'` wave is a dashed circle at `dist`.
- **Problems:** a strip under the panel lists problems as they appear, in
  plain words: `DESTROY RELAY has nothing tagged relay.` `TRUCK 2 starts off
  its route.` `A foe is outside the map.` `Two things stand in the same
  place.` `EXTRACT goes to lz. There is no lz.` `Two things are called
  truck1.` `m13 has no name yet.` Each one selects the thing it is about
  when tapped.
- **Export:** EXPORT copies the mission to the clipboard as JS in the house
  style of `missions.js` (polar `at`, one line per foe or entity, shared
  shapes like `RELAY` reused when the fields match) and shows it in a text
  box for phones without clipboard access. IMPORT pastes a mission back in.
  The export is the mission's data, not its original text: hand-written
  shortcuts such as m03's `.map(...)` over its trucks, or a route kept in a
  `const`, come out written in full. The display name never goes in the
  export (`names.js` holds it).
- **Play from here:** PLAY starts the mission exactly as the campaign would,
  in single player, with the player's current mech. Co-op starts a mission
  by its key over the network, so an edited mission is single player only
  (see Open questions). F2 or the pause menu's EDITOR returns to the
  editor with nothing lost. The editor's working copy is kept in local storage
  so a reload does not lose it.

New text, for the tone check: `EDITOR` `FOE` `STRUCTURE` `TURRET` `VEHICLE`
`NAV` `PAD` `ROUTE` `REROLL` `EXPORT` `IMPORT` `PLAY` `PROBLEMS` and the
problem lines above. They are flat and plain on purpose; this is a tool.

## Design

### What it edits

The mission object exactly as [03-objectives.md](03-objectives.md) defines it:
`key, pal, seed, foes, entities, objectives, waves, flat, prefer, start,
weather, time, ramp, intel`. **No new fields.** Anything the editor can make,
`missions.js` can already hold, and every existing mission loads into it. The
terrain is still the seed plus flat pads; there is no height painting (see
Open questions).

### Coordinates

Every `at`, `path` point, `flat` pad and the `start` is polar
`[bearing°, dist]` from the **map's centre** (`placement.js`'s `polar`); a
`start` moves only the player (mission 11). A wave's bearing `from` is
measured from wherever the player is when it spawns (`waves.js`), which the
editor draws from the start. (The comment at the top of `missions.js` says
"from the start" for both; this work corrects it.)

Positions are edited in world space. A thing the editor **moves or places**
is stored back as polar rounded to 1° and 5 m, so exported files stay
readable. A thing it does not touch keeps its numbers exactly: m03's trucks
sit at 151 m and 169 m, and an untouched mission must come back unchanged.
The round trip is stable: export, import and export again gives the same
text.

### Shared parts (the command-view groundwork)

These live outside the editor, with no editor imports, so a later command
mode can use them unchanged:

| Module | What |
|---|---|
| `src/render/topCamera.js` | The overhead camera: pan, zoom, rotate, clamped to the map; screen to ground and ground to screen. |
| `src/sim/pick.js` | Picking: the nearest mech, entity or route point to a ground position, with a radius; a box select in ground space. Pure; no DOM. |
| `src/input/pointer.js` | One-finger tap, drag, long press and box, two-finger pan, pinch and twist, mouse equivalents; emits gestures, not raw events. |
| `src/render/markers.js` | Flat markers, route lines and the sight shading, drawn in one batch. |
| `src/sim/sight.js` | Line of sight over the terrain from a point and height, as a grid. Built on the AI's own test (`blocked` and `eyeAt` in `src/sim/ai/behaviours.js`, moved here and imported back), so there is one line-of-sight function. |

The editor itself (`src/ui/editor.js`, `src/ui/editorPanel.js`,
`src/data/missionIO.js`) is the only code that knows about mission data.

### Problems

`missionIO.js` `check(def)` returns a list of `{ id, text }`. It runs on every
edit and before PLAY and EXPORT. It never blocks PLAY: a broken mission is
still worth trying. It reuses the objective code's own checks where they
exist. What it catches:

- a DESTROY or PROTECT whose `targets` tag nothing, an ESCORT whose `convoy`
  tags no vehicle;
- an id that is referred to but missing: ESCORT's `to`, EXTRACT's `at`, a
  wave's `from`;
- two things with the same `id`;
- a vehicle that starts more than 100 m from the first point of its `path`
  (m03's last truck queues 66 m back, by design);
- anything outside `BOUND` (`src/world/terrain.js`: the map's half-width
  less 90 m), which the sim would clamp;
- two things closer than the sum of their radii (a mech counts as 6 m);
- a mission key with no name in `names.js` (the NAMING rule still applies:
  `docs/workflow.md`).

## Code touchpoints

- `src/main.js`: `?edit=1` boots into the editor instead of the menu.
- `src/data/missionIO.js` (new): `toSource(def)` for JS text in the house
  style, `fromSource(text)` to parse it back (a small parser for the literal
  shape, never `eval`: objects, arrays, strings, numbers, `true`, `false`,
  `null`, `Infinity` for scenery that can't be hurt, and the `...RELAY`-style
  shapes the exporter writes), and `check(def)`.
- `src/ui/editor.js`, `src/ui/editorPanel.js` (new): the mode, the palette,
  the panel and the problem strip.
- The shared modules in the table above (new).
- `src/sim/state.js`: none. `startMatch(G, def, ...)` already starts from
  a definition object.
- `src/render/scene.js`: draw with the top camera, and skip the cockpit and
  HUD in the editor.
- `src/data/missions.js`: the comment on placement says where each bearing
  is measured from.
- `scripts/build.mjs`: the release build becomes an ES module bundle with
  code splitting (`format: 'esm'`, `splitting: true`), and the page loads it
  with `<script type="module">`. The editor is a dynamic `import()` from
  `main.js`, so it is its own chunk that normal play never downloads. The
  service worker's file list already takes every file in `dist/`, chunks
  included, so it works offline too.
- `eslint.config.js`: `src/render/topCamera.js`, `src/render/markers.js`
  and `src/input/pointer.js` may not import from `src/ui/`. (`pick.js` and
  `sight.js` are in `src/sim/`, which the existing rule already covers.)

## Acceptance criteria

1. Every mission in `missions.js` opens in the editor with everything visible
   where the game puts it, checked by a screenshot of m03 (the convoy route)
   and m06 (tanks and the pad).
2. For every mission, `fromSource(toSource(def))` deep-equals `def` without
   its `name`, and exporting twice gives identical text. Opening a mission
   and exporting it without touching anything changes no number.
3. Making a new mission with every objective type, exporting it, pasting it
   into `missions.js` and playing it works without hand edits.
4. PLAY and back loses nothing, and neither does a reload.
5. Everything works on a phone with one and two fingers, with no keyboard.
6. The shared modules import nothing from `src/ui/` (enforced by lint, like
   the existing `src/sim` rule).
7. The problem strip catches each case listed under Player experience.

## Tests

- `test/missionIO.test.js`: the round trip over every mission; rounding;
  `check` for each problem.
- `test/pick.test.js`: nearest-thing picks and box selects, edge cases at the
  map bound.
- `test/topCamera.test.js`: screen to ground and back at several zooms and
  rotations.
- `test/sight.test.js`: a foe in a gully sees less than the same foe on a
  ridge.
- Smoke: open `?edit=1&mission=m03`, select a truck, move it, export, assert
  the text changed only in that truck's `at`.

## Performance

None in normal play: the editor's modules are their own chunk, loaded only
with `?edit=1` (see `scripts/build.mjs` above). In
the editor, the markers are one batch and the sight grid is computed on
demand, not per frame. The editor has no phone frame budget beyond staying
usable.

## Open questions

- **The command mode's shape.** Undecided, and deliberately not built here.
  Candidates: ordering your own AI wingmen from a map view in single player;
  a commander seat in co-op directing AI units while others pilot; a full
  mode with an in-match economy, production and fog of war. Default: build
  this spec's shared parts and decide after using the editor. An in-match
  economy would not break the "no currency" non-goal (that covers persistent
  progression), but anything here must still fit two thumbs and a tap.
- **Height painting.** Superseded by [18-voxel-ground.md](18-voxel-ground.md): the owner wants sculpted ground (canyons, caves, overhangs), and spec 18 does it with voxels. The rest of this item was the old default: no. It needs a stored height grid per mission
  (about 37 KB raw, less as changes from the seed) and co-op sync. Revisit if
  REROLL and pads keep failing to give the ground a mission needs.
- **Editor in the menu.** Default: URL only until the campaign missions have
  been reworked in it; then decide whether players get it.
- **Saving player missions or sharing them.** Default: out of scope; export
  text is the only output.
- **Edited missions in co-op.** Default: no. The host would have to send the
  definition to each guest, which is a protocol change. Revisit with sharing.
