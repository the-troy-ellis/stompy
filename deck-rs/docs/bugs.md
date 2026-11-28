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
| 3 | The feet sink too far into the ground. | The Deck | 2026-11-28, build d05813d |

## Fixed

| # | What happened | Fixed in |
|---|---|---|
| 2 | The arms in the cockpit view point oddly and don't line up with the lasers. They stood at a fixed tilt and the beams left the real muzzles, below the view. Now each barrel aims at the point under the crosshair and your beams leave the barrel tips you see (drawing only; the sim fires as before). | 2026-11-28, on `claude/adoring-babbage-2p3dxn` |
| 1 | The start menu pops up and immediately closes. (The pause menu: Start, View or Esc in play.) The press that opened it was read again the same frame as RESUME. Now the press is used up (`controls::take_pause`, test). | 2026-11-28, on `claude/adoring-babbage-2p3dxn` |
