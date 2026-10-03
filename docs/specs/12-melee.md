# Melee: punch, shove, stomp

| | |
|---|---|
| Status | in progress (#10 knockback shipped; #11–#14 open) |
| Milestone | M1 (shove, stomp, knockback, AI, arena); M2 adds PURPLE PUNCHER's real punch |
| Size | M (split: knockback + shove + stomp; animation + feedback; AI; arena) |
| Depends on | M0; [13-thunk.md](13-thunk.md) for the feedback table it feeds |
| Touch parity | one PUNCH button; stomps need no input |

## Summary

A fourth way to hurt something: get close and hit it. Every chassis can
shove; PURPLE PUNCHER (M2) has fists and a real punch. Landing from jump jets
on a mech is a stomp. All three deliver knockback scaled by the masses
involved, which is where the comedy and the tactics both come from: a
JACKAL shoved off a ridge, a WARDEN that barely notices.

## Player experience

A fist icon appears beside the crosshair when a mech is within reach and
roughly in front of you; the touch PUNCH button lights up at the same time
(it is always present, dim when nothing is in reach). Press it: the torso
rears back for a beat, the arm (or the whole body, for a shove) drives
forward, and if anything is there it takes a crunch and goes skidding. The
camera kicks hard. Miss and you lurch forward with a whiff; there is a
recovery before you can swing again.

Jump onto a mech and land on it: a stomp. Both of you shake, it takes damage
on top, you bounce off a little. PURPLE PUNCHER's stomp is a small
earthquake.

Desktop: `E` or mouse button 4. Touch: PUNCH in the button cluster (the
touch layout issue places it; proposal: left of BALLISTIC, so the two
"close-in" buttons sit together). Gamepad (M6): right stick click.

Text: `PUNCH` on the button. Voice: from the tone guide pool (`Target
punched.`, `Fist contact confirmed.`, `Target stomped. Literally.`). Debrief
gains a PUNCHES line and a FARTHEST SHOVE distance.

## Design

### Numbers

Per-chassis `melee` block in `CHASSIS` (defaults for anyone without one):

| Field | Default (shove) | PURPLE PUNCHER (punch) | Meaning |
|---|---|---|---|
| `dmg` | 8 | 30 | damage to the struck section |
| `reach` | 9 × scale | 14 × scale | metres from body centre |
| `arc` | ±30° | ±25° | of torso facing |
| `windup` | 0.3 s | 0.45 s | before the hit frame |
| `recover` | 0.7 s | 0.9 s | after the hit frame, no firing, half turn rate |
| `cd` | 1.5 s | 2.0 s | from press to next press |
| `heat` | 2 | 4 | |
| `knock` | 10 | 22 | base impulse, m/s |
| `stompDmg` | 6 | 18 | landing on a mech |
| `stompKnock` | 6 | 14 | |

Melee is unaffected by section loss except that PURPLE PUNCHER with a
destroyed arm punches with the other at full strength, and with both arms
gone falls back to the shove values.

### Knockback

A new per-mech field `m.push = [vx, vz]` added to movement in `stepMech`
each frame and decaying `push *= max(0, 1 − 4·dt)`. Impulse applied to the
target is `knock × (attacker.mass / target.mass)` clamped to `[0.3, 2.5] ×
knock`, where `mass = ch.scale³` (so a 1.3-scale PURPLE PUNCHER is 2.2 units
and a 0.8-scale PIPSQUEAK is 0.5). Direction: from attacker to target,
flattened. The attacker takes a small recoil impulse the other way (0.2×).
Knockback also jolts the target's `twist` by ±0.3 rad toward the blow and its
`pitch` up 0.1, decaying through the thunk wobble spring, so a punched mech
loses its aim for a moment without losing control.

Being knocked while airborne keeps the impulse; being knocked into terrain
that rises steeply just stops (no wall damage; keep it simple). Being knocked
off a drop plays the landing squash on arrival. Mechs do not take fall damage
today; melee does not add it.

Missiles' blast gains a small knockback too (`BLAST_R` falloff × 4 m/s), so
LRMs rock a light mech. Shells and beams do not.

### Punch resolution

On press (`held.melee` edge, not hold): if `cd === 0`, not shutdown, alive,
not guiding missiles, start `m.melee = { t: 0, phase: 'windup' }`. At
`windup` the hit frame fires once: pick the nearest alive mech or entity
whose body cylinder is within `reach` of the attacker's torso centre and
within `arc` of the torso facing (`viewYaw`); if found, `damage(target,
point, dmg, attacker)` with `point` on the target's cylinder surface nearest
the fist so section routing works (arm or torso, by height and side), apply
knockback, play impact feedback; if not, play the whiff. Then `recover`,
then free. Pressing during `windup` or `recover` does nothing.

Structures can be punched (they do not move; vehicles slide a little).

### Stomp

In `stepMech`'s landing branch (`m.air` true → false): if a mech's body
cylinder is within `radius × 1.2` horizontally and its top is within 3 m
below the lander's feet, it is stomped: `stompDmg` to its torso, `stompKnock`
away from the lander, the lander's `vy` set to +4 (a bounce) and pushed 0.5×
the other way. Requires the lander to have been airborne at least 0.6 s (a
hop does not count) and jets are not required (falling off a ridge onto
someone counts). The AI (M1) will deliberately stomp with the harass profile
when above a target.

### The player's own mech

The player can be punched, shoved and stomped by the AI and by other pilots.
Knockback moves the player's mech the same way; the view wobbles via the
thunk spring. Being stomped while shut down is the game's cruellest moment
and is allowed.

### Animation

`drawMech` reads `m.melee` and `m.push`:

- Windup: torso pitches back 0.15 rad and twists 0.1 rad away from the
  punching arm; the arm part rotates back at the shoulder (−0.9 rad).
- Hit frame to +0.15 s: torso lunges forward 0.2 rad, arm snaps to +0.6 rad
  then eases back over `recover`.
- Shove (no fists): the whole body lunges, both arms tuck.
- Knockback: legs keep walking normally (the gait is distance-driven, so a
  skidding mech's feet shuffle, which looks right); the body leans into the
  push by `|push| × 0.02` rad.
- PURPLE PUNCHER's fists are separate parts (`buildFist`) so they can swing
  and so they read as fists from across the map.

### Feedback (from the thunk table)

Punch hit: `punch` clip at 1.0 plus sub-bass thump, camera kick 1.0 and
shake 0.8 for the attacker, shake 1.2 and the wobble spring for the target,
8 spark particles and 2 armour plates at the point, a 0.06 s hit-stop on the
attacker's crosshair ring. Whiff: `punch` at 0.3, pitch up, a forward lurch
of the eye by 0.3 m. Stomp: `land` with force 1 plus `crunch`, shockwave
ring, dust burst, both shakes.

### AI

- Any profile within reach and facing within `arc`, with `cd === 0`, punches
  with probability by difficulty (EASY 30%, NORMAL 60%, HARD 90% per
  opportunity second).
- `harass` keeps outside the target's reach ×1.3 except when diving in to
  stomp or when the target is shut down (then it closes and punches; a shut
  down player being punched by a JACKAL is correct Stompy behaviour).
- PURPLE PUNCHER's profile (`brawler`, M2) closes to reach and punches,
  using its cannon on the way in and never retreating; it will stomp if it
  has jets (it does not by default; the system slot can add them).

### Arena

- `fx { k: 'pu' }` announces a swing (so others see the windup); the hit
  travels as a normal `hit` with `kb: [vx, vz]` and `me: 1`; the victim's
  client applies `push` and the wobble. The server clamps `kb` components to
  ±30. Stomps send `hit` with `st: 1` and `kb`.
- `s` gains `pu` (0/1/2: none, windup, recover) so remote mechs animate.
- Punch kills count for the scoreboard like any kill; the kill feed shows a
  fist glyph.

## Code touchpoints

- `src/data/chassis.js`: `melee` blocks; `src/data/feel.js` (thunk table)
  entries for punch/whiff/stomp.
- `src/sim/melee.js` (new): `meleePress`, `meleeTick`, `resolvePunch`,
  `applyKnock`, `tryStomp`.
- `src/sim/mech.js`: `push` integration, stomp check on landing, recover
  state limits firing and turn rate.
- `src/sim/update.js`: tick melee; blast knockback in `missiles.js`.
- `src/sim/ai/behaviours.js`, `fire.js`: punch decisions, reach avoidance.
- `src/render/scene.js` (`drawMech`): animation; `src/mesh/mechParts.js`:
  fists (M2).
- `src/render/hud.js`: fist icon, PUNCH button state, debrief lines.
- `src/input/*`: `E`, mouse 4, PUNCH button, gamepad later.
- `src/net/protocol.js`, `client.js`, `server/server.py`: `pu`, `kb`, `me`,
  `st`.
- `src/audio/voice.js`: punch and stomp pools.

## Acceptance criteria

1. Headless: a KESTREL shoving a JACKAL at rest moves it ≥ 6 m within 1 s;
   shoving a WARDEN moves it < 3 m; the shover recoils ≈ 0.2× (test).
2. Punch resolution picks the nearest target within reach and arc and routes
   damage to the facing arm or torso by side (test with offsets).
3. No punch while shut down, during recover, during windup, or while guiding
   missiles (test).
4. Stomp: a mech falling 0.6 s+ onto another applies `stompDmg` and bounces;
   a hop does not (test).
5. The player can be knocked back and the view wobbles (playtest, desktop
   and phone); the touch PUNCH button lights when a target is in reach.
6. Arena: a punch on another pilot moves their mech on their screen and
   shows the windup on both (two clients).
7. AI punches the player when adjacent on HARD within 3 s of opportunity
   (test), and the harass profile stays out of reach otherwise.
8. Playtest: three testers each shove a JACKAL off a slope and at least two
   of them laugh or say something to that effect. This is a real criterion.

## Tests

`melee.test.js` for 1–4 and 7; `protocol.test.js` additions for `pu`/`kb`.

## Performance

Nothing measurable: one cylinder test per punch, one per landing.

## Open questions

- Should a punch to a melted section (beam melt) do bonus damage? Proposal:
  yes, `× meltMult`, which rewards the laser-then-punch combo. Default: yes.
- Fall damage from being knocked off something tall. Default: no.
