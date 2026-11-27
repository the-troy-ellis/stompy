# Putting it on the Deck, and building it

The game is one binary that needs SDL2 and OpenGL 3.3, both of which the Deck
ships. A small launcher script keeps it up to date, so after one setup in
Desktop mode you never leave Game mode: every push to `main` that passes CI
becomes the next build, and the launcher installs it the next time you start
the game.

## Installing on the Deck (once, in Desktop mode)

1. Switch to Desktop mode and open Konsole. Fetch the launcher:

   ```
   mkdir -p ~/Games/stompy-rs
   curl -fsSL https://raw.githubusercontent.com/the-troy-ellis/stompy/main/deck-rs/tools/stompy-launch.sh -o ~/Games/stompy-rs/stompy-launch.sh
   chmod +x ~/Games/stompy-rs/stompy-launch.sh
   ```
2. In Steam: Games, "Add a Non-Steam Game to My Library", Browse, set the file
   type to All Files, and pick `~/Games/stompy-rs/stompy-launch.sh`. Rename the
   shortcut "Stompy (Rust)" in its Properties, so it isn't confused with the
   Electron app's shortcut (`../deck/README.md`).
3. Switch back to Game mode and start it. The first start downloads the game.

From then on, each start checks GitHub for a newer build (for at most five
seconds), downloads it if there is one (about 2 MB), checks its SHA-256, and
swaps it in whole. Offline, or if anything fails, it runs the build it already
has. The game lives in `~/.local/share/stompy-rs`; the settings stay in
`~/.config/stompy-rs/settings.txt`.

- **To skip the update check** for a session, set the shortcut's Launch
  Options to `STOMPY_NO_UPDATE=1 %command%`.
- **To pass the game arguments**, add them after `%command%`, for example
  `%command% --debug`.
- **The launcher doesn't update itself.** It is small and should rarely
  change; if it does, repeat step 1.

### If you're an agent on the Deck

You're on the owner's Steam Deck, probably in Desktop mode with a terminal
(Konsole). SteamOS's system files are read-only, so everything goes under `~`.
Don't use `sudo` or `pacman`, and don't run `steamos-readonly disable`.

1. **Fetch the launcher and run its first install:**

   ```sh
   mkdir -p ~/Games/stompy-rs && cd ~/Games/stompy-rs
   curl -fsSL -o stompy-launch.sh https://raw.githubusercontent.com/the-troy-ellis/stompy/main/deck-rs/tools/stompy-launch.sh
   chmod +x stompy-launch.sh
   ./stompy-launch.sh --window --shot 120 /tmp/stompy-check.ppm
   ```

   The last line downloads the game, checks its SHA-256, starts it in a
   window, saves frame 120 and quits. Expect `stompy-launch: updated to
   <commit>` on stderr and a non-empty `/tmp/stompy-check.ppm`. If it says
   `no build installed yet`, the `deck-rs-latest` release doesn't exist yet:
   the branch with this folder hasn't been merged to `main`, or its first
   release build failed (Actions, "Steam Deck (Rust)").
2. **Add it to Steam.** If `command -v steamos-add-to-steam` finds it (it's
   what the file manager's "Add to Steam" uses), run
   `steamos-add-to-steam ~/Games/stompy-rs/stompy-launch.sh` and ask the owner
   to confirm Steam's prompt. Otherwise ask the owner to do step 2 above.
3. **Tell the owner** it's in Game mode's library under Non-Steam, and that it
   updates itself on every start.

How a build gets published: `.github/workflows/deck-rs.yml`'s `release` job runs
on every push to `main` after the checks pass. It builds in Valve's Steam
Runtime 3 ("sniper") SDK container, whose glibc 2.31 is older than any
SteamOS 3, using `tools/build-release.sh`, and replaces the GitHub release
tagged `deck-rs-latest` (a pre-release, so it never shows as the repository's
latest release). The checksum file is also the version: a different checksum
is a new build.

## Build

On any Linux box with Rust (from rustup.rs), SDL2 headers and Mesa headers:

```
sudo apt install build-essential libsdl2-dev libgl1-mesa-dev   # Debian and Ubuntu
cd deck-rs
cargo build --release          # target/release/stompy
cargo test --workspace         # the sim's tests (no display needed)
cargo run --release -- --window    # run in a window; without --window it is fullscreen
```

The binary links SDL2 dynamically, so one built on a desktop runs on the Deck
as long as its glibc is not newer than SteamOS's. Building on the Deck itself
is cleaner.

## Building on the Deck (optional, for working on it there)

You don't need this to play: the launcher installs CI's builds. SteamOS's root is read-only and has no compiler, so build in a container:

1. Switch to Desktop mode. Open Konsole.
2. Install a toolbox: `distrobox` is in Discover (or `podman` + `toolbox`).
   `distrobox create -n build -i ubuntu:24.04 && distrobox enter build`.
3. Inside: `sudo apt update && sudo apt install -y build-essential git curl libsdl2-dev libgl1-mesa-dev`,
   then Rust: `curl --proto '=https' -sSf https://sh.rustup.rs | sh`.
4. `git clone <this repo> && cd stompy/deck-rs && cargo build --release`.
5. The binary runs from the host too (`target/release/stompy`), because the
   Deck's own SDL2 and Mesa satisfy it. Copy it anywhere on the Deck.

To play a build you made yourself instead of CI's, add `target/release/stompy`
to Steam as a non-Steam game the same way, or copy it over the launcher's
copy at `~/.local/share/stompy-rs/stompy` and start with
`STOMPY_NO_UPDATE=1` so the launcher doesn't replace it.

## The controller layout in Steam Input

The game reads the pad through SDL, so the simplest layout is the one that
passes the pad through unchanged:

- Open the controller settings for Stompy (the pad icon on its page) and pick
  the **Gamepad** template, or "Gamepad with Joystick Trackpad". Leave the
  right trackpad as a joystick or as nothing; the game reads whether a finger
  is on it for the gyro, which it reads directly.
- The back buttons: the Gamepad template leaves L4, L5, R4 and R5 unbound.
  Bind them to the **gamepad's own paddle buttons** is not an option Steam
  offers, so bind them to keys instead: L4 and R4 to **E** (punch), R5 to
  **C** (centre torso), L5 to **X** (stop). The game accepts the keys and the
  paddles alike.
- If the gyro does not reach the game through SDL in Game mode, set Steam's
  gyro to **As Mouse**, enabled while the right trackpad is touched. The game
  treats mouse motion as fine aim, so the feel is the same.

In Desktop mode SDL opens the Deck's pad directly over hidapi (the game sets
`SDL_HINT_JOYSTICK_HIDAPI_STEAMDECK`), with the paddles, the trackpads and the
gyro all present. The settings screen says whether it found a gyro.

## Performance

The target is a locked 60. Vsync is on; the sim steps at a fixed 1/60 and the
renderer draws once per display frame. The Deck's refresh rate should be 60
(the quick menu's performance tab). There is no graphics setting to turn
down and none planned: the look is cheap on purpose. F3 (or View + Y) shows
the frame rate and the draw count on the HUD. If it ever drops, the draw
count is where to look (`docs/specs/00-core.md` § Performance).

## Playtesting

The playtest checklist is in [workflow.md](workflow.md). The first time, do
the whole thing on the Deck and write down three words for how it feels.
