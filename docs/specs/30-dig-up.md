# Digging up, and arms you can see

| | |
|---|---|
| Status | built (see As built). The owner, 2026-10-31: "The issue is that we need to be able to "dig" up to be able to climb out of pits", then "Go ahead with option 1 and the AI fix. For better digging feel, we should also be able to see the excavator arms digging from inside the cockpit. That way it doesn't look like invisible shovels are digging" |
| Milestone | M12 (hold to dig), a follow-on |
| Size | M |
| Depends on | [25-hold-to-dig.md](25-hold-to-dig.md) (the spin, the scoop, a run); [29-ground-4m.md](29-ground-4m.md) (the flat-bottomed bite, the parked digger in its tunnel); [17-portrait-cockpit.md](17-portrait-cockpit.md) (the cockpit view) |
| Touch parity | Nothing new to press: aim up with the aim stick as you would to look up |

## Summary

On the 4 m ground a pit you dig is a real pit, and a digger in one can't
climb out. Now a scoop aimed up at a wall cuts a ramp: the bite's floor
slopes up the way you look, never steeper than the digger can walk, so you
dig your way out. A parked digger stuck in a pit does the same on its own.
And from the cockpit you see your own arms turning and the buckets biting,
instead of the ground vanishing in front of an empty windscreen.

## Player experience

- **Aim level** at a face: a flat tunnel, as now.
- **Aim up** at a wall: the scoop's floor rises ahead of you, as steep as
  you look up, up to a ramp the digger walks (about 40°). Dig, step up,
  dig again: you climb out on a ramp of your own.
- **Aim down** at the floor: a round pit, as now.
- **A parked digger** that can't walk out of where it is (a pit, a tunnel
  that ends in a wall it can't climb) turns toward where it's going, looks
  up and digs a ramp, steps up it, and goes on. The crew strip reads
  `DIGGING` while it does.
- **From the cockpit,** in a digger, its two arms are drawn: at your sides
  at rest, swinging round as DIG spins them, the buckets passing through the
  bottom of the view as they bite. Hitches (spec 28) show on them.
- No new text.

## Design

- The bite's floor (spec 29's flat bottom) gets a slope: along the run's
  heading, `floor(x, z) = fl + slope × max(0, distance ahead of the digger)`.
  It never goes below `fl` (the feet), so the slope only ever raises it.
- `slope` = the tangent of the aim's elevation above level, up to
  `TOOL.dig.ramp` (0.85: about 40°, under the digger's climb of 1.2 with a
  margin). Aimed level or down to 15° below, slope 0 (a flat tunnel, as
  now). Further down, a round pit, as now. (See As built: the ramp starts
  above 9°.)
- Single player, as the bite's ore and flat floor are.
- **The AI:** a parked digger walking somewhere (its site, the silo, a
  construction site) that has made no progress for `MINER.rampAfter` (3 s)
  and can't walk straight on toward it digs a ramp:
  - it faces the way it was going and aims up at `ramp`'s angle;
  - it holds DIG, and after each scoop that dug, walks up what it can;
  - when the way on is walkable it goes on; after `MINER.rampFor` (30 s)
    with no way found it gives the trip up, as today.
- **The arms in the cockpit:** in the cockpit view your own mech isn't
  drawn. A digger's arms and buckets are: the same meshes and pose as from
  outside (`drawMech`, arms only), every frame, with nothing else of your
  mech. The near plane is 0.5 m; the arms stay outside it.

## Code touchpoints

- `src/world/voxels.js`: `dig(..., fl, sl)` and the fine edit take the
  slope `[gx, gz, ox, oz]` (rise per metre along x and z, from the digger).
- `src/sim/tools.js`: a run's floor and slope from the aim.
- `src/data/tools.js`: `ramp`.
- `src/sim/miner.js`: the ramp-out in `walkTo`.
- `src/render/scene.js`: `drawMech(m, tint, 'arms')`, drawn for your digger
  in the cockpit view.

## Acceptance criteria

- Aimed up at a pit's wall, held DIG and walking on climbs a digger out of
  a pit 8 m deep.
- Level and down aims dig as before (the tools and pace tests unchanged).
- A parked digger left in a pit 8 m deep hauls its ore out to the silo.
- From the cockpit the arms and buckets are seen turning and biting
  (screenshots in the PR).
- perf within budget; the arms add one or two draws in a digger only.

## Tests

`test/digUp.test.js`: the slope from the aim; climbing out of a pit; the
parked digger hauling out of one. The arms: a smoke screenshot.

## As built

- **Aimed up** (more than 9° above level: the aim ray's elevation over
  `sin 9°`), your scoops cut a ramp. A run is centred `rampAt` (6 m × scale)
  ahead and `rampLift` (2 m) over where the ramp's floor will be, and its
  floor rises from your feet at the aim's slope, to `ramp` (0.85). Aiming
  up never falls back to the floor ray (it used to, and dug a pit instead).
  With no ground over the ramp's line (open ground, the sky) it's "NOTHING
  TO DIG". Your pitch tops out at 0.45 rad, so the steepest ramp you cut is
  about 18°. In a pit 17 m deep you're out in about 15 s.
- **A parked digger** cuts its ramp where its upward aim meets the wall (the
  face scoop with the floor sloped as steep as the aim): cutting along the
  ramp line left it under its own roof in tunnels. It digs up when it's got
  no nearer for `rampAfter` (3 s) and can't walk `rampLook` (8 m) on. It
  checks the way with its own climb and its own height (`headOf`: 95% of it,
  as `rockAt` weighs the body) rather than the nav's 9 m of headroom, which
  a tunnel it dug can be under.
- **walkable** stepped one step past the distance asked (8 m read as 8.0001,
  five steps): now clamped.
- Seeds 4 to 7: the parked digger fills and unloads at 225, 229, 90 and 90
  s; on 6 and 7 it now climbs out of the pit you dug (spec 29's open point).
- **The arms from the cockpit** are a view model: the digger's arms hang
  beside its cab, 2.75 m out, and its buckets never pass in front of the
  eye. From the cockpit only, the shoulders are drawn at `COCKPIT_ARMS`
  (2.9 m out, 1.4 m under and 1.5 m ahead of the eye; see Longer arms): below and outside the
  view, so the arms and buckets swing in from the windscreen's sides each
  turn and no shoulder hangs in the air. (First 3.2 m ahead and 1 m under:
  on a phone, with no dash drawn, the shoulders floated in view.) From
  outside the pose is unchanged.
- **Longer arms** (the owner, 2026-10-31: "Should the arms on digger be a
  bit longer so the shoulders can be further back? That would fit a bit
  more with the amount of bit each dig is able to do"): each arm has a boom
  `BOOM` (1.8 m, × scale) longer, with hazard rails and an elbow block, the
  bucket at its end, from outside as from the cockpit. The cockpit shoulders
  went back to `COCKPIT_ARMS` 2.9 m out, 2 m under and 0.4 m ahead of the
  eye: well out of view, the boom reaching in from the windscreen's side.
- The HUD's dirt shows whole loads (a 4 m corner is a fraction of one).
