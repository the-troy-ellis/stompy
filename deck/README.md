# Stompy on the Steam Deck

Stompy as a native Linux app: an [Electron](https://www.electronjs.org)
shell around the same `../dist/` the web version ships
([spec 40](../docs/specs/40-steam-deck.md)). It opens full screen with no
browser around it. Saves stay in the app, and the controller goes straight
to the game.

None of this is needed for the web version. Nothing in `src/` imports it,
and the root `npm ci`, `npm run build` and every web check run without it.

## Getting it onto the Deck

GitHub builds it on every push to `main` and publishes it as the
**deck-latest** release, replaced each time, under a fixed name:

```
https://github.com/the-troy-ellis/stompy/releases/download/deck-latest/Stompy-x86_64.AppImage
```

No GitHub login is needed (the repository is public). A
`Stompy-x86_64.AppImage.sha256` checksum sits beside it.

By hand:

1. On the Deck, switch to **Desktop Mode** (Steam button → Power → Switch to
   Desktop).
2. In the browser, open the link above. It downloads
   `Stompy-x86_64.AppImage`. Move it somewhere it will stay, such as
   `~/Games/`.
3. Right-click it → **Properties** → **Permissions** → tick **Is executable**.
4. Right-click it → **Add to Steam**. If that's missing: open Steam → Games →
   **Add a Non-Steam Game to My Library** → **Browse** → pick the AppImage.
5. Back in **Game Mode**, it's under Library → **Non-Steam**.

**It updates itself.** A few seconds after each launch, the app checks the
deck-latest release in the background. If there's a newer build, it
downloads it while you play, checks it against its checksum, and puts it
in place of the old file. **UPDATED · RELOAD** then appears on the main
menu; press it to restart into the new build, or just play on, and the next
launch is the new build. The path stays the same, so Steam's shortcut and
its launch options keep working. With no network, or a download that
doesn't match its checksum, it keeps the old file and plays on.
`STOMPY_NO_UPDATE=1 %command%` in the launch options turns it off. Only the
first install (or a build with a broken updater) needs Desktop Mode.

A build from a branch or a PR isn't released. It's the
`stompy-deck-appimage` artifact on that workflow run (Actions → **Steam
Deck**), which needs a GitHub login to download and comes as a zip.

## If you're an agent on the Deck

You're on the owner's Steam Deck, probably in Desktop Mode with a terminal
(Konsole). SteamOS is Arch-based. Its system files are read-only, so put
everything under `~`. Don't use `sudo` or `pacman`, and don't run
`steamos-readonly disable`. Steps:

1. **Download and check it:**

   ```sh
   mkdir -p ~/Games/Stompy && cd ~/Games/Stompy
   base=https://github.com/the-troy-ellis/stompy/releases/download/deck-latest
   curl -fL -o Stompy-x86_64.AppImage.new "$base/Stompy-x86_64.AppImage"
   curl -fL -o Stompy-x86_64.AppImage.sha256 "$base/Stompy-x86_64.AppImage.sha256"
   # the checksum names the final file, so check it under that name
   mv -f Stompy-x86_64.AppImage.new Stompy-x86_64.AppImage
   sha256sum -c Stompy-x86_64.AppImage.sha256
   chmod +x Stompy-x86_64.AppImage
   ```

   If `sha256sum -c` fails, the download was cut short. Download again;
   don't run a file that fails the check.

2. **Check it starts:**

   ```sh
   STOMPY_WINDOWED=1 ./Stompy-x86_64.AppImage & pid=$!
   sleep 15; kill -0 $pid && echo "running" ; kill $pid
   ```

   A window with the game's menu should appear, and `running` should print.
   The launcher inside the AppImage picks X11 and the sandbox by itself.
   - If it didn't start, read `~/.config/Stompy/stompy.log`. It shows the
     launcher's flags and how far the app got.
   - If the terminal mentions FUSE, use `./Stompy-x86_64.AppImage
     --appimage-extract-and-run`, and tell the owner it needs that as a
     launch option.

3. **Add it to Steam:**

   ```sh
   steamos-add-to-steam ~/Games/Stompy/Stompy-x86_64.AppImage
   ```

   Steam has to be running, which it always is in Desktop Mode. If
   `steamos-add-to-steam` isn't there, ask the owner to do it by hand:
   Steam → Games → **Add a Non-Steam Game to My Library** → **Browse**.

   Launch options can't be set from the command line. If step 2 needed a
   flag, tell the owner to open the game's **Properties** in Steam and add
   it to the launch options after `%command%`.

4. **Tell the owner:** it's in Game Mode under Library → **Non-Steam**. If
   the buttons do nothing in game, they should pick the **Gamepad**
   template in its controller settings. If a launch from Game Mode hangs on
   the Steam logo, read `~/.config/Stompy/stompy.log` afterwards: the last
   line says where it stopped.

5. **Updating later:** nothing to do. The app updates itself on launch
   (above), and its log says so (`update: up to date`, `update: installed
   …`, or `update: skipped` with why). To force it by hand, repeat step 1;
   the path stays the same. Saves live in `~/.config/Stompy/` and survive
   updates.

**Building it on the Deck instead** (only if the release is missing, or you
were asked to build a branch): Node isn't installed on SteamOS, so put it in
`~`:

```sh
mkdir -p ~/.local/node && curl -fL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz \
  | tar -xJ -C ~/.local/node --strip-components=1
export PATH="$HOME/.local/node/bin:$PATH"
git clone https://github.com/the-troy-ellis/stompy ~/src/stompy && cd ~/src/stompy   # or git pull, or check out the branch
npm ci && npm run build
cd deck && npm ci && npm run appimage
cp out/Stompy-*-x86_64.AppImage ~/Games/Stompy/Stompy-x86_64.AppImage
```

Then continue from step 2.

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

The app starts through a small launcher that handles the two known Game
Mode problems itself: it asks for X11 (gamescope only shows X11 windows),
and it turns Chromium's sandbox off where SteamOS doesn't allow it. No
launch options are needed.

Every launch writes a log to `~/.config/Stompy/stompy.log` (the one before
it is `stompy.log.1`). If the Steam logo just spins, or it closes at once,
that file says how far it got: the launcher's flags, then `start`, `ready`,
`window`, `page loaded`, and any process that died. Send it over.

Launch options still work for testing:
- `STOMPY_QUERY=debug=1 %command%`: the debug overlay (frame times, what the
  controller reports).
- `STOMPY_WAYLAND=1 %command%`: skip the X11 choice.

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

- `.github/workflows/deck.yml` builds the AppImage. On `main` it also
  replaces the `deck-latest` release, with the AppImage under a fixed name
  and its checksum.
- `afterPack.cjs`: electron-builder's hook. It puts a launcher script where
  the app's executable was (the real one becomes `stompy-deck.bin`). The
  launcher passes `--ozone-platform=x11` when there's an X display (gamescope
  shows only X11 windows) and `--no-sandbox` when user namespaces aren't
  allowed or it runs as root, and writes `~/.config/Stompy/stompy.log`.
- `preload.cjs`: the page's only view of Electron, `window.stompyShell`
  (`onUpdateReady`, `restart`). The game's platform layer
  (`src/platform/index.js onShellUpdate`) turns it into the menu's
  UPDATED · RELOAD, the same button the offline web version uses.
- `main.cjs`: the window and a `stompy://game/` scheme serving `game/` (the
  copied web build). It isn't `file://`, so modules, the ground's worker and
  saves behave as they do on the web. The window shows at once, black,
  rather than waiting for a first frame. Navigation can't leave the game.
  Sound starts without a click, since a controller press doesn't count as a
  gesture in the browser. It logs each step of the launch to the same file.
  It updates itself (`update()`): 5 s after the window opens it compares
  the release's `.sha256` with a hash of `$APPIMAGE`. On a difference it
  downloads to `<AppImage>.download`, hashing as it goes, and renames over
  the AppImage only on a match. Off without `$APPIMAGE` (`npm start`) or with
  `STOMPY_NO_UPDATE`; `STOMPY_UPDATE_URL` points it elsewhere, for tests.
- `package.json`: Electron and electron-builder, pinned, and the AppImage
  settings.
