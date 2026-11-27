# The core

| | |
|---|---|
| Status | shipped for M0 (built in C, then ported to Rust on 2026-11-10 with the same numbers and tests; screenshots under software GL; **not yet played on a Deck**) |
| Milestone | M0 |
| Depends on | the reference's `src/data` for every number |

## Summary

The brief's "build this first, and make it great": one mech that walks on
planted feet with its legs and torso apart, overheats, loses limbs, fires
three weapon groups and the OOPS BUTTON, punches, stomps and jumps, against
an AI that uses its chassis, all of it felt. Six chassis, eleven weapons,
three difficulties, four places at four times of day, Act I's two ELIMINATE
missions. Everything in the sim is the reference's, number for number.

## Design

### Legs and torso (`sim/gait.rs`, `sim/mech.rs`)

The left stick turns the legs (`yaw`) at the chassis's turn rate and nudges
a throttle that holds. The right stick (and the gyro, and the mouse) twists
and pitches the torso within ±1.9 and -0.4..0.45 rad. Speed follows the
throttle slowly (7 m/s² up, 11 down), a climb slows a walker (a 20% grade
halves it; quads keep their grip), heat over 85 slows everything to 65%.

A planted foot never moves. One gait clock per mech advances by distance
travelled; each leg swings over its share of the cycle and lands where its
rest spot will be at touchdown plus a stance's worth ahead. The hull vaults
over the planted leg on a spring each footfall pushes down (the pendulum
body); the torso follows late on a softer spring and nods as it lags. A leg
gone: the lean and the limp. Both gone: the hull sits. In the air the legs
hang. All of the body's motion is drawn; where the mech is, its speed and its
feet are the same under any of it.

### Heat (`sim/mech.rs`)

Firing adds heat (beams per second, shells and volleys per shot, the jets at
blast-off, a punch). Sinks take it off per second. At 100 the reactor shuts
down: no movement, no firing, the sag, `Reactor shutdown.`; it restarts under
45 with `Reactor online.`. `Warning. Heat critical.` over 80, flat.

### Sections (`sim/combat.rs`)

Torso, two arms, two legs, each with hp from the chassis. A hit is routed by
where it lands on the body cylinder. A section at zero: its weapons die, the
part comes off, the overflow goes to the torso. The torso at zero: the death.

### Weapons (`sim/combat.rs`, `beams.rs`, `missiles.rs`, `fusion.rs`)

