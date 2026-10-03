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
| `index.html` | Shell page. Loads `src/main.js` as an ES module. |
| `src/main.js` | Boots the game and runs the frame loop. Everything else is a module under `src/`. |
| `src/sim/` | The simulation: state, mechs, gait, combat, beams, the fusion cannon, missiles, the AI, the per-frame update. No DOM, no GL: it runs headless in the tests. |
| `src/render/` | WebGL setup, the 3D scene, the 2D HUD. |
| `src/audio/` | Sound effects over Kenney's clips, the loops, the cockpit voice. |
| `src/input/` | Keyboard, mouse and touch, merged into one per-frame snapshot. |
| `src/ui/` | The main menu, briefing, pause and debrief screens. |
| `src/net/` | The arena client, the wire format, remote-mech interpolation. |
| `src/data/` | Weapons, chassis, body plans, palettes, missions, colours, and `names.js` with every display name. |
| `src/world/`, `src/mesh/` | Terrain generation and the flat-shaded mesh builders. |
| `style.css` | Full-page layout and the overlays. |
| `sounds/` | CC0 clips from Kenney's Sci-fi and Impact packs. Sources and mapping in `sounds/README.txt`. |
| `server/server.py` | The multiplayer arena: a stdlib WebSocket relay (port 8096). Tests alongside. |
| `test/` | Headless unit tests (`node --test`) and the browser smoke test (Playwright). |
| `docs/` | The development plan: vision, architecture map, roadmap, workflow and per-feature specs. Start at `docs/README.md`. |

## Main menu

`mainMenu()` / `renderMenu()`: STOMPY, then CAMPAIGN (the next mission, its
intel, restart), FREE PLAY (map and number of hostiles, `startSkirmish`),
MULTIPLAYER (callsign and colour; LAUNCH joins the arena) and SETTINGS
(sound, voice, invert aim, full screen, the controls, credits). LAUNCH starts
the selected mode. On the right is the selected mech, drawn live by the game
renderer on a patch of desert (`G.worldKind === 'menu'`), turning slowly --
drag to spin it -- with SELECT MECH and arrows to cycle KESTREL / JACKAL /
WARDEN (`MECH_ORDER`, `MECH_INFO`). Every mode uses the chosen mech; in the
arena each pilot's chassis travels in their state message (`ch`). Keyboard:
up/down choose, left/right change mech, Enter launches; F2 or the pause
menu's MAIN MENU returns here.

## Controls

Weapons fire by kind, each on its own control, held to keep firing as each
weapon recharges: ENERGY (the lasers: no ammo, lots of heat), BALLISTIC (the
autocannon) and MISSILE (the LRMs, which home in on a locked target). There is
no weapon-group selection; `CAT_OF` in stompy.js maps weapons to kinds.

**Lasers are continuous beams** (`beamTick`). While ENERGY is held, each live
laser beams to the aim point every frame. The damage ramp belongs to the
*target*: a mech's armour "melt" rises while any beam is on it and cools
whenever nothing is hitting it (full to cold in 2 s), whoever is aiming where,
and damage per second is the laser's `dps` x `meltMult(melt)` -- up to 3.5x
after 3 s on one mech. Two pilots on one target share its melt. Melting armour
glows orange (and hotter in IR); the crosshair ring, the Energy bars and the
rising beam hum show the melt of whatever your beam is on. Heat is the limit:
two large lasers outrun the sinks, roughly 7 s from cold to shutdown. The AI
fires its lasers in bursts with a wandering aim and eases off before
overheating. In the arena, beam state rides in the 15 Hz state message and beam
damage is batched (`flushHits`).

**The fusion cannon** (`fusionTick` / `fusionFire`), on every mech but never
used by the AI. Hold FUSION (G / 4, or the touch button -- drag it to aim) and
a thin violet targeting laser scans whatever it's on. Keep it on one mech for
3 s. It's meant to be hard but possible, so the lock helps a little: the laser
counts within 1.5 m of a mech (`slack`, with clear line of sight), a slip
shorter than 0.5 s pauses the scan instead of resetting it (`grace`; the ring
flickers amber, LOCK SLIPPING), and while locked the torso is drawn gently
toward the target (`assist`). Off for longer, onto another mech, or letting go
-- and the scan starts over. (Tuned against a strafing Jackal at ~77 kph with
wobbly, laggy aim: no kills in 20 s under the old strict 4 s rule, kills in
5-10 s with these.) Then the reactor discharges at the target's resonant
frequency and the target is destroyed outright, whatever its armour. The cost:
heat jumps to 140 (a ~5 s overload shutdown) and the cannon recharges for
25 s. In the arena the target sees a flashing RESONANCE SCAN warning with the
scanner's name (`sc` / `sp` in the state message) and can break line of sight;
the kill travels as a `hit` with `fu: 1`, which the server passes through.

**The autocannon** is the opposite trade: big single hits, little heat, ammo.

**Guided missiles.** A tap of the missile control fires a volley as usual. Keep
holding (past 0.22 s, `HOLD_TO_GUIDE`) and you fly that volley: the view jumps
to a nose camera in white-hot infrared (the `uIR` shader path, with per-draw
`heat`), and your aim input steers it -- mouse or arrows on desktop, dragging
the held missile button or the right side on touch. Let go and every missile
still flying detonates; the view returns to the cockpit (after a moment of
SIGNAL LOST if they all hit something first). Your mech keeps walking under
its throttle meanwhile.

