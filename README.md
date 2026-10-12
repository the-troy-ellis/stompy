# Stompy

You drive a big walking robot. You stomp other big walking robots.

Stompy is a mech sim in the style of the mid-90s: flat-shaded polygons,
chunky pixels, a cockpit that rattles when you walk. It runs in a browser on
a computer or a phone held sideways. It has no libraries and needs no
install.

## Playing

Open the game, pick a mech on the right, and press LAUNCH.

- **CAMPAIGN:** twelve missions, one after another. Clearing them opens new
  mechs.
- **FREE PLAY:** one fight. You pick the map, how many hostiles, the mix,
  the weather and the time of day.
- **MULTIPLAYER:**
  - The ARENA, free-for-all or teams, for up to 8 pilots.
  - A private arena that friends join with a four-letter code.
  - CO-OP: fly a campaign mission together, up to 4 pilots.
- **SETTINGS:** sound, controls, display and difficulty.

Mission 1 teaches the controls the first time, one prompt at a time.

### How it plays

- **Legs and torso turn apart.** The legs go where you steer; the torso
  aims. Walk one way, shoot another.
- **Heat.** Every shot warms the reactor. At 100 it shuts down and you
  stand there. Ease off before that.
- **Lasers** are beams. Hold one on a mech and the damage climbs, and so
  does your heat.
- **The autocannon** hits hard and stays cool, but it runs out.
- **Missiles:** tap to fire. Hold to fly them yourself; let go and they go
  bang.
- **The fusion cannon:** hold its scan on one mech for 3 seconds and that
  mech is gone. It also hurts you, and shuts you down.
- **Punch** whoever is in reach. Land on a mech from a jump and you stomp
  it.
- **Damage** is per section: arms, legs, torso. Lose a leg and you limp.
  The cockpit voice tells you the bad news.

### Controls

**Keyboard and mouse**

| | |
|---|---|
| W / S | throttle up / down (it stays set) · X full stop |
| A / D | turn the legs |
| Mouse | twist the torso and aim (arrows work too) |
| Left mouse / 1 | lasers (hold) |
| Right mouse / 2 | autocannon (hold) |
| Space / 3 | missiles: tap to fire, hold to fly them |
| G / 4 | fusion cannon (hold) |
| F | fire everything |
| E / mouse 4 | punch |
| J | jump jets (hold) |
| T · R | next target · the target under the crosshair |
| C · Z · L | torso back over the legs · zoom · headlights |
| P / Esc | pause · M mutes |

**Touch** (switches on by itself on a phone or tablet):
- **Upper left:** drag to aim. Sideways turns the mech; double tap puts the
  torso back over the legs.
- **Lower left:** drag up and down for throttle, sideways to twist.
- **Right:** hold-to-fire buttons (ENERGY, BALLISTIC, MISSILE, FUSION), plus
  PUNCH, JUMP, TGT, ZOOM and STOP.

**Gamepad** (any standard pad, on a computer or a phone):

| | |
|---|---|
| Left stick | legs and throttle |
| Right stick | torso (and steers flown missiles) |
| RT / LT / RB / LB | lasers / missiles / autocannon / fusion |
| A / B / X / Y | jump / torso back / next target / zoom |
| Right stick click | punch |
| D-pad up / down | headlights / full stop |
| Start / Back | pause |

On a menu, the D-pad moves and A presses.

### Install it

On a phone, add the game to the home screen from the browser's menu (Chrome
or Safari). It then opens full screen, sideways, and plays single player
without a connection.

### Settings worth knowing

- **HUD SCALE** makes the instruments bigger.
- **COLOURS** has modes for red-green and blue-yellow colour blindness.
- **REDUCED MOTION** calms the camera.
- **FOV** widens or narrows the view.
- **GAMEPAD / MOUSE / TOUCH** set aim speed.

## Hosting

The game is static files: any web server will do. `npm run build` makes
them in `dist/`. `npm run zip` packs them for itch.io.

Multiplayer needs the relay, one small Python program with no dependencies:

```sh
python3 server/server.py     # listens on :8096; the game finds it at ws://<page host>:8096/ws
```

- **On a home network:** run the relay on the machine serving the game.
  Phones open `http://<that machine's IP>:8000`.
- **On the internet:** `server/deploy/README.md` takes a small server to a
  relay behind TLS in about fifteen minutes. `server/Dockerfile` runs it on
  a container host.
- **Every flag and limit:** `server/README.md`.

A hosted copy finds its relay through the RELAY field, `?relay=`, or a
default baked in at build time (`RELAY_DEFAULT`).

## Developing

Play from the source with no build: `npm run serve` (or any static server),
then open `http://localhost:8000`. Settings and progress live in the
browser's localStorage under `stompy.*`.

`npm install` once for the dev tools (esbuild, ESLint, Playwright; the game
itself has no dependencies). Then:

```sh
npm test            # headless tests of the simulation and data
npm run test:server # the relay's tests
npm run test:smoke  # plays missions, arena rounds and co-op in headless Chromium
npm run perf        # the frame-cost harness and its budgets
npm run lint
npm run build       # one minified bundle plus the static files, in dist/
npm run zip         # dist/ as stompy-<version>.zip
```

`?debug=1` shows frame time, draw calls and the seed, and exposes the state
as `window.__stompy`. `?touch=1` forces the touch layout.

**The plan of record is in `docs/`.** Start with `docs/README.md`:
- the vision and tone guide;
- the architecture map, with the module layout, invariants and protocol;
- the roadmap;
- the workflow and definition of done;
- a spec per feature.

In short:

| Where | What |
|---|---|
| `src/sim/`, `src/data/`, `src/world/` | The simulation: no DOM, no GL, tested headlessly. Every display name is in `src/data/names.js`. |
| `src/render/`, `src/audio/`, `src/input/`, `src/ui/`, `src/net/` | Drawing, sound, controls, screens and multiplayer. |
| `server/` | The relay, its tests and the deploy kit. |
| `test/` | Unit tests and the browser smoke test. |

Releases: bump `package.json`'s version, then push a tag `v<version>`. A
GitHub Release with the zip and notes follows (`.github/workflows/release.yml`).

## Credits

- **Code and art:** original. Raw WebGL, flat-shaded, no libraries.
- **Sound effects:** [Kenney](https://kenney.nl), CC0 (`sounds/README.txt`
  lists the sources).
- **The cockpit voice:** your browser's own speech engine.
- **Fonts:** none ship; the game uses the fonts your system already has.
