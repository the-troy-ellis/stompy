# Blast-off jets

| | |
|---|---|
| Status | parts 1 and 2 built (#363, #364); targeting added for part 3 (the owner, 2026-10-29: "I want the blast off mechanic to be fun. I want it to have some slight targeting and auto steering to make it a viable combat mechanic. Players should generally control it but there should be a targeting mechanic"). Spec merged in #362; the owner, 2026-10-28: "Instead of a continuous jet like in mechwarrior it should be more like a blast off mechanic where you hold down the jump jet to charge it and when you let go you shoot off like a rocket with a streak like the missiles make and a large thunk with a dust cloud and shockwave. You should be able to guide your trajectory a bit while in the air, the view should tilt down a bit so you can see below you better. If you aim right you can land on a mech and insta stomp it") |
| Milestone | M13 (proposed) |
| Size | L, split in four: charge and blast-off; the flight, the view and the landing spot; targeting and the insta-stomp; the AI and online |
| Depends on | [12-melee.md](12-melee.md) (the stomp); [13-thunk.md](13-thunk.md) (the feel table) |
| Touch parity | The same gesture as now: a tap then a hold on the upper stick charges, and letting go blasts off |

## Summary

Jump jets stop being a steady push on a fuel bar. **Hold JUMP to charge,
let go to blast off**: the mech crouches, the jets build to a roar, and on
release it shoots up like a rocket with a smoke streak behind it, a big thunk,
a ring of dust and a shockwave on the ground. In the air you steer a little
and the view tips down so you can see where you'll land. Land on a mech and
it's flattened: an **insta-stomp**. **Targeting** makes that a real move in a
fight: while you charge, the jets lock the foe in your sights and show where
this charge would land. Let go once it reaches, and the blast is aimed at
them. In the air you still steer; the jets only nudge you back on.

## Player experience

### Charging

- **Hold JUMP** (`J`; on touch, tap then hold the upper stick, as now; `A`
  on a gamepad). The charge fills in 0.9 s.
- While it fills:
  - the mech crouches lower and lower;
  - the jets glow and a rising whine builds;
  - a little dust stirs at the feet;
  - the view sinks with the crouch.
- You can still turn and twist, and walk at half speed.
- The jets ring on the HUD fills with the charge. Full, it blinks.
- **A tap** (less than a fifth of a charge) is a hop: the smallest blast.

### Blast-off

- **Let go** and the mech shoots up, and forward the way it was walking.
  - Height and distance grow with the charge: a hop is about 5 m up; a full
    charge is about 44 m up and 55 m along (the owner, after part 2:
    "they need to fly higher and blast off more intensely").
- **The thunk** (a new `blastoff` row, about a landing's size):
  - a hard kick down and back, shake, a deep bass boom, a long buzz on
    phones;
  - a ring of dust and the shockwave ring (the missile blast's) on the ground
    where you stood;
  - a scorch mark there.
- **The streak:** the jets leave a missile's smoke trail and flame all the
  way up, then gutter out at the top.
- The jets ring empties and refills over 3 s (2 s with BOOSTED jets). There's
  no blasting again until it's full.

### In the air

- **Steering:** the legs and throttle controls push you a little sideways
  and along, enough to shift a landing by about a mech's width each second.
  No more climbing.
- **The view tips down** as you rise, up to about 17° at the top, so the
  ground below is in sight. It comes back level as you land.
- **The landing spot:** a ring on the ground where you'll come down, drawn
  where your fall meets the ground. It turns red over a mech: that's a stomp.

### Targeting

The aim: an insta-stomp you set up on purpose, not a fluke, without taking the
flight away from you. You aim with your eyes and the charge; the jets do the
sums.

- **The lock.** While you charge, the jets lock on to the foe you've targeted
  (`R`, as for missiles), or, with nothing targeted, the foe nearest the
  crosshair. Either way it must be within the lock's cone (the missiles' 17°)
  and the jets' reach (80 m; 90 with BOOSTED jets). The HUD's brackets on it
  close to the missile lock's diamond, in amber.
- **Will it reach?** While you charge, the landing ring is already drawn
  where this charge would come down. It creeps out toward the target as the
  charge fills. When it's on the target, the ring and the diamond turn red
  with a chirp: let go now.
  - Hold on past that and the blast goes higher and steeper, still aimed at
    the target, so a full charge is never wasted. It's a longer fall and a
    bigger stomp, but more time for them to walk off.
- **Let go with a lock** and the blast is aimed: it goes toward where the
  target will be when you land, at its pace now, not along your legs. You
  don't need to be walking. Too short a charge falls short, aimed at it.
  - **Backing up** (throttle back) as you let go ignores the lock: a plain
    blast backwards, to get away.
- **In the air, the auto-steer** pulls you toward the target if it moves,
  gently. It's slower than your own steering and only goes so far:
  - a slow mech (a WARDEN, a PURPLE PUNCHER) can't walk out from under you;
  - a quick one (a JACKAL) that turns or sprints in the last two seconds gets
    away.
  - Your own steering always adds on top. Steer away from the target for half
    a second and the lock lets go. Then the flight is all yours, as in part 2.
- **No lock** (nothing in the cone, or out of reach): the blast is part 2's,
  along your legs by the throttle, all your own.
- **Being the target** (the arena; later, maybe foes): a red ring appears on
  the ground around you as the lock is made, and the voice says `ABOVE YOU.`
  once. Walk out of it.
- **The stomp:** an aimed insta-stomp also stops the clock for a beat (the
  hit-stop, twice a gun hit's).

### Landing

- The `land` thunk, scaled by the fall, plus dust.
- **On a mech:** an **insta-stomp**.
  - It's destroyed outright, whatever its armour.
  - The `stomp` thunk at full, a bigger dust ring, and you bounce up off it.
  - The voice says it as a stomp kill does now (`Target stomped. Literally.`).
  - It counts as a blast-off stomp only when you blasted off and fell at
    least 8 m. A plain walk off a ledge onto a mech is the old stomp (spec
    12's damage).

### Text

New text, in full:
- tutorial, keyboard: `HOLD J. LET GO: UP.`
- tutorial, touch: `UPPER STICK: TAP, HOLD, LET GO` (the 30-letter limit)
- tutorial, gamepad: `HOLD A. LET GO: UP.`
- voice, when a blast-off locks on to you: `ABOVE YOU.` (flat; part 4, the
  arena)
- (no other new voice: a stomp kill's lines are there already, and being
  stomped yourself gives the debrief's existing `FLATTENED.`)

## Design

### Numbers

`data/systems.js` `JETS` replaces `JETS_FUEL` and `JETS_CLIMB`, by JUMP JETS
level (0 none, 1 STOCK, 2 BOOSTED):

| | STOCK | BOOSTED | what |
|---|---|---|---|
| `charge` | 0.9 s | 0.75 s | empty to full |
| `vy` | 14 to 40 m/s | 15 to 44 m/s | upward speed at blast-off, by charge |
| `fwd` | 0 to 14 m/s | 0 to 16 m/s | added along the legs' heading, by charge times throttle (backing up blasts back) |
| `recharge` | 3 s | 2 s | the ring refilling after a blast |
| `heat` | 4 to 12 | 4 to 12 | added at blast-off, by charge |
| `steer` | 6 m/s² | 7 m/s² | air control, along and across |
| `tilt` | 0.3 rad | 0.3 rad | the view's tip down at the top |
| `stompFall` | 8 m | 8 m | the fall after a blast-off that makes an insta-stomp |
| `reach` | 80 m | 90 m | how far the jets will lock |
| `aimFwd` | 20 m/s | 22 m/s | the most speed along an aimed blast may take, to reach the target |
| `assist` | 4 m/s² | 4 m/s² | the auto-steer's pull (your own steering is 6 or 7) |
| `assistMax` | 6 m/s | 6 m/s | the most speed the auto-steer may add over a flight |
| `letGo` | 0.5 s | 0.5 s | steering away from the target this long drops the lock |

Gravity stays 18 m/s², so a full STOCK blast tops out at 40² / 36 = 44 m and
lands about 4.4 s later.

These are new numbers for a new mechanic, set in this spec. Tuning them later
is a balance issue.

### State

- `m.jet`: `{ charge, held, ready, blasted, top }`.
  - `charge`: 0 to 1 while held.
  - `ready`: the ring, 0 to 1, refilling after a blast.
  - `blasted`: in the air from a blast-off.
  - `top`: the highest point of this flight, for the stomp's fall.
- `m.fuel` and `m.jetting` go. The HUD's ring and the AI read `m.jet`.
- The input is held, as now (`input.jets`). `stepMech` charges while held
  and blasts on the frame it's let go, if `ready` is full and the mech is on
  the ground.

### Blast-off

`sim/jets.js` (new) `blastOff(G, m)`:
1. `m.vy = vy(charge)`; the horizontal push along `m.yaw` is
   `fwd(charge) × throttle` (backing up blasts back).
2. `feel(G, 'blastoff', { mech: m, k: 0.4 + 0.6 × charge })`.
3. `blastRing(G, at, big)`: the explosion's shockwave and dust ring
   (`effects.js`), with no damage and no dig. A scorch goes down too.
4. The streak is drawn in `stepMech` while `vy > 0` after a blast: smoke
   puffs and flame as a missile's trail (`missiles.js`'s look), from the jet
   nozzles.
5. `m.heat += heat(charge)`, `ready = 0`, `blasted = true`.

### In the air

- `stepMech`, airborne after a blast: `input.thr` and `input.turn` add
  `steer × dt` to the push along and across the legs' heading. The push is
  capped at the blast's horizontal speed + 6 m/s.
- **The landing spot:** `jets.js` `landingAt(G, m)` steps the flight forward
  (the same gravity, no steering) until it meets the ground or a mech's top.
  The HUD draws the ring there, red when a mech's top is under it.
- **The view:** `render/scene.js` adds `−tilt × (height above the ground /
  40 m, up to 1)` to the eye's pitch while blasted. It's only the view: the
  guns still aim where the torso points. The view eases back in 0.3 s on
  landing.

### Targeting

`sim/jets.js`:
- **`jetLock(G, m)`**, each frame while charging: the target, or `null`.
  - The player: `G.target` if it's alive, a foe, within `reach` and inside
    the lock cone (as `G.lock`). Otherwise, the foe nearest the crosshair in
    that cone and reach, which also becomes `G.target`, so the missiles
    share it.
  - It's held on `m.jet.lock` (the mech, `null` for none) with `m.jet.on`
    (true when this charge's landing reaches it).
- **The aim:** `aimBlast(m, lock, vy)` solves the flight. The time up and
  down from `vy`, with gravity 18 and the target's top as the landing height,
  gives the time `T`. The target's place at `T` is its position + its
  velocity × `T`. The speed along is (that place − here) / `T`, capped at
  `aimFwd`. `landingAt` then draws the ring where that really lands, short
  if capped. `on` is true when the ring falls within the target's top.
- **`blastOff`** with a lock and the throttle not back: `j.fly` is the aimed
  speed along, not `fwd × throttle`. `j.lock` carries into the flight.
- **The auto-steer:** `airSteer` (part 2) gains a pull while `j.lock` holds.
  - The miss is the target's place at landing (its position + velocity ×
    the time left) − `landingAt` now.
  - The pull is along the miss, enough to close it over the time left, up
    to `assist × dt` a frame. The total it adds over the flight is capped at
    `assistMax`.
  - The player's own steering is applied first and isn't capped by it.
  - Steering whose direction is more than 90° off the miss for `letGo` s
    sets `j.lock = null`.
  - The lock also drops if the target dies, or if the miss grows past 25 m
    (it got away).
- **The view** is unchanged: no camera pull. The brackets and the ring tell
  you.
- **The HUD** (`render/hud.js`): the lock's brackets close to an amber
  diamond on `j.lock`, red when `on`. `sfx.lock` chirps as `on` comes true.
  The charging ring is `drawLanding` from part 2, now also drawn while
  charging with a lock (the flight it would make).
- **The hit-stop:** an insta-stomp from a locked blast sets
  `G.hitStop = 2 × HIT_STOP`.

### The insta-stomp

`melee.js` `tryStomp`: with `m.jet.blasted` and a fall from `top` of at least
`stompFall`, the target is destroyed (`destroy(G, t, m)`, with
`lastHitMelee = 'stomp'`). Otherwise the stomp is as now.

- **Online (the arena):** the victim's client applies it, as with any stomp
  (`hitQueue`, `st: 2` for an insta-stomp). The lander's client scores it.
- `PROTOCOL` bump:
  - `jc` (charge, 0 to 9) on `s`, so others see the crouch and glow;
  - `fx` `blast` (where, how big), so others see the thunk, ring and streak;
  - `st: 2` on a hit;
  - `jt` on `s`: the net id of the mech a charge or flight is locked on, so
    its pilot sees the red ring and hears `ABOVE YOU.`
- `docs/architecture.md`'s message list is updated with them.

### The AI

- Foes used the jets to hop obstacles (`steer` returns `jets`). They now
  charge for `0.3 + 0.5 × need` s and let go, where `need` is how high the
  obstacle is.
- **Default: the AI never aims a blast-off at you**, and its stomps are the
  old stomp, never the insta-stomp. Being flattened by a JACKAL out of
  nowhere would feel cheap. It's the owner's call (Open questions).

### Edge cases

- **Shutdown, or dying while charging:** the charge is lost; no blast.
- **Charging on a slope or in a pit:** fine; the blast is up from where you
  stand.
- **A roof overhead:** the blast stops at the rock (the ceiling check, as
  now), with the thunk still.
- **The command view or SWAP mid-charge:** the charge is dropped.
- **Missiles' guide (holding to fly):** jets can't charge while you fly one.
- **The dust storm** still shoves a mech in the air.
- **Landing on a building:** the old landing; no stomp.

## Code touchpoints

- `src/data/systems.js`: `JETS` by level.
- `src/data/feel.js`: the `blastoff` row; `land` scales with the fall.
- `src/sim/jets.js` (new): charging, `blastOff`, air steering,
  `landingAt`.
- `src/sim/mech.js`: the old jet thrust and fuel go; it calls `jets.js`.
- `src/sim/melee.js`: the insta-stomp.
- `src/sim/effects.js`: `blastRing`.
- `src/sim/ai.js`, `src/sim/ai/*`: charge and release.
- `src/sim/update.js`, `src/sim/tutorial.js`, `src/data/tutorial.js`: the
  input and the new tutorial text.
- `src/render/scene.js`: the crouch while charging, the view's tilt, and the
  nozzles' glow.
- `src/render/hud.js`: the jets ring as charge and refill, and the landing
  ring.
- `src/audio/sound.js`: the charging whine, the blast's boom, and the jet
  roar for the climb only.
- `src/net/protocol.js`, `src/net/remote.js`, `src/sim/hitqueue.js`: `jc`,
  `fx blast`, `st: 2`, and `PROTOCOL` 22.

## Acceptance criteria

1. Holding JUMP charges in 0.9 s, crouching, with the ring filling. Letting
   go blasts off higher the fuller the charge, with the thunk, the dust ring,
   the shockwave and the streak.
2. A tap is a small hop.
3. In the air, the movement controls shift the landing; the view tips down
   and comes back on landing.
4. The landing ring shows where you'll come down and turns red over a mech.
5. Charging with a foe in the sights locks it. The ring shows this charge's
   landing and turns red when it reaches. Letting go then lands on a foe
   that keeps walking its way, with no steering at all.
6. In the air the auto-steer follows a slow foe that turns, but a JACKAL
   that turns hard in the last two seconds gets away. Steering away drops
   the lock, and backing up as you let go ignores it.
7. Landing on a mech from a blast-off destroys it; a plain fall onto one is
   the old stomp.
8. No blast again until the ring refills (3 s).
9. In the arena, an insta-stomp kills the other pilot; both see the blast.
10. Foes still hop obstacles, and never insta-stomp you.
11. On a phone: tap and hold the upper stick, let go, steer with the same
   thumb. Locking needs no extra button: you look at it.

## Tests

- `test/jets.test.js` (headless):
  - the charge time;
  - the height and distance by charge (hop, half, full);
  - the refill gate;
  - air steering shifts the landing;
  - `landingAt` matches where it lands (within a metre, no steering);
  - the insta-stomp destroys, and a short fall doesn't;
  - the lock: a foe in the cone and reach locks, one outside doesn't, and
    `G.target` is preferred;
  - an aimed full blast lands on a foe walking straight (no input);
  - an aimed blast with too little charge falls short;
  - the auto-steer: a WARDEN that turns is still stomped, and a JACKAL that
    turns hard at 2 s to go escapes;
  - steering away for `letGo` drops the lock; backing up blasts back;
  - shutdown and SWAP drop the charge.
- `test/melee.test.js`: the old stomp is unchanged without a blast-off.
- `test/protocol.test.js`: `jc`, `blast` and `st: 2` round-trip.
- An AI test: a JACKAL hops a wall, and its stomp on you isn't an insta-stomp.
- Smoke: hold `J` 1 s, let go: airborne, blasted, ring refilling; a blast-off
  onto a still JACKAL on the range destroys it. Touch: the same with the
  stick gesture.
- `npm run perf`: a blast-off in the bench's run segment, under budget.

## Performance

A blast is one burst of particles: dust ring, shockwave, smoke, about what a
missile's blast makes. The streak is a few puffs a frame for 1–2 s.
`landingAt` steps at most about 4 s of flight at 10 steps a second each
frame, about 40 ground samples. Nothing else measurable.

## Build order

1. **Charge and blast-off:** `m.jet`, charge, the blast, the thunk, the
   ring, the streak, the HUD ring, the sounds, and the input and tutorial.
2. **The flight:** air steering, the view's tilt, the landing ring.
3. **Targeting and the insta-stomp:** the lock, the aimed blast, the
   auto-steer, the ring while charging, the HUD's diamond, and the
   insta-stomp, in single player.
4. **The AI and online:** AI charge and release, the protocol (`jc`, `jt`,
   `fx blast`, `st: 2`), the victim's ring and voice, and the arena.

## As built

### Part 1: charge and blast-off

- **`sim/jets.js` `stepJets`** runs in `stepMech` in place of the old thrust:
  - held on the ground with the jets ready, it charges in `JETS[level].charge`;
  - let go, `blastOff`;
  - shut down, in the air or not ready, a charge is lost.
- **Two names kept with new meanings,** where the spec said they'd go, so the
  AI, the HUD and the tests needed little change:
  - `m.jetting` is JUMP held (charging);
  - `m.fuel` is how ready the jets are (0 after a blast, 1 again after
    `recharge`).
- **`m.jet`** holds `{ charge, blasted, top, fly }`. `fly` is the blast's
  speed along: `stepMech` carries the flight with it, undying, until it
  lands. A push (knockback) would have died out in a second.
- **`blastOff`:**
  - up by `vy[tap..full]` and along the legs' heading by `fwd × charge ×
    throttle`;
  - the heat; the `blastoff` feel row and `sfx.blastoff` (the missile's
    whoosh, slow, on `boom_low` and a falling sine);
  - `blastRing`: the shockwave, a scorch, a ring of dust racing out and a
    puff of smoke.
  - The climb trails flame and hanging smoke (`streak`).
- **`JETS`** in `data/systems.js` replaces `JETS_FUEL` and `JETS_CLIMB`, with
  the spec's numbers.
- **What you see and hear:**
  - The HUD's jets ring: amber with the charge, blinking white when full;
    otherwise cyan, how ready the jets are.
  - The crouch: the body squash and the cockpit's eye sink with the charge.
  - The jet loop: a whine rising with the charge, the roar up the climb.
- **Measured** (`test/jets.test.js`):
  - a tap goes 5–8 m up, a full charge 40–48 m (22–28 m before part 2's
    change);
  - at a run a full blast lands more than 50 m on; standing still it goes
    straight up;
  - a hop is down in about 1.5 s, long before the 3 s refill.
- **Foes:** the harass jump holds the jets for 1.2 s and lets go, which is now
  a full charge and a blast over you. It waits for the jets to be ready
  (`fuel >= 1`). Their landing is still the old stomp until part 3.
- **The tutorial:** the jump step completes on a blast-off, not on holding
  the button. The touch line is `UPPER STICK: TAP, HOLD, LET GO`, to fit the
  30-letter limit.
- **Smoke:**
  - `blastoff`: `J` held 1.1 s on the range is a full charge on the ground,
    and letting go is 17 m up 0.5 s later, the jets spent.
  - The touch run charges with a tap and a hold, and lets go to blast off.
- **The bench** (`sim/bench.js`): its "hop while still rolling" at 9 s is now
  a tap of the jets (5.4 m up), about the old jets' 0.8 s burst. Held for
  0.8 s it became a 25 m blast that changed what the camera saw, and
  `bench-deaths` went 3 draws over its budget.
- **Not yet:**
  - Online, other pilots see the flight but not the crouch, the ring or the
    thunk (`jc` and `fx blast` are part 3).
  - The flight is part 2 (below).

### Part 2: the flight

- **`jets.js` `airSteer`**, from the player's block in `update.js` while
  blasted and in the air:
  - throttle (W/S, the stick or the touch throttle) pushes the flight along
    the legs' heading, turn (A/D) across it, `steer × dt` m/s a second;
  - the speed along is capped at the blast's own (`j.base`, taken at the first
    push) + `JETS_FLIGHT.steerOver` (6 m/s), so it shifts a landing, never
    turns a hop into a long jump. Turn still turns the legs as well, so the
    push goes the way you turn.
- **`JETS`** gains `steer` (6, 7 with the upgraded jets) and `tilt` (0.3 rad,
  about 17°); `JETS_FLIGHT` holds `steerOver` and `tiltAt` (40 m).
- **`landingAt(G, m)`** steps the flight at 20 a second for up to 6 s, the
  same gravity, no more steering, until it meets the ground or a live mech's
  top: `{ x, y, z, mech }`.
- **The ring** is drawn in the world by `render/scene.js` `drawLanding`, not
  the HUD: the effects ring, flat on the ground at the landing point, about a
  mech's width and breathing. Green, or red over a mech.
- **The view** (`scene.js` `flightTilt`): the pitch drops by `tilt × height
  above the ground / 40 m, up to 1`, eased (a fifth of a second), and eases
  back level on landing. Only the view: the guns aim where the torso points.
- **Measured** (`test/jets.test.js`):
  - holding forward the whole flight lands more than 8 m further on than
    not steering;
  - `landingAt` at the top of a flight is within 2.5 m of where it really
    comes down;
  - it names the mech under a flight.
- **Higher and harder** (the owner, after seeing part 2: "they need to fly
  higher and blast off more intensely"):
  - a full charge goes up at 40 m/s (44 with BOOSTED jets): about 44 m up,
    4.4 s in the air and past 50 m along at a run. A tap is the same hop.
  - The `blastoff` feel row is harder than a stomp: kick 1.6, the shake at its
    cap, a quarter white-out, more squash and wobble, bass 1.6, a 110 ms
    buzz.
  - `blastRing` is bigger: a wider shockwave and, past half a charge, a second
    wider, slower one; more and faster dust; chunks of ground thrown up; a
    burst of flame where it stood; twice the smoke; a bigger scorch.
  - The streak is thicker, with a bright flame core. The sound adds a second,
    deeper boom and a longer sub-bass drop.
  - The view tips down over 40 m now, not 25.
- **Not yet:** the red ring is only a warning. Landing there is still the old
  stomp until part 3.

## Open questions

- **The AI and the insta-stomp.** Default: foes never aim blast-offs at you,
  and their landings are the old stomp. Alternatively, a HARD-only foe that
  does, telegraphed by its crouch and whine.
- **Insta-stomps in the arena.** Default: yes, as in single player: you can
  see the ring coming. If it dominates play, a later balance issue could make
  it take the target's legs instead of its life.
- **Heavies.** Default: an insta-stomp flattens anything, a WARDEN or a
  PURPLE PUNCHER too. Could need more fall for a heavy.
- **How much help.** The auto-steer's `assist` and `assistMax` are a guess:
  enough to stick a slow foe, not a quick one that dodges late. They're tuned
  on the range against a walking JACKAL and WARDEN once it's built.
- **A dive.** An option for later: at the top, tap JUMP again to cut the
  flight short and slam straight down on the lock. It's quicker, so harder
  to dodge, but a smaller stomp. Not in this spec.
- **Walking while charging.** Default: half speed. Could pin you in place for
  more commitment.
