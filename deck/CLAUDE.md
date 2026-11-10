# Stompy for the Steam Deck: notes for agents

This folder is the Rust rebuild of Stompy aimed at the Steam Deck. The
repository around it is the browser version and the **reference
implementation**: its `docs/` has the specs and its `src/data/` has every
tuned number. Port numbers, never reinvent them. **The plan of record is in
`deck/docs/`**; start with `docs/README.md`.

Rules that are easy to miss:

- Rust (a cargo workspace), SDL2 and OpenGL 3.3 core. The approved crates are
  `sdl2` and `glow`, in `crates/game` only. Any other library (or a tool the
  build depends on) needs the owner's yes first: ask, and say what it does,
  why writing it here is worse, its licence and its size. Don't add it until
  they answer. `crates/sim` has no dependencies at all: that is how the sim
  stays headless.
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
  `crates/sim/src/data/names.rs`, placeholders for anything new, a NAMING section on any
  PR that makes a new thing visible.
- Text: board-book briefs, a flat cockpit voice, jokes after the fact, no
  exclamation marks, no references outside the game. `cargo test` checks it.
- Balance numbers change only in issues about balance.
- New sim logic gets a test in `crates/sim/tests/sim.rs`. Mechs are indices,
  not references; the sim talks to the outside only through `Game::events`.

Build and check: `cargo test --workspace`, `cargo clippy --workspace
--all-targets -- -D warnings`, `cargo fmt --all --check`. Run: `cargo run
--release -- --window`. Screenshots on a headless box:
`tools/shot.sh out.png 30 --free --demo --skip 30`.
