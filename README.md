# Stompy

A 90s-style 3D mech sim, in the spirit of MechWarrior 2. Original code and
art: raw WebGL, flat-shaded, no libraries, no build step.

You pilot a KESTREL through missions against JACKAL scouts and WARDEN heavies:
legs and torso turn independently, heat builds as you fire (100 shuts the
reactor down), damage is tracked per section, and your browser's speech engine
plays the cockpit computer.

## Files

| File | What |
|---|---|
| `index.html` | Shell page. |
| `stompy.js` | The whole game: maths, mesh builder, terrain, mechs, AI, weapons, HUD, sound, input. |
| `style.css` | Full-page layout and the briefing / pause / debrief overlay. |
| `sounds/` | CC0 clips from Kenney's Sci-fi and Impact packs. Sources and mapping in `sounds/README.txt`. |
| `favicon.svg` | The mech icon. |

## Running it

It's a static site: serve this folder with any web server
(`python3 -m http.server 8000`) and open it. There is no build step.

Settings and mission progress are kept in each browser's localStorage under
`stompy.*`.

## How it works, briefly

- **Walking.** Each mech has a gait clock driven by distance travelled, not
  time. The left foot swings over one window of the cycle, the right over the
  opposite one; a planted foot never moves, and each swing lands where its rest
  spot will be at touchdown. Legs are two-bone IK (`solveKnee`, `limb`). Leg
  lengths in `LEG` must match the `uleg`/`lleg` meshes in `buildMechParts`.
- **Sound.** `loadSamples()` decodes the clips once audio is unlocked by a
  click; `sfx.*` layers them over synthesised tones (which also stand in if a
  clip fails). Continuous hum/jet/servo loops are driven from `update()`.
- **Hit detection.** Mechs are vertical cylinders (`rayCyl`); terrain is
  ray-marched against the same triangle split the mesh uses (`ter.height`).
