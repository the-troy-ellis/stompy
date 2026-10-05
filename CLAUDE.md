# Stompy — notes for agents

Stompy is a 90s-style browser mech sim: raw WebGL, flat-shaded, no libraries,
touch and desktop both first-class. **The plan of record is in `docs/`.**
Start with `docs/README.md`, then the spec your issue links to.

Rules that are easy to miss:

- No new runtime dependencies. Dev tooling is limited to what
  `docs/architecture.md` lists (esbuild, ESLint, Playwright, `node --test`).
- Every feature works on a phone held sideways with two thumbs, or it is not
  done. Test on a real phone, not device mode.
- Text is minimal but not solemn: board-book descriptions (short, plain,
  action-first sentences, like a toddler's board book but never baby talk),
  a deadpan cockpit voice, silly hardware names (PURPLE PUNCHER, BIG BONKER),
  no characters, no references to things outside the game. Warnings stay flat; jokes come
  after the fact. See the tone guide in `docs/vision.md`.
- Feel is the top pillar: thunk. Footfalls, hits, landings and punches must
  be felt (camera, body squash/wobble, sub-bass). See `docs/specs/13-thunk.md`.
- Keep the invariants in `docs/architecture.md` (feet never slide, terrain
  height matches the mesh, melt belongs to the target, heat 100/45, shooter
  scores and victim applies in the arena, audio only after a gesture).
- Names are the owner's, picked after seeing the thing. Use stable keys in
  code, put display names only in `src/data/names.js`, ship placeholders,
  and end any PR that makes a new mech, weapon or mission visible with a
  NAMING section (screenshots plus candidates). Confirmed so far: PURPLE
  PUNCHER and Act I's missions. See `docs/workflow.md`.
- Balance numbers change only in issues about balance.
- Any change to a network message bumps `PROTOCOL` and updates
  `docs/architecture.md`.
- The sim (`src/sim`, `src/data`, `src/world`) never imports the DOM, GL,
  audio, UI or input; lint enforces it. New sim logic gets a headless test.

Run it: `npm run serve` (or any static server) and open
`http://localhost:8000`. Arena: also `python3 server/server.py`. Check it:
`npm test`, `npm run test:server`, `npm run test:smoke`, `npm run lint`,
`npm run build`. See `docs/workflow.md` for the definition of done.
