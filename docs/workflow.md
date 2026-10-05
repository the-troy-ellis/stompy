# Workflow

How a piece of work moves from the backlog to `main`. This applies to agents
and people alike.

## Claiming work

1. Work comes from GitHub issues on `the-troy-ellis/stompy`. Each issue has a
   milestone (`M0` to `M6`), area labels, a size label and a link to its spec.
   [issues.md](issues.md) is the seed list; once filed, GitHub is the truth.
2. Claim by assigning yourself and commenting with a one-line plan. If the
   issue is `size:L`, post the plan before coding and give it an hour for
   objections.
3. One issue per branch per PR. If you discover a second problem, file a
   second issue. Drive-by fixes under ten lines in files you already touch are
   fine; mention them in the PR.
4. Do not start a milestone-N issue while a milestone-(N-1) issue it depends
   on is open, unless the issue says it is independent. During M0 in
   particular, do not open feature PRs against `stompy.js`; they will not
   merge.

## Branches and commits

- Branch from `main`: `m0/split-sim`, `m2/weapon-ppc`, `m5a/lobby`. Prefix is
  the milestone, then a short slug. Include the issue number in the PR title,
  not the branch name.
- Commits are small and each leaves the game playable. Message in the
  imperative, under 72 characters, with a body when the why is not obvious.
- Never rewrite history on a branch someone else has pushed to. Merge `main`
  in rather than rebasing once a PR has had a review.

## Pull requests

Title: `M2: THUNDERCLAP weapon (#42)`. Body uses this template (also in
`.github/pull_request_template.md` once M0 lands):

```
## What
One paragraph. Link the spec section.

## How to try it
Steps for a reviewer, on desktop and on a phone.

## Checks
- [ ] `npm test` passes locally
- [ ] `npm run lint` clean
- [ ] `npm run build` produces a working `dist/`
- [ ] Playtest checklist run on desktop (browser, OS)
- [ ] Playtest checklist run on a phone (model, browser)
- [ ] Frame budget checked where the change touches render/update
- [ ] Spec status updated; README/docs updated if behaviour changed
- [ ] NAMING section included if this PR makes a new mech, weapon, mission or verdict visible (see Naming things)
- [ ] New text passes the tone guide (board-book descriptions, dry voice, no outside references; `test/tone.test.js`); warnings stay flat

## Screenshots / recordings
Required for anything visual or HUD.
```

Reviews: one approval merges. Reviewers check the spec's acceptance criteria,
not taste. Squash-merge; the squash message is the PR title plus body.

## Definition of done

A PR is done when all of these hold:

1. **Acceptance criteria** in the spec are met, and each is demonstrable (a
   test, a screenshot, or a reviewer step).
2. **Tests**: new sim logic has unit tests in `test/`; changed sim logic
   keeps existing tests green or updates them with a reason. Server changes
   have `unittest` coverage. The Playwright smoke test passes.
3. **Both platforms**: the playtest checklist below was run on a desktop
   browser and on a phone (real device, not an emulator; the browser's
   device mode does not reproduce touch, audio unlock or performance).
4. **Budget**: anything touching `update`, `render`, the HUD or particles
   reports before/after frame time on the reference phone, or on the slowest
   phone available with the model named.
5. **Docs**: spec status moved; architecture map updated if files moved;
   README updated if a player would notice.
6. **Tone**: new strings pass the tone guide in [vision.md](vision.md).
7. **Thunk**: anything that adds an action or an impact (a weapon, a hit, a
   landing, a UI confirm) ships with its feedback: sound, camera, body
   reaction, per [specs/13-thunk.md](specs/13-thunk.md). A silent, still
   action is not done.

## Playtest checklist

Run the whole list; it takes about eight minutes. Report deviations in the PR.

**Menu**
- [ ] Main menu renders; mech turns; drag spins it; arrows cycle chassis.
- [ ] Settings toggles persist across reload.
- [ ] Launch from each of CAMPAIGN, FREE PLAY, MULTIPLAYER (relay up or down: down must show the "not answering" status, not hang).

