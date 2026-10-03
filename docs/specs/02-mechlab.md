# Mechlab-lite

| | |
|---|---|
| Status | in progress (#62 data model shipped; #63 FIT screen, #64 arena, #76 KNUCKLES open) |
| Milestone | M2 |
| Size | L (split: data model + validation; UI; arena transport) |
| Depends on | M0; [06-chassis-and-weapons.md](06-chassis-and-weapons.md) for the weapon list (can ship with today's five) |
| Touch parity | the whole screen is tap and swipe; no drag-and-drop |

## Summary

A FIT screen reached from the main menu's mech panel. Each chassis has fixed
hardpoints, each locked to a fire category. You choose which weapon of that
category sits in each, within a tonnage budget, and fill three system slots.
That is the whole mechlab. It keeps the fire-by-category controls intact and
gives the player a reason to look at the weapon table.

## Player experience

Main menu, mech panel: under the chassis name a new button, FIT. It opens a
full-screen overlay in the menu's style with the mech still turning on the
right.

Left column: the hardpoints, one row each: `LEFT ARM · ENERGY · [LG LASER ▸]`.
Tapping the row (or the ▸) cycles to the next weapon of that category,
including EMPTY. Below them, three SYSTEM rows: `HEAT SINKS +2`, `ARMOUR +10%`,
`JUMP JETS` with the same cycling (each has three or four levels including
NONE). At the bottom, a tonnage bar `38 / 45 t` that turns amber at 100% and
red (and disables LAUNCH) when over. Alongside, the derived numbers in the
menu's small stat bars: FIREPOWER, HEAT (sustained heat vs sink), SPEED,
ARMOUR, so the trade-offs show as you tap.

A RESET row restores the stock loadout. The screen has no OK button: changes
are live and saved as they happen. BACK (or Esc/F2) returns to the menu.

Voice: nothing. Text: the labels above and `OVERWEIGHT` on the bar. That is
all the text.

## Design

### Data

In `src/data/chassis.js`, each chassis gains:

```js
tons: 45,                                   // budget
hardpoints: [                               // order is HUD order
  { id: 'la', loc: 'LA', cat: 'energy',  stock: 'laser' },
  { id: 'ra', loc: 'RA', cat: 'energy',  stock: 'laser' },
  { id: 't1', loc: 'T',  cat: 'ballistic', stock: 'ac' },
  { id: 't2', loc: 'T',  cat: 'missile', stock: 'lrm' },
],
systems: { sinks: 0, armour: 0, jets: 1 },  // stock levels
```

The fusion cannon is not a hardpoint; every chassis has it (today's rule). In
`src/data/weapons.js` each weapon gains `tons` and, for display, `fp`
(firepower score). Systems live in `src/data/systems.js`:

| System | Levels | Effect per level | Tons per level |
|---|---|---|---|
| Heat sinks | 0–3 | `sink +2` | 1 |
| Armour | 0–2 | every section `hp × (1 + 0.1·L)`, `speed × (1 − 0.04·L)` | 2 |
| Jump jets | 0–2 | 0 = none (no jets at all), 1 = stock, 2 = fuel 1.5× and climb 1.2× | 1.5 |
| Knuckles | 0–1 | melee `dmg` and `knock` × 1.5; PURPLE PUNCHER only (others do not have the slot) | 3 |

Tonnage budget per chassis is set so that the stock loadout uses about 85%
of it. Draft numbers (`06-chassis-and-weapons.md` finalises):

| Chassis | Tons | Stock use |
|---|---|---|
| JACKAL | 25 | 21 |
| KESTREL | 45 | 38 |
| WARDEN | 60 | 51 |
| PURPLE PUNCHER | 80 | 62 |

A **loadout** is `{ hp: { la: 'laser', ra: 'mlaser', t1: null, t2: 'lrm' },
sys: { sinks: 1, armour: 0, jets: 1 } }`. `src/sim/loadout.js` exports:

- `stockLoadout(chassis)`.
- `validate(chassis, loadout)` → a normalised loadout: unknown hardpoints
  dropped, category mismatches reset to stock, levels clamped; returns
  `{ loadout, tons, ok }` where `ok` is `tons <= chassis.tons`.
- `applyLoadout(mech, loadout)` → sets `mech.weapons` (same shape as today,
  `mount` from the hardpoint's `loc`), `mech.ch` derived stats (`sink`,
  `speed`, per-section `hp`/`max`). Derived stats live on `mech`, never
  mutate `CHASSIS`.
- `stats(chassis, loadout)` → `{ firepower, heatBalance, speed, armour, tons }`
  for the bars.

`newMech(game, type, team, x, z, yaw, { loadout })` calls `applyLoadout`.
Enemies use stock unless a mission says otherwise (M3 may give variants).

### Storage

`store.set('fit.' + chassis, loadout)`. Validated on load (a stale loadout
after a weapon rename falls back cleanly).

### Arena

The state message gains `lo: loadout` (sent only in the first state message
after spawn and when it changes; receivers apply on first sight and on
change). The server runs the same validation in Python (`validate_loadout`,
with the tables duplicated in `server/data.py` and a test that checks they
match the JS tables via a generated JSON fixture). An invalid loadout is
replaced with stock before relaying; the sender is told with a `note`
message so its HUD can say `LOADOUT REJECTED`.

### Rules that keep this "lite"

- No ammo count choices; ammo comes with the weapon.
- No per-section armour; one slider.
- No engine or speed tuning beyond the armour penalty.
- No hardpoint changes; chassis identity is the hardpoint map. PURPLE
  PUNCHER's fists are not hardpoints and cannot be removed.

## Code touchpoints

- `src/data/chassis.js`, `weapons.js`, new `systems.js`.
- `src/sim/loadout.js` (new), `src/sim/state.js` (`newMech`), `src/sim/mech.js`
  reads `mech.sink`, `mech.maxSpeed` instead of `mech.ch.sink/speed`.
- `src/ui/mechlab.js` (new) and `menu.js` (the FIT button, chassis cycling
  resets the preview loadout).
- `src/render/hud.js`: the weapon list already reads `mech.weapons`; the
  jets button/key must hide when `jets === 0`.
- `src/net/protocol.js`, `client.js` (`lo` field), `server/server.py`.
- `style.css`: `.lab` rows, reuse `.mm-pick`.

## Acceptance criteria

1. FIT opens from the menu on desktop and phone; every row cycles by tap and
   by left/right keys; the mech on the right updates its weapon meshes
   (arm pods appear/disappear) as you cycle.
2. Overweight disables LAUNCH with the bar red and `OVERWEIGHT`; RESET fixes it.
3. A loadout persists across reload per chassis.
4. A JACKAL with two pulse lasers and +3 sinks sustains fire longer than stock
   (headless test over 20 s of held energy fire: heat stays under 100).
5. Armour +2 raises every section by 20% and lowers speed by 8% (test).
6. In the arena, a custom loadout is seen by the other client (weapons drawn,
   damage from its weapons matches), and a hand-crafted invalid `lo`
   (category mismatch, over tonnage) is replaced with stock by the server
   (Python test).
7. Jets level 0 hides JUMP on touch and ignores J on desktop.

## Tests

`loadout.test.js`: validation cases (unknown hardpoint, wrong category, over
budget, stale weapon name), `applyLoadout` derived stats, stats monotonicity
(adding a weapon never lowers firepower). `server/test_server.py`: the
validation parity fixture.

## Performance

None at runtime. Applying a loadout rebuilds nothing on the GPU: weapon pods
are separate parts toggled per draw.

## Open questions

- Should enemies in contracts after mission 12 carry random valid loadouts?
  Default: yes, from a small curated list per chassis, not fully random.
- Does the fusion cannon stay universal? Default: yes (it is the game's
  signature), but a system slot could later let you drop it for 3 tons.
