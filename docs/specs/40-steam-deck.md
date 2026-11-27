# Stompy on the Steam Deck

| | |
|---|---|
| Status | part 1 built (the native shell). The owner, 2026-11-09: "the plan is to make this for the steam deck. Its a platform that i already own with a set control layout. I could release it on steam if i change my mind down the road. Being linux based will help with testing"; on the framework: keep the web code and wrap it; then "I want to run the game natively not in a browser asap, so electron is a priority" |
| Milestone | M17 (proposed) |
| Size | part 1 S; later parts sized when the playtest notes say what they are |
| Depends on | [11-release.md](11-release.md) (the build), [24-apps-and-unlock.md](24-apps-and-unlock.md) (the platform layer, and the rule that native tooling never breaks the web) |
| Touch parity | not a touch feature: the Deck is a controller in two hands |

## Summary

Stompy is made for fun, and its home is the Steam Deck: a screen, a control
layout and a Linux machine the owner has. The game stays a web game, one
codebase. On the Deck it runs as a native app: an Electron shell around the
same `dist/`, full screen in Game Mode with no browser anywhere. A Steam
release stays possible later, from the same shell, and nothing here depends
on it.

## Player experience

- In Game Mode, Stompy is in the library (as a non-Steam game). It opens
  straight into the menu, full screen at 1280×800. There's no browser and no
  address bar, and there's sound from the start.
- The Deck's controls reach the game as an Xbox-style controller (Steam
  Input), in the existing pad layout (`input/gamepad.js`).
- Saves (settings, campaign, loadouts) live in the app and survive updates.
- Leaving the game is Steam's own (Steam button → Exit game).

No new text.

## Design

### Part 1: the native shell (built)

- `deck/`: its own `package.json` with Electron and electron-builder,
  pinned exact. It isn't part of the web's dependencies, like `app/` for the
  phones.
- `deck/main.cjs` opens one window, full screen, with no menu bar. It
  serves the copied web build (`deck/game/`, from `../dist`) on a scheme of
  its own, `stompy://game/`, not `file://`. ES modules, the ground's
  worker, `fetch()` and saves then behave as they do on the web, under one
  origin that never changes.
- Navigation can't leave `stompy://game/`; new windows are denied.
- Autoplay is allowed, because a controller press isn't a user gesture to
  Chromium and the Deck may have no other kind. The audio invariant ("audio
  only after a gesture") is about browsers; the app has no such rule, and the
  game's unlock still runs on its first synthetic click.
- F11 toggles full screen. `STOMPY_WINDOWED=1` opens a window;
  `STOMPY_QUERY=debug=1` passes the page its query (the debug overlay).
- The service worker isn't registered (`ui/pwa.js` only registers over https
  or localhost) and isn't packaged: the app's files are its cache.
- `.github/workflows/deck.yml` builds the AppImage on pushes to `main`, on
  PRs touching `deck/`, and by hand. The artifact is `stompy-deck-appimage`.
  On `main` it also replaces the **deck-latest** release:
  `Stompy-x86_64.AppImage` under a fixed name, plus its `.sha256`, fetched
  with one `curl` and no GitHub login (the repository is public).
- `deck/README.md` says how to put it on the Deck: by hand, and step by step
  for an agent on the Deck (download and checksum into `~/Games/Stompy`,
  a start check, `steamos-add-to-steam`, updating, and building there with
  Node under `~` if the release is missing). Nothing needs `sudo`; SteamOS's
  system files stay read-only.

### Fix: the spinning logo in Game Mode (2026-11-12)

The owner's first launch from Game Mode sat on Steam's spinning logo. The
likely cause: Electron chooses Wayland whenever a Wayland socket exists, and
gamescope has one, but Game Mode only shows X11 windows. A second risk: the
window waited for its first frame (`ready-to-show`) before showing.

- The packaged app now starts through a launcher script
  (`deck/afterPack.cjs`, electron-builder's afterPack hook; the Electron
  binary becomes `stompy-deck.bin`). With an X display it passes
  `--ozone-platform=x11`. It passes `--no-sandbox` when unprivileged user
  namespaces aren't allowed (`unshare -Ur` fails) or it runs as root. Both
  have to be on the command line, before any app JavaScript runs.
