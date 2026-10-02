# Stompy development plan

This folder is the plan of record for Stompy. It exists so that any agent (or
person) can pick up a piece of work cold, build it the way the project wants,
and hand it off without a conversation.

Read in this order the first time:

| Doc | What it answers |
|---|---|
| [vision.md](vision.md) | What Stompy is trying to be, what it is not, and the design pillars that settle arguments. |
| [architecture.md](architecture.md) | A map of the code as it is today, the invariants you must not break, and the target structure. |
| [roadmap.md](roadmap.md) | The milestones (M0 to M6), what is in each, and what depends on what. |
| [workflow.md](workflow.md) | How work is claimed, branched, tested, playtested and merged. The definition of done. |
| [issues.md](issues.md) | The backlog, written as ready-to-file GitHub issues with labels and milestones. |
| [specs/](specs/) | One spec per feature. Each has the design, the code it touches, acceptance criteria and tests. |

If you read one spec before any other, read [specs/13-thunk.md](specs/13-thunk.md): it is what the game is supposed to feel like.

## How to use this plan

1. Pick an open issue in the current milestone (see [roadmap.md](roadmap.md)
   for which is current). Issues link to their spec.
2. Read the spec and the parts of [architecture.md](architecture.md) it points
   at. Read the actual code too: the specs name functions, and the code is the
   truth when they disagree.
3. Follow [workflow.md](workflow.md): branch, build, test, playtest on desktop
   and on a phone, open a PR against `main`.
4. When the spec turns out wrong or incomplete, fix the spec in the same PR.
   Specs carry a `Status` line; move it along (`draft` → `ready` → `in
   progress` → `shipped`).

## Decisions already made

These came from the project owner and are not up for re-litigation in a PR.
If one of them blocks you, raise it in the issue, do not route around it.

- **Scope:** a polished small game. A 12-mission campaign, six or so chassis,
  a dozen weapons, three biomes plus night and weather, LAN and co-op
  multiplayer, and eventually internet rooms. Not a MechWarrior clone with a
  200-hour mechlab.
- **Feel:** balanced, with chunk. Keep heat, per-section damage, independent
  legs and torso, slow heavies. On top of that every action gets big, tactile
  feedback: footfalls, recoil, knockback, squash, wobble, crunch. Never add a
  feature a phone player cannot use within thirty seconds of picking the game
  up.
- **Melee:** a real mechanic. A punch with a wind-up and knockback, a stomp
  when you land on someone, and PURPLE PUNCHER as the chassis built around
  it. See [specs/12-melee.md](specs/12-melee.md).
- **Platforms:** desktop and touch have equal priority. A feature is not done
  until it works with a mouse and keyboard *and* with two thumbs on a phone
  held sideways.
- **Tone:** minimal text, not solemn. Mission names, a one-line brief, HUD
  markers. No named characters, no dialogue, no lore dumps. The humour lives
  in silly hardware names (PURPLE PUNCHER, BIG BONKER), a deadpan cockpit
  voice, wry one-sentence briefs, and cartoon-weight physics. Think a 90s
  shareware demo made by people who were having fun. The tone guide in
  [vision.md](vision.md) has the rules and a starter pool of voice lines.
- **Tech:** raw WebGL, hand-built flat-shaded meshes, no engine, no
  frameworks. A light toolchain is allowed where it earns its keep: ES modules
  served as-is for development, `node --test` for tests, esbuild for a
  single-file release bundle, ESLint, GitHub Actions. No TypeScript conversion
  (JSDoc types are welcome). The relay stays stdlib Python 3.
- **Art:** stay flat-shaded. Atmosphere comes from palettes, night, weather,
  props, buildings, debris and better explosions. Not from textures, imported
  models or post-processing.
- **Customisation:** mechlab-lite. Swap weapons in fixed, category-locked
  hardpoints under a tonnage budget, plus a few system slots. Not critical
  slots, engine ratings or per-section armour allocation.
- **Multiplayer:** polish the LAN arena first, then co-op campaign, then
  internet rooms. The trust-the-client model stays; the server validates
  bounds, it does not simulate.
- **Naming:** the owner names things after seeing them. Internal keys are
  stable and display names live in one table; every PR that makes a new
  mech, weapon or mission visible ends with candidates and screenshots for
  the owner to pick from. PURPLE PUNCHER is the only confirmed name; every
  other name in these docs is a placeholder. See the naming rules in
  [workflow.md](workflow.md).
- **Hosting:** undecided. The plan recommends GitHub Pages for the static site
  and one small VPS for the relay (see
  [specs/10-internet-play.md](specs/10-internet-play.md)), and keeps the
  relay URL configurable so the decision can wait.
- **Quality bar:** headless tests for sim logic, a manual playtest checklist on
  desktop and a phone, and a frame budget on a mid-range phone. All three, per
  PR.
