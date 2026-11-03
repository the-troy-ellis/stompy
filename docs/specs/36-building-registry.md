# One registry for buildings

| | |
|---|---|
| Status | built |
| Milestone | M14 |
| Size | S |
| Depends on | [33-production.md](33-production.md) |
| Touch parity | nothing changes for the player |

## Summary

The base keeps a list per kind of building (silos, beacons, shops, lines,
plants, labs, weapon shops, bays, walls) and one factory. Until now, each place
that added a building to the base, took one away or looked over all of them
named every kind itself. So each new kind meant touching all of them, and
some got missed. One table now says, per kind, which list it lives in and
what it starts with. A new kind of building is one row.

## Player experience

None. The game plays exactly as before.

## Design

`src/sim/buildings.js`:

- `KINDS`: per kind, its `list` in `G.base` (or `one`: the factory's single
  slot), and `fresh(e, taken)`, its working state on joining the base. A shop
  starts with nothing in its press, and a line with empty bays and an empty
  queue. A line carried in from outside (`taken`) keeps the bays and queue it
  had.
- `enlist(G, kind, e, taken)`: into the base. Used by `placeSite`, for a
  building being built or a mission's own, and by stealing's `take`, for a
  building carried home. A carried-in factory fills the slot only when the
  base's own is gone, as before.
- `delist(G, e)`: out of every list. Used when thieves carry a building off.
- `buildingsOf(G, kinds)`: the base's buildings of those kinds, in that order.
  The raid's targets are `RAID_KINDS` in the order the old code listed them,
  so ties break as before.

The per-kind work (a shop pressing, a plant brewing, the map's labels) stays
where it is: those loops are about one kind each.

## Found on the way

Raids never go for **labs or weapon shops**. They weren't in the raid's
target list when those buildings were added (spec 33 part 5), while walls
are left out on purpose (spec 21: raiders go round or through). The table
keeps the behaviour as it was. Whether raiders should go for them is the
owner's call: it's one entry in `RAID_KINDS`.

## Code touchpoints

- `src/sim/buildings.js` (new): `KINDS`, `RAID_KINDS`, `enlist`, `delist`,
  `buildingsOf`.
- `src/sim/base.js` `placeSite`, `src/sim/steal.js` `take` and `lost`,
  `src/sim/raid.js` `raidTarget`: through the table instead of a chain of ifs
  each.

## Acceptance criteria

1. Every kind that can be built or placed has a row (a test).
2. Joining, leaving, a taken line and a taken factory behave as before
   (tests), and so do raid targets, in the same order (a test).
3. Every existing test passes unchanged.

## Tests

`test/buildingKinds.test.js`.

## Performance

Nothing measurable.

## Open questions

- **Should raids go for labs and weapon shops?** Default: no change (they
  don't).
