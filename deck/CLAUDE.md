# Stompy for the Steam Deck: notes for agents

This folder is the C11 rebuild of Stompy aimed at the Steam Deck. The
repository around it is the browser version and the **reference
implementation**: its `docs/` has the specs and its `src/data/` has every
tuned number. Port numbers, never reinvent them. **The plan of record is in
`deck/docs/`**; start with `docs/README.md`.

Rules that are easy to miss:

- C11, SDL2 and OpenGL 3.3 core. No other library, no build system but the
  Makefile. `make lint` fails if `src/sim`, `src/data` or `src/util` include
  SDL or GL.
- Thunk is the top pillar. Anything that adds an action or an impact ships
  with its feel row, sound, rumble and body reaction (`docs/specs/01-thunk.md`).
- Steam Deck first: the pad, 1280 by 800, a locked 60. Mouse and keyboard
  second. No touch. A feature is not done until it was played on a real Deck
  in Game mode. No new system ships before the owner has played the last one.
- Keep the invariants in `docs/architecture.md`: feet never slide, ground
  queries match the mesh, melt belongs to the target, heat 100/45, the sim
  never includes the platform, `dt` is a fixed 1/60, everything visible is a
  polygon (no textures, no blending; the dither is the one see-through).
- Names are the owner's: stable enum keys in code, display names only in
  `src/data/names.c`, placeholders for anything new, a NAMING section on any
  PR that makes a new thing visible.
- Text: board-book briefs, a flat cockpit voice, jokes after the fact, no
  exclamation marks, no references outside the game. `make test` checks it.
- Balance numbers change only in issues about balance.
- New sim logic gets a check in `test/sim_test.c`.

Build and check: `make`, `make test`, `make lint`. Run: `./build/stompy`
(`--window` for a window). Screenshots on a headless box:
`tools/shot.sh out.png 30 --free --demo --skip 30`.