**Blast radius.** Every missile -- guided or not, yours or the AI's -- splashes
on impact, expiry or detonation: mechs within 10 m (`BLAST_R`) take damage
falling off with distance, on the side facing the blast (`blast()`). The mech
hit directly takes only the direct hit; the firer is never hurt. In the arena a
flown volley's path and detonation are relayed (`mg` / `md` effects) and the
shooter's client scores the splash, like any other hit.

Keyboard and mouse: the table on the briefing screen (W/S throttle, A/D legs,
mouse aims; left mouse / 1 energy, right mouse / 2 ballistic, Space / middle
mouse / 3 missiles, F everything; P/Esc pause, M mute).

Touch (phones and tablets; switches on automatically, and back to mouse mode if
a mouse is used): a floating stick on the left 40% of the screen turns the legs
and nudges the throttle (which stays set), dragging anywhere else aims, and the
buttons bottom-right are ENERGY (big), BALLISTIC and MISSILE (all hold to
fire; two can be held at once), with JUMP (hold), TGT and ZOOM above them and
STOP and pause on the left. Each finger is tracked separately, so steering,
aiming and firing combine. On touch the HUD drops the cockpit dashboard and
moves instruments to the top edge (`hudLayout()`), launching asks for full
screen and landscape, and a phone held upright is told to turn sideways.

## Multiplayer arena

Title screen > MULTIPLAYER: up to 8 pilots on the LAN (or tailnet), free-for-all, each in the chassis
they picked, told apart by colour. First to 10 kills wins the round; then a new map after 10 s. You respawn
5 s after going down, shielded for 2 s. The in-match menu has the full scoreboard and LEAVE MATCH; the
match doesn't pause.

How it works:

- `server/server.py` simulates nothing. Each client is the authority for its own mech and sends its state
  15x/s; the server stamps the sender's id and relays it. Other pilots are drawn from their latest
  state, smoothed and extrapolated (`netInterp`), and walk with the same gait.
- Shots are relayed as effects (`netFx`): drawn everywhere, scored only by the shooter. A hit the
  shooter sees is sent to the victim (`hit`), whose client applies it -- what you see is what counts,
  which feels fair on Wi-Fi but is trivially cheatable by anyone who edits the JS. Fine among friends.
- The victim declares its own death (`died`); the server keeps the scores and the round.
- The server checks the WebSocket `Origin` (stompy.* or an IP), caps players at 8, clamps hit damage,
  drops clients silent for 25 s (sleeping phones) and never waits on a slow one.
- `STOMPY_SCORE_LIMIT` / `STOMPY_ROUND_GAP` override the round settings, for testing.

## Running it

It's a static site: any web server will do, and there is no build step.

```sh
python3 -m http.server 8000        # then open http://localhost:8000
```

(or `npm run serve`, which needs no install). Single player needs nothing
else. For the multiplayer arena, also run the relay (stdlib Python 3, no
dependencies) on the same machine:

```sh
python3 server/server.py           # listens on :8096; the game connects to ws://<page host>:8096/ws
```

Phones on the same network can then open `http://<that machine's IP>:8000`.
The relay only accepts pages served from an IP address, `localhost`, or a host
named `stompy.*` (its `Origin` check). `STOMPY_SCORE_LIMIT` and
`STOMPY_ROUND_GAP` set the round length.

Settings and mission progress are kept in each browser's localStorage under
`stompy.*`.

## Developing it

`npm install` once (esbuild, ESLint and Playwright, dev-only; the game itself
has no dependencies). Then:

```sh
npm test            # headless unit tests of the simulation and data
npm run test:server # the relay's tests
npm run test:smoke  # plays a mission, and an arena round, in headless Chromium
npm run lint
npm run build       # one minified file plus the static assets, in dist/
```

`?debug=1` on the URL shows frame time, draw calls and the seed, and exposes
the state as `window.__stompy`. `?touch=1` forces the touch layout. The plan,
the architecture map and the per-feature specs are in `docs/`.

## How it works, briefly

- **Walking.** Each mech has a gait clock driven by distance travelled, not
  time. Each leg swings over its own window of the cycle (`GEO[].legs[].ph`);
  a planted foot never moves, and each swing lands where its rest
  spot will be at touchdown. Legs are two-bone IK (`solveKnee`, `limb`), with
  the knee aimed by the body plan's `knee` (forward, back, or out-and-up).
- **Body plans.** Each chassis has a leg type (`CHASSIS[].legs`), and `GEO`
  holds that type's body plan: hip height, leg lengths, which way the knee
  bends, per-leg hip and rest-foot positions and gait phase, body radius and
  height (hits, collisions, blasts) and where the torso, cockpit and weapon
  mounts sit. KESTREL is reverse-jointed (bird legs, clawed feet, missile pods
  and a domed cockpit -- the sketch), JACKAL forward-jointed, WARDEN a
  quadruped that trots on diagonal pairs with knees bowed out like a spider's.
  `buildMechParts` builds each type's meshes to match its `l1` / `l2`.
- **Sound.** `loadSamples()` decodes the clips once audio is unlocked by a
  click; `sfx.*` layers them over synthesised tones (which also stand in if a
  clip fails). Continuous hum/jet/servo loops are driven from `update()`.
- **Hit detection.** Mechs are vertical cylinders (`rayCyl`); terrain is
  ray-marched against the same triangle split the mesh uses (`ter.height`).
