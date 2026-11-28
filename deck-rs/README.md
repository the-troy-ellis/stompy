# Stompy for the Steam Deck

A 90s-style first-person mech sim, rebuilt in Rust for one person's Steam Deck.
Big, slow, heavy machines that stomp, punch, overheat and fall apart one limb
at a time, with a deadpan cockpit computer reading out the bad news. One of
the mechs is called PURPLE PUNCHER.

The one rule above all: **thunk**. Everything is heavy and you feel it.

```
sudo apt install libsdl2-dev libgl1-mesa-dev      # plus Rust from rustup.rs
cargo run --release               # fullscreen; add -- --window for a window
cargo test --workspace            # the headless sim tests
```

- [docs/README.md](docs/README.md): the plan of record. Start there.
- [docs/deck-setup.md](docs/deck-setup.md): putting it on the Deck (a launcher
  that updates it in Game mode), building it, the controller layout.
- [docs/controls.md](docs/controls.md): the Deck layout.

The browser version around this folder is deprecated (2026-11-28) and kept
as a reference: every tuned number here started in its `src/data/`.
`../deck/` is the browser version wrapped in Electron as a Deck app, with its
own `deck-latest` release; it is deprecated with it. This Rust rebuild uses its own
names throughout (`deck-rs/`, the `deck-rs.yml` workflow, the `deck-rs-latest`
release, `~/Games/stompy-rs`), so the two install side by side.
