# Stompy on the Steam Deck

Stompy as a native Linux app: an [Electron](https://www.electronjs.org)
shell around the same `../dist/` the web version ships
([spec 40](../docs/specs/40-steam-deck.md)). It opens full screen with no
browser around it. Saves stay in the app, and the controller goes straight
to the game.

None of this is needed for the web version. Nothing in `src/` imports it,
and the root `npm ci`, `npm run build` and every web check run without it.

## Getting it onto the Deck

GitHub builds it on every push to `main` (and by hand: Actions →
**Steam Deck** → **Run workflow**).

1. On the Deck, switch to **Desktop Mode** (Steam button → Power → Switch to
   Desktop).
2. In the browser, open the repository's **Actions** tab, then **Steam
   Deck**, then the latest green run. Download the `stompy-deck-appimage`
   artifact, a zip.
3. Unzip it (Dolphin: right-click → Extract). Move
   `Stompy-0.1.0-x86_64.AppImage` somewhere it will stay, such as
   `~/Games/`.
4. Right-click it → **Properties** → **Permissions** → tick **Is executable**.
5. Right-click it → **Add to Steam**. If that's missing: open Steam → Games →
   **Add a Non-Steam Game to My Library** → **Browse** → pick the AppImage.
6. Back in **Game Mode**, it's under Library → **Non-Steam**.

### Controls

Steam presents the Deck's controls to the game as an Xbox controller:

| | |
|---|---|
| Left stick | legs and throttle |
| Right stick | torso and aim |
| RT / LT / RB / LB | energy / missiles / ballistic / fusion |
| A / B / X / Y | jump jets / centre torso / next target / zoom |
| R3 (right stick click) | punch |
| D-pad | up lights, down stop, right SWAP |
| Menu (☰) | pause |

If the buttons do nothing in game, open the game's controller settings
(the controller icon on its Steam page) and pick the **Gamepad** template.

### If it won't start

Open its **Properties** in Steam and set the launch options to:

```
%command% --no-sandbox
```

For the debug overlay (frame times, what the controller reports), use
`STOMPY_QUERY=debug=1 %command%` instead.

## Building it yourself

This needs Node 22 on any x86-64 Linux, the Deck's Desktop Mode included.

```sh
npm ci && npm run build        # the web build, in the repo root
cd deck && npm ci
npm start                      # runs it in a window from source (copies ../dist in)
npm run appimage               # out/Stompy-<version>-x86_64.AppImage
```

`STOMPY_WINDOWED=1 npm start` opens a 1280×800 window instead of full screen.
F11 toggles full screen.

## What's here

- `main.cjs`: the window and a `stompy://game/` scheme serving `game/` (the
  copied web build). It isn't `file://`, so modules, the ground's worker and
  saves behave as they do on the web. Navigation can't leave the game. Sound
  starts without a click, since a controller press doesn't count as a
  gesture in the browser.
- `package.json`: Electron and electron-builder, pinned, and the AppImage
  settings.