By category, each on its own control: energy (beams whose damage ramps with
the target's melt, shared by every beam on it, cooling when nothing is on
it; ANGRY ZAPPER's bolt scrambles the HUD; TOASTER pours heat in), ballistic
(ammo, cooldowns, RATATAT's bursts, BIG BONKER's recoil and shove), missiles
(ANGRY BEES home with a lock, FIRECRACKERS fly straight; tap fires, hold
guides from the nose camera, let go detonates; blasts fall off with distance
and shove), and the OOPS BUTTON: a three-second scan on one mech (a slip
under half a second pauses it; the torso is drawn toward the target), then
the pulse that kills on arrival, heat to 140, the shutdown, 35% of your own
torso.

### Melee (`sim/melee.rs`)

Everyone shoves (8 damage, 9 m reach, a 10 m/s impulse); PURPLE PUNCHER
punches (30, 14 m, 22) with whichever fist it still has, and shoves with
none. A press starts a wind-up, the hit frame takes the nearest mech within
reach and arc, then a recovery with no guns and half turn rate. Knockback is
scaled by mass (scale³), clamped 0.3..2.5×, with a fifth of it back on the
attacker. Landing on a mech after 0.6 s in the air is a stomp; from a high
blast-off, an insta-stomp.

### Jets (`sim/jets.rs`)

Hold A on the ground with the jets ready and they charge (the mech crouches);
let go and it blasts off, up by the charge and along the heading by the
throttle, with a ring of dust and a shockwave. While charging, a foe in the
sights within 80 m is locked and the blast aims at where it will be (the
STOMP cue). In the air the left stick steers a little and the lock pulls the
flight on. The landing is hard. The jets need three seconds to be ready
again.

### AI (`sim/ai.rs`)

Perception by line of sight within the difficulty's sight (400, 600, 800 m),
after its react delay (1.5, 0.8, 0.3 s), or by being hit, or an ally's shout;
lost contact for 8 s is a search round the last fix; the AI aims where it
believes you are. Profiles: baseline (keep range, cover when hot or hurt),
harass (orbit at 140..200 m, flip on a hit, jump over you within 60 m),
line (advance no faster than the slowest ally), skirmish (harass, dive to
stomp, break off at half torso), sniper (a ridge 15 m up with a view, a new
one after three shots, never squares up), brawler (walks in and punches,
never retreats, alpha under 40%). Fire discipline: a heat cap (60, 72, 85)
with a cool-down, missiles only with a lock and never under 120 m, section
targeting on HARD, an alpha when your torso is under a quarter.

### Free Play and missions (`sim/state.rs`)

Free Play: a place, a time, one to eight foes from a pool weighted light, a
difficulty. Missions: LIL SNOOZERS (two SKEDADDLEs, one asleep, one a
brawler) and FOUR LEGS BAD (a SLOWPOKE and two SKEDADDLEs; dusk into night
over four minutes). TOWER TOPPLER and HELPLESS LIL BUDDIES are listed as
SOON: they need structures and trucks (M2). Clearing mission 4 unlocks
SLOWPOKE; the rest unlock on the reference's schedule.

### The look (`game/scene.rs`, `game/mesh.rs`)

Flat-shaded polygons at the screen's resolution, one light and the
palette's sky and fog, the dither for the shockwaves' tails and the HUD's
flashes. Each chassis's parts are the reference's. The cockpit draws the
mech's own arms, drawn in and forward of the eye.

### The HUD (`game/hud.rs`)

The ring: heat up the left (amber over 55, red over 80, flashing over 85),
jets up the right with the charge inside it, speed along the bottom with a
zero tick and the throttle's notch; the damage diagram in the middle, KPH
under it. The weapons by category with their buttons, ammo and recharge
bars; OOPS BUTTON's scan and recharge. The crosshair with a hit-stop and an
X on a hit, PUNCH when a mech is in reach, STOMP when a charge is aimed. The
target's brackets, a diamond on a lock, coloured by its torso and flashing
under 15%, the distance under it, the shell's lead diamond. The radar. The
compass with the target's bearing. The messages. Everything dark under a
shutdown.

## Code touchpoints

All of `crates/`. The tests in `crates/sim/tests/`.

## Acceptance criteria

1. Every chassis walks 12 s at full throttle with no planted foot moving, its
   feet lifting, its legs within reach, a step sound per footfall (test).
2. Held beams on a BARRY reach 100, shut down, restart under 45, with the
   three lines once each (test).
3. Three seconds of beams on a SLOWPOKE melt it fully; the shooter does not
   melt; the beams off, it is cold in two seconds (test).
4. An arm at zero kills its weapon and sheds debris; both legs sit the mech;
   the torso at zero gives the beat, the blast, the wreck, the win (test).
5. A BARRY shoves a SKEDADDLE 6 m in a second and a SLOWPOKE under 3 (test).
6. A fall of 0.6 s onto a mech stomps it; a hop does not (test).
7. A three-second scan kills the target and costs the shooter 140 heat, the
   shutdown and 35% of its torso; a slip pauses, a switch restarts (test).
8. Hold A, let go: a blast-off, a landing with a kick; none with the reactor
   down (test).
9. ANGRY BEES need a lock and find the target; held, the volley is flown;
   FIRECRACKERS fly without one (test).
10. Over a minute of a four-foe fight on each difficulty, no foe's own fire
    takes it past its heat cap by more than a shot (test).
11. The owner has played it on the Deck (M1; this is the one that matters).

## Performance

Not measured on a Deck yet. Under software GL at 1280 by 800 a fight with
deaths is about 140 draws (mechs 12 to 15 each, the ground 16, effects one
per shape, beams one each) and fewer than 300 particles. The 60 should be
easy; F3 shows the numbers.

## Open questions (for the first Deck playtest)

See roadmap.md § M1.
