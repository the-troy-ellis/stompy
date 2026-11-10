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
- [docs/deck-setup.md](docs/deck-setup.md): building it, putting it on the
  Deck, the controller layout.
- [docs/controls.md](docs/controls.md): the Deck layout.

The repository around this folder is the browser version and the reference
implementation: every tuned number here is ported from its `src/data/`.
