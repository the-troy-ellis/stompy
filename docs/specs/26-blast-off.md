# Blast-off jets

| | |
|---|---|
| Status | part 1 built (spec merged in #362; the owner, 2026-10-28: "Instead of a continuous jet like in mechwarrior it should be more like a blast off mechanic where you hold down the jump jet to charge it and when you let go you shoot off like a rocket with a streak like the missiles make and a large thunk with a dust cloud and shockwave. You should be able to guide your trajectory a bit while in the air, the view should tilt down a bit so you can see below you better. If you aim right you can land on a mech and insta stomp it") |
| Milestone | M13 (proposed) |
| Size | L, split in three: charge and blast-off; the flight, the view and the landing spot; the insta-stomp, the AI and online |
| Depends on | [12-melee.md](12-melee.md) (the stomp); [13-thunk.md](13-thunk.md) (the feel table) |
| Touch parity | The same gesture as now: a tap then a hold on the upper stick charges, and letting go blasts off |

## Summary

Jump jets stop being a steady push on a fuel bar. **Hold JUMP to charge,
let go to blast off**: the mech crouches, the jets build to a roar, and on
release it shoots up like a rocket with a smoke streak behind it, a big thunk,
a ring of dust and a shockwave on the ground. In the air you steer a little
and the view tips down so you can see where you'll land. Land on a mech and
it's flattened: an **insta-stomp**.

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
    charge is about 25 m up and 40 m along.
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
- (no new voice: a stomp kill's lines are there already, and being stomped
  yourself gives the debrief's existing `FLATTENED.`)

## Design

### Numbers

`data/systems.js` `JETS` replaces `JETS_FUEL` and `JETS_CLIMB`, by JUMP JETS
level (0 none, 1 STOCK, 2 BOOSTED):

| | STOCK | BOOSTED | what |
|---|---|---|---|
| `charge` | 0.9 s | 0.75 s | empty to full |
| `vy` | 14 to 30 m/s | 15 to 33 m/s | upward speed at blast-off, by charge |
| `fwd` | 0 to 14 m/s | 0 to 16 m/s | added along the legs' heading, by charge times throttle (backing up blasts back) |
| `recharge` | 3 s | 2 s | the ring refilling after a blast |
| `heat` | 4 to 12 | 4 to 12 | added at blast-off, by charge |
| `steer` | 6 m/s² | 7 m/s² | air control, along and across |
| `tilt` | 0.3 rad | 0.3 rad | the view's tip down at the top |
| `stompFall` | 8 m | 8 m | the fall after a blast-off that makes an insta-stomp |

Gravity stays 18 m/s², so a full STOCK blast tops out at 30² / 36 = 25 m and
lands about 3.3 s later.

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
  25 m, up to 1)` to the eye's pitch while blasted. It's only the view: the
  guns still aim where the torso points. The view eases back in 0.3 s on
  landing.

### The insta-stomp

`melee.js` `tryStomp`: with `m.jet.blasted` and a fall from `top` of at least
`stompFall`, the target is destroyed (`destroy(G, t, m)`, with
`lastHitMelee = 'stomp'`). Otherwise the stomp is as now.

- **Online (the arena):** the victim's client applies it, as with any stomp
  (`hitQueue`, `st: 2` for an insta-stomp). The lander's client scores it.
- `PROTOCOL` bump:
  - `jc` (charge, 0 to 9) on `s`, so others see the crouch and glow;
  - `fx` `blast` (where, how big), so others see the thunk, ring and streak;
  - `st: 2` on a hit.
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
5. Landing on a mech from a blast-off destroys it; a plain fall onto one is
   the old stomp.
6. No blast again until the ring refills (3 s).
7. In the arena, an insta-stomp kills the other pilot; both see the blast.
8. Foes still hop obstacles, and never insta-stomp you.
9. On a phone: tap and hold the upper stick, let go, steer with the same
   thumb.

## Tests

- `test/jets.test.js` (headless):
  - the charge time;
  - the height and distance by charge (hop, half, full);
  - the refill gate;
  - air steering shifts the landing;
  - `landingAt` matches where it lands (within a metre, no steering);
  - the insta-stomp destroys, and a short fall doesn't;
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
3. **The insta-stomp, the AI and online:** the stomp, AI charge and release,
   the protocol, and the arena.

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
  - a tap goes 5–8 m up, a full charge 22–28 m;
  - at a run a full blast lands more than 40 m on; standing still it goes
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
  - Air steering, the view's tilt and the landing ring are part 2.

## Open questions

- **The AI and the insta-stomp.** Default: foes never aim blast-offs at you,
  and their landings are the old stomp. Alternatively, a HARD-only foe that
  does, telegraphed by its crouch and whine.
- **Insta-stomps in the arena.** Default: yes, as in single player: you can
  see the ring coming. If it dominates play, a later balance issue could make
  it take the target's legs instead of its life.
- **Heavies.** Default: an insta-stomp flattens anything, a WARDEN or a
  PURPLE PUNCHER too. Could need more fall for a heavy.
- **Walking while charging.** Default: half speed. Could pin you in place for
  more commitment.
