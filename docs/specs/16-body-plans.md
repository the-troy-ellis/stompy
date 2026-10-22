# Body plans by class: runners, walkers, crawlers

| | |
|---|---|
| Status | ready (owner's direction, 2026-10-13); filed as #261 gaits, #262 quad traction, #263 roster |
| Milestone | M7.5 (after the editor; before release polish) |
| Size | L, split: gaits (look only), quad traction, roster |
| Depends on | [06-chassis-and-weapons.md](06-chassis-and-weapons.md) § Body plan mechanics, [13-thunk.md](13-thunk.md) (footfalls), the open balance pass (#79) for the roster numbers |
| Touch parity | Nothing to press: it is how mechs move and climb |

## Summary

Each leg type gets a class, a gait that shows it, and a rule that pays for
it. **Bird legs run**: they are the fast mechs, and at speed both feet leave
the ground. **Forward knees walk**: normal speed, more armour and guns, and a
heavy planted stride. **Quads crawl**: the slowest and biggest, and four feet
on the ground means hills don't slow them.

This also fixes the owner's note that mechs "scurry instead of being heavy
machines". Today KESTREL takes about 3.8 footfalls a second at full speed, and
the light mechs about 5.6–5.9, which is a sprinting cat, not a machine. After
this, a heavy walker takes about 1.5 and a runner about 3.

## Player experience

- A **runner** (JACKAL, PIPSQUEAK) walks at low speed and breaks into a run
  past half throttle. You can see the switch: long bounding strides, a moment
  with both feet in the air, and a light quick slap at each landing.
- A **walker** (KESTREL, BEANPOLE, PURPLE PUNCHER) never has both feet up
  (changed, 2026-10-22: a quick one, BARRY or LONG LARRY, now breaks into a
  run like a runner; see § Forward knees run). Each
  step is long and slow. The foot lifts, swings, and comes down hard and stops
  dead. The hips shift over the planted foot, the body drops at impact and
  recovers, and the next foot waits a beat before it lifts.
- A **crawler** (WARDEN) trots on diagonal pairs with a long plant between
  steps. It climbs a ridge at the same pace it crosses a flat.
- From the cockpit, fewer steps means each one lands harder: the step thunk
  (spec 13) can be stronger without getting busy.

No new text, except the role lines in the selector that name the leg type
(spec 06 § Existing three).

## Design

### The classes

| Class | Legs | Gait | Speed | Build | Slopes |
|---|---|---|---|---|---|
| Runner | reverse (bird) | walks, then runs: a flight phase above `runAt` | fastest | light: less armour, fewer tons | as now |
| Walker | forward | walks; a quick one runs past `runAt` (top speed ≥ `runMin`, 12 m/s); a heavy always has a foot down | normal | medium to heavy: more armour and guns | as now |
| Crawler | quad | trots: diagonal pairs, long plants | slowest | the heaviest | **no slope factor** (no uphill loss, no downhill gain) |

### The roster (owner's choices)

| Mech | Legs now | Legs after | Class | Notes |
|---|---|---|---|---|
| PIPSQUEAK | reverse | reverse | runner | unchanged |
| JACKAL | forward | **reverse** | runner | new legs and feet; same name, role and speed |
| KESTREL | reverse | **forward** | walker | the starter: a standard medium; new legs |
| BEANPOLE | forward | forward | walker | unchanged |
| PURPLE PUNCHER | forward | forward | walker | the top walker, the heaviest forward-kneed mech |
| WARDEN | quad | quad | crawler | **the biggest mech** until more are added: heavier and larger than PURPLE PUNCHER, and the slowest |

The roster's numbers (tons, armour, scale, speed) are balance numbers: they
change in the balance issue, not the gait issue. Proposed starting point,
for #79 to settle:

| Mech | Tons | Scale | Speed (m/s) |
|---|---|---|---|
| WARDEN | 60 → 90 | 1.15 → 1.4 | 9 → 8 |

Shipped in #263 as proposed. The frame rose to 56 t, so the stock loadout
still uses 85% of the budget and 13.5 t is free for armour and systems.
Armour is unchanged, for #79 to settle.
| JACKAL, KESTREL | unchanged | unchanged | unchanged |

Speed order after: runners (19–22) > walkers (9–15) > crawler (8).

### Gaits

The gait stays as `gait.js` has it: a cycle advanced by distance, planted
feet that never slide, swings aimed at where the foot lands. What changes is
the timing, the shape of a step, and the body over it, per class.

**Cadence.** Each class has a target number of footfalls per second at its
top speed, and the stride follows from it (stride = speed ÷ cadence) instead
of being a fixed range. Starting targets, all tunable:

| Class | Footfalls/s at top speed | Today |
|---|---|---|
| Runner | ~3 | 5.6–5.9 |
| Walker | ~1.5–1.8 | 2.2–3.8 |
| Crawler | ~1.4 (pairs) | 2.4 |

A planted foot must stay within its leg's reach, which is the constraint
that shortened the strides before. The walkers gain reach by crouching lower
as they speed up. The runners gain it from longer legs (bird legs are long:
`l1`/`l2` up for the reverse plan) and from the flight phase, which covers
ground with no foot down. If a number can't be met within reach, the reach
wins and the cadence is as low as it can be.

**Run.** Above `runAt` (a fraction of top speed, ~0.55), a runner's swing
share rises from 0.42 toward ~0.62. Each foot is then in the air more than
half the cycle, so there are moments with no foot down: the body follows a
shallow arc between landings instead of bobbing over a planted leg. Below
`runAt` it walks like anyone else. The change is smooth with speed.

**The shape of a step** (walkers and crawlers):
- **Lift slow, land hard.** Today a swing eases out into the landing (it
  slows down before touching). Instead it eases in: the foot speeds up into
  the ground and stops on contact.
- **Height early.** The lift peaks in the first part of the swing and drops
  steeply at the end, so the foot comes down rather than glides down.
- **Plant hold.** A longer share of the cycle with both feet down (the
  walkers' double support, the crawler's pairs), while the weight moves over.

**The body** (all classes, by amount):
- **Weight shift.** The hips sway sideways over the planted foot each step
  (walkers most, crawlers a little, runners hardly).
- **Impact drop.** The hull drops at each landing and recovers on the squash
  spring, instead of rising over the swinging leg.
- **Hip turn.** The hips turn a little with the stride, and the torso turns
  against them, so the guns stay on target.

Feet never slide (architecture § Invariants), and terrain height still
matches the mesh. None of this changes speed, acceleration or turning.

### The pendulum body (a second model, on trial)

The owner, watching the walk viewer: the steps are technically right but
don't move like a heavy, inertial thing. The old body glides at one height
with a sharp dip at each footfall. `BODY.model` in `src/data/walk.js` picks
which body rides the legs; `'old'` stays the default in play until the
owner picks, and the walk viewer's MODEL switch (spec 19) flips it for the
whole debug session, cockpit included.

- **The vault.** The hull vaults over the planted leg like a weight on a
  stiff pole. The planted leg nearest upright holds it up, so it is highest
  right over a foot and lowest between steps. `vault` keeps that share of
  the pole's rise and fall; it is smoothed a little (40 ms) where one leg
  hands over to the next.
- **Straight planted legs.** (The owner, after the first trial: "they look
  like they are crouching while walking; the knees don't bend".) The pole
  is the leg with its knee opened to `knee` degrees: a walker's planted
  knee sits near 150°, against the old body's 80° to 120°, and no leg is
  stretched past its reach (the others straighten to keep up). The
  swinging leg does the bending: its lift still peaks early, so the foot
  comes up behind and the knee folds to about 100° before it reaches
  forward. Walking, the mech stands taller than at rest (about 0.6 m for a
  walker); it eases from its stance into the walk over the first third of
  its speed and settles back as it stops. The old `crouch` is the old
  body's alone. At top speed the strides are long for the legs, so the hips
  still dip where one foot hands over to the next.
- **Height for speed.** Low, the hull runs a little ahead; high, it falls
  back (`speedUp`), drawn as the lurch and leaking back to nothing.
- **The weight landing.** Each footfall pushes the hull down on a spring
  (`sink`, `bodyK`, `bodyZeta`) that comes back late with an overshoot,
  instead of the old dip's fixed shape.
- **The torso follows late.** The torso rides its own spring on the hull
  (`lag`, about 50 ms behind for a walker), and nods forward as it lags low
  (`nod`). `sim/geom.js` torsoFrame carries the lag, so the eye and the guns
  go with the drawn torso.
- **The swing.** The swinging foot moves as a pendulum: quickest through
  the middle, slowing as it reaches out (instead of `slam`), its lift
  peaking early (`liftEarly`).
- All of it is drawn, like the old bob: the mech's place, speed and feet
  are the same under either body (`test/pendulumBody.test.js`), and
  planted feet never slide.
- Still to come, if the owner keeps it: capture-point foot placement (where
  the next foot goes to stop the body, so braking hard takes an extra step).

### Forward knees run

The owner, on the straight-legged pendulum walk (2026-10-22): "it's too
bouncy for the body. The chicken walker mechs look better, so it might be
worth having the normal knee mechs be able to run also." At top speed a
walker's strides were long for its legs, so the hull had to dip about
0.75 m where one foot handed over to the next.

- Forward knees now run past `runAt` (0.55), as bird legs do, with a flight
  phase (`runSwing` 0.6) and quicker steps (`runCadence` 2.6, blended in as
  the run comes on; the walk keeps `cadence`). A run covers its stride in
  the air, so each foot is planted for less ground and the hull hardly has
  to dip: BARRY bobs 0.35 m at full speed (was 0.75), LONG LARRY 0.16 m.
- Only a mech whose top speed reaches `runMin` (12 m/s) runs. PURPLE
  PUNCHER and the digger (9 m/s) keep the heavy planted walk, at 1.58
  footfalls a second; a fast walk bends their knee a little more
  (`kneeFast`, 20° at full speed) for the reach their long strides want, so
  PURPLE PUNCHER bobs 0.30 m (was 0.72).
- The walker's pendulum is calmer too: `knee` 145°, `vault` 0.3.
- These are look-only (GAIT): speeds, turns and everything else are as
  they were. Under the old body, forward knees run too.
- **A sprinter's lean** (the owner: "as mechs get into running they should
  lean forward and down a bit like a sprinter"). Running forward, the torso
  pitches forward by `runLean` (walkers 0.2 rad, about 11°; bird legs 0.28,
  about 16°) and the hips sink by `runDrop` (0.4 and 0.5 model units),
  easing in and out over a quarter second with the run. Under both bodies;
  the eye and the guns don't pitch with it (only the drawn torso does).
- **Bird legs crouch walking** (the owner: "chicken walkers don't need to
  have their legs so straight"): under the pendulum body their planted knee
  sits at 125° (was 145°).

### Crawler traction

`slopeFactor` (sim/mech.js) returns 1 for a quad: no uphill loss and no
downhill gain. The AI's ridge and cover behaviours (ai/behaviours.js) treat
climbing as free for a quad, so a WARDEN takes the high ground more readily.
The arena and co-op follow, because each client runs its own mech.

## Code touchpoints

- `src/data/geo.js`: per plan, `cadence`, `runAt`, `runSwing`, `liftEarly`,
  `plantHold`, `sway`, `impactDrop`, `hipTurn`; the reverse plan's longer legs.
- `src/sim/gait.js`: stride from cadence within reach; the run (swing share
  by speed); the swing's easing and lift shape; the plant hold; the body's
  sway and drop (`m.sway`, alongside `m.bob`).
- `src/render/scene.js` `drawMech`: the hips' sway, drop and turn, and the
  torso's counter-turn.
- `src/ui/feelPanel.js`: the gait numbers as live knobs under `?debug=1`,
  with COPY, so the owner can tune them on a phone.
- `src/sim/mech.js` `slopeFactor`: quads exempt. `src/sim/ai/behaviours.js`:
  climbing is free for a quad.
- `src/data/chassis.js`: JACKAL `legs: 'reverse'`, KESTREL `legs: 'forward'`,
  WARDEN's numbers (balance issue). `src/mesh/mechParts.js`: the new legs
  follow from the plan; check JACKAL's and KESTREL's silhouettes stay their
  own (`style`).
- `src/data/names.js`: role lines that mention leg types, if any.

## Acceptance criteria

1. At top speed on flat ground, footfalls per second are within 15% of the
   class targets, for every chassis.
2. A runner above `runAt` has moments with no foot planted; a walker and a
   crawler never do.
3. Feet never slide: a planted foot's position does not change while it is
   planted, for every chassis at every speed (the existing invariant test,
   run over all plans).
4. A WARDEN climbs a 20% grade at its flat-ground speed; a KESTREL on the
   same grade is slower.
5. JACKAL has bird legs, KESTREL forward knees, and WARDEN is the largest and
   heaviest mech.
6. The gait numbers are live knobs in the `?debug=1` FEEL panel.
7. `npm run perf` stays within budget.

## Tests

- `test/gait.test.js`: cadence per class; flight phase only for runners
  above `runAt`; planted feet don't move; reach is never exceeded.
- `test/walking.test.js`: quad slope factor is 1 on a 20% grade both ways;
  others unchanged.
- Playtest: walk, run and climb with each chassis; does a heavy walker feel
  heavy, and does a runner feel fast?

## Performance

The same leg maths per frame with different timing: nothing measurable.

## Open questions

- **Quads beyond hills.** Defaults: no downhill bonus either (slope factor 1
  both ways), and no other extras. Candidates for later: knockback and
  topple resistance, steadier aim while walking, no jump jets.
- **A runner's cost.** Default: lighter frames only. Candidate: more aim sway
  while running.
- **WARDEN's exact numbers.** Default: the table above, settled in #79.
