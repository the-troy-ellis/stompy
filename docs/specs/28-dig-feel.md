# How digging feels

| | |
|---|---|
| Status | built. The owner, 2026-10-30: "I am trying to figure out how to make the feel of it more satisfying. The combat is pretty good especially with the blast off mechanic", then picked these two ideas: "Go ahead with 1 and 2" |
| Milestone | M12 (hold to dig), a follow-on |
| Size | S |
| Depends on | [13-thunk.md](13-thunk.md) (the feel table); [25-hold-to-dig.md](25-hold-to-dig.md) (the spin, the scoop, a run); [21-mining.md](21-mining.md) (the soft band, rock and ore) |
| Touch parity | Nothing new to press. Haptics scale with each scoop, as every feel row's do |

## Summary

Combat thunks because it has contrast and a payoff: a blast-off winds up,
lets go and lands hard. Digging had one small knock for every scoop, the same
in air, soil or rock, and the same whether the scoop took ore or not. Now a
scoop feels like what the bucket met, and a run of scoops into one face
builds to the scoop that breaks rock loose, the one that pays.

## Player experience

- **Soil, or the bucket just past the face:** a light swish and a soft
  crunch. Barely there.
- **Rock:** a clunk. The bucket's arm hitches, lagging a moment behind its
  spin, then catches up. The arm's motor strains under a low knock; the view
  rocks a little.
- **Rock breaking loose** (the scoop that turns rock to air, so the ore
  comes in): a crack about a punch's size. A big crunch, a sharp crack and a
  deep thump; the arm hitches further; the crosshair holds still a beat, as
  when a shot lands; chips fly from the face.
- **A run builds:** the scoops into one face (spec 25 § A run) each hit a
  little harder and sound a little lower, so you feel the face giving way
  until it cracks. A new run starts light again.
- In a seam, the bright clink rides on top, as before.
- No new text.

## Design

- What a scoop met, its tier:
  - 2, **crack**, when its bite turned any rock corner to air (`m.biteRock`);
  - else 1, **rock**, when the bucket's centre is below the soft band (the
    ground's new `inRock(x, y, z)`: under the built ground less `SOFT`, the
    band `dig` already uses);
  - else 0, **soil**.
- Feel rows (`data/feel.js`, tunable in DEBUG → TUNING → FEEL):

  | row | kick | shake | squash | wobble | bass | duck | dust | haptic |
  |---|---|---|---|---|---|---|---|---|
  | `scoopSoft` | 0.1 | 0.05 | 0.02 | 0.05 | 0.15 | 0 | 0.5 | 6 |
  | `scoop` (rock) | 0.45 | 0.3 | 0.05 | 0.3 | 0.7 | 0.25 | 1 | 20 |
  | `scoopCrack` | 1.0 | 0.8 | 0.12 | 0.7 | 1.1 | 0.5 | 3 | 60 |

  `scoop` was 0.35 / 0.25 / 0.04 / 0.15 / 0.55 / 0.2 / 1 / 15 for every scoop.
  A site's scoop keeps the `scoop` row.
- The build-up: `into` = (the scoop's step in its run − 1) / (steps − 1),
  0 to 1. A soil or rock scoop's k is `1 − ramp + ramp × into`; a crack's is 1.
  The sound's pitch drops by a quarter over a run.
- `FEEL.dig` (tunable): `ramp` 0.5, `hitchRock` 0.25 rad, `hitchCrack`
  0.6 rad, `hitchBack` 7 per s (how fast the arm catches up).
- **The hitch is drawn only.** The arm's drawn angle lags its spin by the
  hitch, which decays; the spin itself, and so when each bucket scoops, are
  untouched. The pace of ore, dirt and building is the same (a balance
  issue's business). That's also why the mech isn't pushed back: a push
  would move it off its run and change the pace.
- The crack's hit-stop is the player's (`G.hitStop`, `HIT_STOP`), as a shot's.
- Online: a bite isn't weighed on the guest's side (spec 21), so there's no
  crack there; rock and soil still read from the ground.

## Code touchpoints

- `src/sim/tools.js`: `scoop(G, m, arm)` takes which arm; `scoopTier` and
  `scoopFeel` (the row, the sound, the hitch, the hit-stop, chips);
  `spinArms` decays the hitch; `spinPose` draws it.
- `src/world/voxels.js`: `inRock(x, y, z)` on the ground.
- `src/data/feel.js`: the rows `scoopSoft`, `scoop`, `scoopCrack` and the
  `dig` block; `src/ui/tuning.js` shows the block.
- `src/audio/sound.js`: `scoop(at, seam, tier, into)`.

## Acceptance criteria

- At the range's mesa, a held DIG makes soil, rock and crack scoops, and
  every scoop that takes ore is a crack.
- Digging the flat's soil in front is all soil scoops.
- Through a run, `into` rises to 1, then starts again at 0.
- A crack hitches the arm and holds the crosshair; let go, the arm catches up.
- The tools tests (pace, scoops a second, the site's pace) pass unchanged.

## Tests

`test/digFeel.test.js` (the four above). The pace is `test/tools.test.js`'s,
untouched.

## Not in this spec

Ideas from the same talk, for later, each its own spec: a charged
big bite; ore heaped on the digger and a pour at the silo; construction
pieces slamming in.
