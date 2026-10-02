# Stompy — notes for agents

Stompy is a 90s-style browser mech sim: raw WebGL, flat-shaded, no libraries,
touch and desktop both first-class. **The plan of record is in `docs/`.**
Start with `docs/README.md`, then the spec your issue links to.

Rules that are easy to miss:

- No new runtime dependencies. Dev tooling is limited to what
  `docs/architecture.md` lists (esbuild, ESLint, Playwright, `node --test`).
- Every feature works on a phone held sideways with two thumbs, or it is not
  done. Test on a real phone, not device mode.
- Text is minimal: one-sentence briefs, cockpit-voice register, no
  characters. See the tone guide in `docs/vision.md`.
- Keep the invariants in `docs/architecture.md` (feet never slide, terrain
  height matches the mesh, melt belongs to the target, heat 100/45, shooter
  scores and victim applies in the arena, audio only after a gesture).
- Balance numbers change only in issues about balance.
- Any change to a network message bumps `PROTOCOL` and updates
  `docs/architecture.md`.
- Before M0 (the module split) lands, do not open feature PRs against
  `stompy.js`.

Run it: `python3 -m http.server 8000` and open `http://localhost:8000`.
Arena: also `python3 server.py`. After M0: `npm run serve`, `npm test`,
`npm run build`.
