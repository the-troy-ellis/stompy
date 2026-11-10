# Building it and putting it on the Deck

The game is one binary that needs SDL2 and OpenGL 3.3, both of which the Deck
ships. No installer, no launcher, no store.

## Build

On any Linux box with a C compiler, SDL2 headers and Mesa headers:

```
sudo apt install build-essential libsdl2-dev libgl1-mesa-dev   # Debian and Ubuntu
cd deck
make            # build/stompy
make test       # the headless sim tests (no SDL or GL needed)
make lint       # the sim imports no platform
./build/stompy --window    # run in a window; without --window it is fullscreen
```

The binary links SDL2 dynamically, so one built on a desktop runs on the Deck
as long as the glibc is not newer than SteamOS's. Building on the Deck itself
is cleaner.

## Building on the Deck

SteamOS's root is read-only and has no compiler, so build in a container:

1. Switch to Desktop mode. Open Konsole.
2. Install a toolbox: `distrobox` is in Discover (or `podman` + `toolbox`).
   `distrobox create -n build -i ubuntu:24.04 && distrobox enter build`.
3. Inside: `sudo apt update && sudo apt install -y build-essential git libsdl2-dev libgl1-mesa-dev`.
4. `git clone <this repo> && cd stompy/deck && make`.
5. The binary runs from the host too (`./build/stompy`), because the Deck's
   own SDL2 and Mesa satisfy it. Copy it anywhere on the Deck.

## Adding it to Steam

1. In Desktop mode, Steam: Games, "Add a Non-Steam Game to My Library",
   browse to `build/stompy`. Name it Stompy.
2. In the game's Properties set Launch Options to nothing (fullscreen is the
   default and saves itself in `~/.config/stompy-deck/settings.txt`).
3. Switch to Game mode and run it from the library.

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