**Mission (Free Play, 3 hostiles, each biome once across the team's runs)**
- [ ] Walk, turn, throttle hold, full stop, jump and land; feet do not slide; no fall-through on slopes or at the map edge.
- [ ] Torso twist and centre; zoom; target cycle and target-under-crosshair.
- [ ] Each fire category fires, shows heat, and the HUD bar moves. Energy melt ring climbs on a held target.
- [ ] Missile tap fires; missile hold enters the IR nose camera; release detonates; SIGNAL LOST appears if they all hit first.
- [ ] Fusion scan locks in about 3 s on a strafing JACKAL; discharge kills it; feedback damages your torso; overload shuts you down then restarts.
- [ ] Overheat to shutdown and recover; voice lines fire once each, not every frame.
- [ ] Lose an arm (its weapon dies), lose a leg (speed halves), die (debrief shows).
- [ ] Win: debrief, NEXT MISSION / REPLAY / MAIN MENU all work.
- [ ] Pause and resume; losing focus pauses; F2 returns to menu.

**Touch (phone, landscape)**
- [ ] Full screen and landscape lock requested on launch; upright phone shows the turn-sideways prompt.
- [ ] Stick turns and sets throttle; aim drag works at the same time; two fire buttons can be held at once.
- [ ] Missile button drag steers the guided volley; fusion button drag aims.
- [ ] Audio plays after the first tap, including with the ring switch on silent (iOS).
- [ ] Backgrounding and returning resumes audio and shows the pause/menu.

**Arena (two clients, one may be a desktop)**
- [ ] Join, see each other walk, beams and shells appear on both, hits apply, death and respawn, scores update, round ends and restarts.
- [ ] Leave and rejoin; the other client sees LEFT/JOINED.

**Always**
- [ ] No errors in the console. No new warnings.
- [ ] Frame rate steady; no stutter when the first explosion plays (sample decode) or when a wreck appears.

## Testing

- `npm test` → `node --test test/`. Tests import only pure modules
  (`src/util`, `src/data`, `src/world/terrain.js`, `src/sim/*`, `src/net/protocol.js`).
  A test that needs `document`, `window` or `gl` is in the wrong place; move
  the logic.
- `npm run test:smoke` → Playwright against `npx serve`-style static server,
  using the preinstalled Chromium (`executablePath: '/opt/pw-browsers/chromium'`
  in CI containers; `channel: 'chromium'` locally). It loads the page, starts
  a Free Play mission via the menu, advances 300 frames, asserts no console
  errors and that the player mech moved under throttle, and saves a
  screenshot as a CI artifact.
- `python3 -m unittest server/test_server.py` for the relay.
- Sim tests build a game with `createGame({ seed })` and call
  `update(game, input, dt, fx)` directly with a fixed `dt` (1/60) and a
  recording `fx`. Assert on `game` and on what `fx` recorded.

Conventions: one file per sim module (`test/combat.test.js`), descriptive
names, no snapshot tests of large objects, no test longer than it needs to be
to fail for one reason.

## Performance checks

Reference devices: a Pixel 6a or Galaxy A53-class phone (2021 mid-range) for
the 60 fps budget, and a Pixel 3a-class phone for the 30 fps floor. If you have
neither, name what you used.

Procedure: Free Play, 6 hostiles, volcanic plain, with any new feature on.
Open the browser's performance panel or use the in-game frame-time readout
(M1 adds one behind a settings toggle). Record median and 95th percentile
frame time over 60 s of fighting. Report both in the PR.

## Naming things

The owner names mechs, weapons, missions and verdicts after seeing them, to
feel out the vibe. The plan therefore never commits to a display name before
the thing exists. Rules:

- **Keys are not names.** Code, data, save files and the network protocol use
  stable internal keys (`chassis.light1`, `weapon.bolt1`, mission `m07`).
  Display names live in one table, `src/data/names.js`, and nowhere else.
  Renaming is a one-line change that touches no logic and no saves.
- **Build with a placeholder.** Until named, a thing ships with a plain
  working label in the names table (`LIGHT MECH`, `BOLT GUN`, `MISSION 7`)
  and a `// unnamed` comment. Placeholders are allowed on `main`.
- **Show it, then ask.** The PR that makes a thing visible (the mesh in the
  menu turntable, the weapon firing, the mission playable) ends with a
  **NAMING** section: a short screen recording or three screenshots (menu
  turntable, in combat, destroyed or fired), one line on its personality,
  and three to five name candidates in the tone register. The owner replies
  with a name or their own; the follow-up is a one-line PR to
  `names.js`. Agents never pick the final name.
- **Proposals in specs are proposals.** PIPSQUEAK, BEANPOLE, THUNDERCLAP and
  the rest are there so the specs read well. PURPLE PUNCHER is the one name
  the owner has given. Treat every other name in `docs/` as a placeholder
  until `names.js` says otherwise.
- **Voice lines and briefs** follow the same rule: they ship as drafts and
  the mission's playable PR asks for the owner's edit.

## Working with the specs

- A spec is a contract between whoever planned and whoever builds. If the
  code shows the spec was wrong, change the spec in the same PR and say so.
- Specs name functions and files. After M0 the names are stable; before M0
  they reference `stompy.js` line landmarks.
- Each spec has `Status`, `Milestone`, `Size`, `Depends on`. Keep them true.
- New features need a spec before an issue. Use
  [specs/TEMPLATE.md](specs/TEMPLATE.md). A spec can be short; it cannot be
  missing acceptance criteria.

## Things agents get wrong here

- Adding a library. Don't. If you need a matrix function, write it in
  `src/util/math.js`.
- Adding text. Every string gets the tone test. Prefer a HUD marker or a voice
  line. Being funny in two sentences; the second one is where it dies.
- Making it solemn. If a new mech, weapon or mission name would fit in a
  military manual, try again. If it would fit in a Saturday-morning cartoon
  toy line, that is closer.
- Shipping a desktop-only control. If it needs a key, it needs a touch
  affordance, or it is a desktop *convenience* for something touch does
  another way.
- Testing in device mode. Real phones only.
- Changing balance numbers in a PR about something else. Balance changes are
  their own issues with before/after notes.
- Breaking the arena silently. Any change to the state message or `fx`
  payloads bumps the protocol version and updates `architecture.md`.
