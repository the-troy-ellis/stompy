# Thunk: what Stompy feels like

| | |
|---|---|
| Status | in progress (#2 feel table and springs, #3 footfalls and landing, #4 hit wobble and recoil, #5 shutdown sag, #6 section loss, #7 death beat shipped; #8–#9 open) |
| Milestone | M1 (the table and the first pass); every later feature adds rows |
| Size | M (split: feel table + footfalls + landing; hit wobble + recoil + knockback; shutdown + death; audio layer; reduced motion) |
| Depends on | M0 |
| Touch parity | all of it is output; phones also get the vibration API where available |

## Summary

The top design pillar made concrete. One table of feedback tunables, one
spring helper, and a pass over every action and impact in the game so that
each has a camera response, a body response and a sound with low end. The
word for the target feel is *thunk*: heavy, a little cartoonish, immediately
legible. This spec is the checklist every later feature uses.

## Design

### The feel table

`src/data/feel.js` exports `FEEL`, a flat object of named numbers, grouped
by event. Nothing in the sim or renderer hardcodes a shake amount; it reads
`FEEL.<event>.<field>`. The `?debug=1` overlay (M0) gets a FEEL panel to edit
these live and copy them out, so tuning is a playtest, not a rebuild.

Groups and initial values (tune in play):

| Event | kick | shake | squash | wobble | bass | duck | dust | haptic |
|---|---|---|---|---|---|---|---|---|
| step (× scale²) | 0.25 | 0 | 0.03 | 0 | 0.4 | 0 | 1 | 10 ms |
| land (× force) | 1.0 | 0.6 | 0.25 | 0.4 | 1.0 | 0.3 | 3 | 40 ms |
| fire ac | 0.5 | 0.2 | 0 | 0.3 (torso recoil) | 0.6 | 0 | 0 | 20 ms |
| fire gauss (M2) | 0.9 | 0.4 | 0.05 | 0.6 | 1.0 | 0.4 | 1 | 40 ms |
| fire lrm volley | 0.3 | 0.3 | 0 | 0.15 | 0.5 | 0 | 2 | 20 ms |
| hit taken (× dmg/10) | 0.3 | 0.5 | 0 | 0.6 | 0.5 | 0.2 | 0 | 30 ms |
| punch hit | 1.0 | 0.8 | 0.1 | 0.5 | 1.0 | 0.5 | 2 | 60 ms |
| punched (victim) | 0.4 | 1.2 | 0.15 | 1.2 | 0.8 | 0.4 | 2 | 60 ms |
| stomp | 1.2 | 1.0 | 0.3 | 0.8 | 1.2 | 0.6 | 4 | 80 ms |
| shutdown | 0 | 0 | sag 0.4 m over 0.6 s | 0 | 0.6 | 0.8 | 0 | 0 |
| restart | 0.3 | 0.1 | overshoot 0.1 | 0.3 | 0.4 | 0 | 0 | 20 ms |
| section lost | 0.5 | 0.8 | 0 | 0.9 | 0.8 | 0.3 | 1 | 50 ms |
| mech death (own) | 1.0 | 1.5 | 0 | 0 | 1.2 | 1.0 | 0 | 100 ms |
| explosion nearby (× 1/d) | 0.4 | 0.6 | 0 | 0.3 | 0.9 | 0.3 | 0 | 30 ms |

Columns: **kick** = the dashboard/eye drop (today's `G.kick`), **shake** =
camera jitter (today's `G.shake`), **squash** = body scale pulse (y down, xz
up, via spring), **wobble** = torso/view angular spring amplitude, **bass** =
sub-bass layer gain, **duck** = hum ducking amount, **dust** = particle
burst count multiplier, **haptic** = `navigator.vibrate` ms on touch
(ignored where unsupported; a setting turns it off).

### The spring

`src/util/spring.js`: `spring(state, target, dt, { k, c })` with critically
damped defaults and an under-damped option (`c` lower) for wobble. Three
instances per mech: `m.squash` (scalar), `m.wob` (`[yaw, pitch]`), and
`m.sag` (hip height offset). The player's view adds `m.wob` to the camera
(scaled by `FEEL.view.wobble`, 0.6) so hits are felt in the eye, not just
seen on the HUD. Remote mechs run the same springs from relayed events so
everyone's hits look alike.

### The pass, action by action

- **Footfalls.** Already have sound and a small kick for the player. Add:
  kick and bass scale with `scale²`; a dust puff at the foot (biome colour);
  for mechs over scale 1.1 a tiny camera shake for *nearby* mechs (the
  player feels a PURPLE PUNCHER coming within 40 m). Cadence of the sound
  follows the gait exactly (`footDown`), which it does today; keep it.
- **Landing.** Squash on touchdown proportional to impact; the legs splay
  (knee pole pushed out 20% during the squash); heavy landings (force > 0.7)
  spawn a shockwave ring (M4 provides the mesh; until then a dust ring of
  particles).
- **Recoil.** Autocannon and gauss rock the torso back (wobble pitch) and
  nudge the mech 0.15 m backwards through `push`; the muzzle gets a flash
  quad for two frames. LRM volleys rock the torso less but longer.
- **Hits taken.** The wobble spring is kicked toward the blow (direction from
  the hit point); the player's dashboard jolts; a section-specific clang
  (arms ring higher than legs; torso is dull). Beams do not wobble per frame;
  they build a slow sway proportional to melt.
- **Knockback.** From [12-melee.md](12-melee.md): the body leans into the
  skid; feet shuffle because the gait is distance-driven; dust streaks behind
  the feet while `|push| > 2`.
- **Shutdown.** The mech sags: hips drop 0.4 m over 0.6 s with a power-down
  whine (existing clip pitched down), the HUD dims, the hum ducks hard.
  Restart snaps up with a small overshoot and the power-up clip. An enemy
  that shuts down visibly slumps, which is also information.
- **Section loss.** The part falls off: the arm or leg mesh becomes a debris
  body (falls, bounces once, stays 20 s). A mech with one leg gone leans 8°
  and limps (gait phase for the missing leg is skipped: the body dips on
  that side each cycle). A mech with both legs gone sits down (hips to the
  ground, torso upright) and can still twist and fire until its torso goes.
  This is the funniest thing in the game and it costs one gait branch.
- **Death.** A beat: on torso 0, the mech freezes for 0.25 s (no animation,
  no sound but a rising whine), then the torso blows, then the body falls
  (toppling about the feet over 0.8 s, rotation by `roll`), then secondaries.
  For the player: the beat, then the view tips with the body before the
  debrief.
- **Explosions.** Scale missile blasts 1.3× visually; add the bass layer and
  camera response by distance for anyone within 60 m; debris already
  bounces.
- **UI.** Menu selections and launches get a dull click with bass; the
  LAUNCH button already "presses" in CSS; FIT (M2) row cycles tick.

### Audio layer

`src/audio/thump.js`: one sub-bass voice (sine at 45–60 Hz with a 10 ms
attack and 150–400 ms decay, through a soft clipper) triggered by `bass`
values, mixed under the existing clips. `duck` lowers the reactor hum and
servo loops by that fraction for 250 ms with a 400 ms recovery. On phones,
the bass is barely audible on the speaker; the haptic column does that job
there.

### Reduced motion

Setting (M1 settings issue) REDUCED MOTION: multiplies `kick`, `shake`,
`wobble` (view only; the mech still wobbles) and `squash` by 0.3 and sets
`haptic` to 0. Flashes shorten. The sim is untouched.

## Code touchpoints

- `src/data/feel.js` (new), `src/util/spring.js` (new), `src/audio/thump.js`
  (new).
- `src/sim/mech.js` (springs, sag, push, limp, sit), `src/sim/gait.js`
  (missing-leg branch, splay), `src/sim/combat.js` (wobble kicks, part
  debris, death beat), `src/sim/update.js` (nearby-heavy shake, explosion
  distance response).
- `src/render/scene.js` (squash/wobble/sag/lean in `drawMech`, view wobble,
  topple, muzzle flash), `src/render/hud.js` (dashboard jolt scaled, dim on
  shutdown, FEEL debug panel).
- `src/audio/sfx.js` (section-specific clangs, ducking hooks).
- `src/input/touch.js` (haptics).
- `src/ui/menu.js` (REDUCED MOTION, HAPTICS settings).

## Acceptance criteria

1. Every row in the feel table is wired: triggering each event changes the
   corresponding fields (headless test that each event call produces the
   expected `kick/shake/squash/wob` deltas from `FEEL`).
2. Springs converge: no NaN, no runaway, settle within 2 s for any kick
   under 3 (test).
3. A mech with both legs destroyed sits and keeps firing; one leg gone limps
   with a per-cycle dip (test on `m.y` oscillation; screenshot).
4. Death has the beat: 0.25 s between torso 0 and the first explosion
   particle (test on `recordFx` timestamps).
5. REDUCED MOTION cuts view motion by the stated factors (test).
6. Side-by-side before/after recording on desktop and phone of: walking,
   landing, taking an autocannon hit, overheating, a punch (M1 shove), a
   death. Posted in the PR.
7. Playtest: three testers, sixty seconds of Free Play each, asked afterwards
   for three words. "Heavy", "chunky", "thunky", "satisfying" or synonyms from
   at least two of them.

## Performance

Springs are a few multiplies per mech. Dust puffs count against the particle
cap. The bass voice is one oscillator. Haptics are free. Nothing measurable.

## Open questions

- Haptics on by default? Default: on, with a setting; it is a big part of
  the phone feel.
- Should the sit-down-and-keep-firing state apply to the player? Default:
  yes; the voice says `Legs destroyed. We are now a turret.`
