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
| `server.py` | The multiplayer arena: a stdlib WebSocket relay (port 8096). |

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

Title screen > MULTIPLAYER ARENA: up to 8 pilots on the LAN (or tailnet), free-for-all, everyone in a
KESTREL told apart by colour. First to 10 kills wins the round; then a new map after 10 s. You respawn
5 s after going down, shielded for 2 s. The in-match menu has the full scoreboard and LEAVE MATCH; the
match doesn't pause.

How it works:

- `server.py` simulates nothing. Each client is the authority for its own mech and sends its state
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

It's a static site: serve this folder with any web server
(`python3 -m http.server 8000`) and open it. There is no build step.

The multiplayer arena also needs the relay, `python3 server.py` (stdlib
Python 3, port 8096); the game connects to `ws://<page host>:8096/ws`.

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