- The window shows at once, black.
- Every launch logs to `~/.config/Stompy/stompy.log` (the previous launch is
  `.1`): the launcher's flags, Electron's own output, and the app's steps
  (`start`, `env`, `ready`, `window`, `gpu`, `page loaded`), plus any process
  that dies.

Checked in the container: with `WAYLAND_DISPLAY` set, the launcher chose X11
and the page loaded. Deck check: open.

### Part 3: it updates itself (built)

The owner, 2026-11-12: "Is it possible for the game to download and install
its own updates so i don't have to keep switching between game mode and
desktop mode?" Then "Go ahead".

- **When.** 5 s after the window opens, in the background (`deck/main.cjs
  update()`). The app fetches `deck-latest/Stompy-x86_64.AppImage.sha256`
  and compares it with a hash of its own file (`$APPIMAGE`, which the
  AppImage runtime sets).
- **On a newer build.** It downloads `Stompy-x86_64.AppImage` to
  `<AppImage>.download` beside it, hashing as it goes. It renames that over
  the running AppImage only if the hash matches the release's checksum.
  Linux lets a running file be replaced, and the path doesn't change, so
  Steam's shortcut and its launch options keep working.
- **Telling the player.** The page hears of it through `preload.cjs`
  (`window.stompyShell`) and the platform layer
  (`src/platform/index.js onShellUpdate`). The main menu shows the button the
  offline web version already uses, **UPDATED · RELOAD**: no new text. The
  button relaunches the AppImage (`app.relaunch` with `execPath:
  $APPIMAGE`); otherwise the next launch is the new build.
- **Failures change nothing.** No network, a 404 (say, mid-publish), a
  checksum mismatch or a folder it can't write: it logs `update: skipped …`
  or `update: checksum mismatch, discarded`, removes the partial file, keeps
  the old AppImage, and plays on.
- **Switches.** Off outside an AppImage (`npm start`) and with
  `STOMPY_NO_UPDATE=1`. `STOMPY_UPDATE_URL` points it at another release,
  for tests.
- **Checked in the container** under Electron with a fake release on a local
  server: a new build was downloaded, checked and swapped in; the menu
  showed UPDATED · RELOAD; pressing it relaunched the new file. A wrong
  checksum left the old file and no `.download` behind.
- Deck check: open. Desktop Mode is needed once more, to install the first
  build that has the updater.

### Later (from the playtest notes, not decided here)

What the Deck changes in the game itself waits for the owner's playtest
notes (no fixes before the data):
- the controls designed for the Deck: its back buttons, trackpads and gyro
- the HUD at 1280×800 in the hands
- the performance budget moving from the phone to the Deck
- a Steam build (Steamworks), if ever

## Code touchpoints

- `deck/` (new): `main.cjs`, `package.json`, `README.md`.
- `.github/workflows/deck.yml` (new).
- `.gitignore`: `deck/game/`, `deck/out/`.
- `CLAUDE.md`, `docs/architecture.md`: Electron and electron-builder join the
  native tooling the web never needs.

Nothing in `src/` changes.

## Acceptance criteria

1. `npm run appimage` in `deck/` (after the root build) makes
   `out/Stompy-<version>-x86_64.AppImage`. The workflow uploads it, and on
   `main` publishes it as `deck-latest/Stompy-x86_64.AppImage`.
2. The app opens full screen into the menu, plays a match, and keeps
   settings between runs, with no browser.
3. On the Deck, added as a non-Steam game, it runs in Game Mode, and the
   controller drives the mech (checked on the owner's Deck).
4. The web version, its build and every web check are unchanged.

## Tests

- Checked in the container: the shell loaded the game from `stompy://game/`
  under xvfb (software GL), Free Play started, saves were written under one
  origin, and the packaged AppImage started.
- On the Deck: the owner's first run.

## Open questions

1. **Sandbox on SteamOS.** Electron's sandbox needs unprivileged user
   namespaces. If the app won't start on the Deck, the README's
   `--no-sandbox` launch option is the fallback. *Default: sandbox on.*
2. **Steam release.** *Default: not now.* The shell is where Steamworks
   would go.
