# Bugs

The owner's list. Bugs go in as they're found, in the owner's words, and
**nobody fixes one until the owner picks it** ("fix 3", "fix the walking
ones"). Then it moves to Fixed with the commit or PR that fixed it.

Each entry: what happened, where (screen, mission, place, mech), and how
often if known. An agent may add a line of what it found when it looked,
under the entry, marked as a note, but changes no code for it.

## Open

| # | What happened | Where | Found |
|---|---|---|---|
| 2 | The arms in the cockpit view point oddly and don't line up with the lasers. | The Deck, in play | 2026-11-27, build 6f75358 |

## Fixed

| # | What happened | Fixed in |
|---|---|---|
| 1 | The start menu pops up and immediately closes. (The pause menu: Start, View or Esc in play.) The press that opened it was read again the same frame as RESUME. Now the press is used up (`controls::take_pause`, test). | 2026-11-28, on `claude/adoring-babbage-2p3dxn` |
