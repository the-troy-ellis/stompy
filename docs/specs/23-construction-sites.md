# Construction sites: command places, construction builds

| | |
|---|---|
| Status | built: parts 1 (#353) and 2 (the owner, 2026-10-26: "have the command section decide where structures are placed and a construction site pops up but the construction mechs portion is what actually builds the structure"; picked ore carried to the site, parked diggers building on their own, and the cockpit's BUILD placing a site too) |
| Milestone | M10 (proposed, with spec 22) |
| Size | L, split in two: sites and building; placing from the map |
| Depends on | [21-mining.md](21-mining.md) (buildings, diggers and haulers on their own); [22-command-view.md](22-command-view.md) (the map, orders) |
| Touch parity | Full: placing is a button and a tap on the map; building is the digger's punch, as digging is |

## Summary

Today a building pops up on its own a few seconds after BUILD, paid for out
of the silo. Instead, placing a building puts down a **construction site**:
an outline on the ground in hazard tape. It rises only as **ore is carried
to it** and **diggers work it** with their buckets. Command decides where,
construction does the work, and haulers have a second job: feeding sites.

## Player experience

### A site

- A site is the building's footprint in hazard stripes with a low scaffold.
  As it's built, the building rises out of it as now, a bit per bucket
  swing, not on a timer.
- It needs two things:
  - **Ore**, carried in. A site shows how much it holds against its price:
    `ORE 20/60`.
  - **Work**: bucket swings, from you in a digger or from a parked digger.
    The building can't rise past what the ore delivered pays for. With half
    the ore in, it stops at half and waits.
- When it's done: the thunk, and the voice: `Factory up.` (as now).
- A site can be shot. Raiders hunt sites like buildings.

### Placing one

- **From the cockpit (a digger):** BUILD (the missile button) works as now:
  hold for the footprint, let go to place. What goes down is a site, and no
  ore leaves the silo. NEXT (the ballistic button) picks the kind as now.
- **From the map (spec 22):** a `BUILD` button on the order bar, shown with
  nothing picked, cycles FACTORY, BAY, WALL. The footprint follows your
  finger, green where it fits and red where not. A tap puts the site down;
  `BACK` (or `BUILD` again) puts the button away.
- There can be one factory, counting a factory site. Footprints still want
  flat ground and no mechs or buildings in them. Ore isn't needed to place.

### Who builds, and who carries

- **A parked digger with no order** leaves its dig for the nearest site that
  has work it can do (ore delivered beyond what's built). It walks up,
  swings at it until the work catches up with the ore, then goes back to
  its dig. The crew strip and map read `BUILDING`.
- **Ore reaches a site** in any of these ways:
  - A crew mech with ore within 16 m of a site that needs ore tips its ore
    in (as into a hauler). So a digger that comes to build brings its
    hopper.
  - **A parked hauler with no order** fetches ore when a site needs it and
    the silo has some. It loads at the silo's pad, carries the ore to the
    site and tips it in (`FETCHING`, then `DELIVERING`).
  - **You**, driving a digger or a hauler with ore up to a site.
- **Orders (spec 22):** `BUILD` with a digger picked, then a tap on a site,
  sends that digger to build it. A plain tap on a site with diggers picked
  does the same. A hauler told `GO` to a site with ore tips in when it
  arrives.

### Desktop and touch

Nothing new to hold: building is the punch you already dig with, aimed at
the site. On the map, `BUILD` is a button like the others (key 7).

New text, in full: `BUILD` (on the map) · `ORE 20/60` · `BUILDING` ·
`FETCHING` · `DELIVERING` · `SITE` (on the map, before a site's name) ·
voice `Building.` (the order).

## Design

### Data

A site is the building entity itself, placed at prog 0 as now, with
`e.site = { ore, need, work, swings }`:

| | factory | bay | wall (each slab) |
|---|---|---|---|
| need (ore) | 60 | 30 | 10 / 3 slabs |
| swings | 12 | 8 | 2 |

`PLACE[kind].ore` stays the price; `PLACE[kind].swings` is new (the bucket's
cooldown is 1.2 s, so a factory is about 15 s of one digger's work).
`prog = min(work / swings, ore / need)`; the height follows `prog` as now.
When `prog` reaches 1, `e.site` is cleared and it's a building. `G.base.rising` goes
away: nothing rises on a timer.

### A swing on a site

`melee.js`: a bucket with a site of its own team in reach (`meleeTarget`
already finds structures; the bucket skips its own team today) builds instead
of digging: `work += 1` if `work < swings * ore / need`. It's the punch's
thunk with a puff of dust, a `BUILDING` message, and no damage. With the
work caught up to the ore, the swing does nothing and says `NEEDS ORE`.

### Tipping ore in

`base.js` `stepBase`, beside `handover`: each crew mech with ore within
`CONSTRUCT.handover` of a site with `ore < need` tips in
`min(m.ore, need - ore)`. You see `ORE ACROSS` if you're in it, as now.

### The parked jobs

`miner.js`:

- **`mine`:** before its own site, a digger looks for the nearest site with
  work it can do now (`work < swings * ore / need`) or ore it can bring (it
  has ore, the site needs it). If there is one, it walks to it and swings
  (`BUILDING`). Otherwise it goes on with its dig.
- **`haul`:** first, with no digger to follow, if a site needs ore no other
  hauler is bringing and the silo has some: to the silo's pad
  (`FETCHING`), take `min(tub, need left, silo ore)` from the silo, then to
  the site (`DELIVERING`), where the tip-in empties it.

A FOLLOW order keeps a hauler on its digger. A DIG or GO order keeps a
digger off sites; WORK lets it build again.

### Placing from the map

`ui/command.js`:

- `BUILD` with nothing picked: `C.place = kind`.
- The footprint (`base.js` `footprint`, given a point and a facing instead
  of a mech) drawn at the pointer, facing away from the silo.
- A tap calls `placeSite(G, x, z, yaw, kind)`; a tap where it doesn't fit
  says `NO ROOM`.

`placeBuilding(G, m)` (the cockpit) becomes a wrapper on `placeSite`.

### Edge cases

- **The one factory:** a factory site counts. A destroyed factory site
  frees the slot, and its ore is lost.
- **No silo:** haulers can't fetch, but diggers still bring their hoppers.
- **Online:** the base is single player (spec 20), so sites are too.
- **FIRST FACTORY:** its brief says to build a factory. That now means:
  place the site, dig, bring ore or let a hauler fetch it, and build. The
  silo's starting 20 ore is a third of a factory. Its objectives (keep the
  silo, beat the raids) don't need the factory; building one is how you get
  a second fighter in time, so its pace will want a look in play.

## As built

### Part 1: sites and building (#353)

- **`base.js`:**
  - `placeSite`, `footprintAt`, `siteProg`, `siteWork`, `buildSwing`,
    `tipIn`; `G.base.sites`.
  - A site holds `{ kind, ore, need, work, swings, parts }`. A wall's three
    slabs share one, `need` 10 and `swings` 6 in all, so there are no
    fractions of ore.
  - The silo doesn't take back what a fetching hauler just loaded
    (`m.fetch`).
- **`melee.js`:** the bucket targets its own team's sites and builds them.
  The swing thunks with dust when it builds, and whiffs with `NEEDS ORE` when
  it can't.
- **`miner.js`:**
  - `mine` goes to `siteFor` first: a site with work, or one that needs ore
    when the hopper is full.
  - `build` walks to the site, faces it and swings. A trip that gets stuck
    skips that site for 20 s.
  - `haul` → `fetch` feeds one site per hauler.
- **The look:**
  - Hazard tape and four corner posts round the footprint, drawn after the
    prop batch (`scene.js` `drawSite`).
  - `… SITE n% · ORE n/m` on the base panel, under the crosshair in a digger
    or hauler near one, and on the map.
- **Smoke:**
  - The base run checks a free site goes down.
  - FIRST FACTORY fills its factory site and builds it with `e`.

### Part 2: from the map

- **`BUILD` on the order bar (key 7):**
  - With nothing picked it places sites: each press cycles `BUILD FACTORY`,
    `BUILD BAY`, `BUILD WALL`, then off.
  - With diggers picked it's the order.
- **The ghost:**
  - The footprint follows the mouse, facing away from the silo. It's green
    with `FACTORY · 60 ORE`, or red with `NO ROOM` or `BUILT`.
  - On touch there's no hover: a tap puts the ghost there, and a second tap
    on it puts the site down.
- **The BUILD order** (`orders.js`): `{ kind: 'build', target }` on a site's
  part. Diggers walk to it and swing (`miner.js` `build`), and the order ends
  when it's up. A plain tap on a site with diggers picked gives it. The voice
  says `Building.`
- **Not done:** a smoke step for placing from the map. The browser was
  checked by hand on desktop and touch: a factory site went down beside the
  silo.

## Code touchpoints

- `src/data/construct.js`: `PLACE[kind].swings`.
- `src/sim/base.js`: `placeSite`, `footprint` for a point, the tip-in,
  `rising` gone; `stepBase` raises sites by `prog`.
- `src/sim/melee.js`: the bucket builds a site of its own team.
- `src/sim/miner.js`: `mine` builds first when there's work; `haul` fetches.
- `src/sim/orders.js`: `build`, an order for diggers (spec 22's `give` and
  `obey`).
- `src/sim/raid.js`: raiders count sites as buildings.
- `src/mesh/props.js`: the site's tape and scaffold, drawn under the
  rising building.
- `src/ui/command.js`: the BUILD button, the footprint at the pointer, site
  markers with `ORE n/m`.
- `src/render/hud.js`: in a digger, the site in front shows `ORE n/m` and
  how far built.

## Acceptance criteria

1. BUILD in a digger puts down a site, and no ore leaves the silo.
2. A site rises only by bucket swings, and never past the ore delivered.
3. A digger or hauler with ore beside a site tips it in.
4. A parked digger with no order builds a site with work to do, then goes
   back to its dig.
5. A parked hauler fetches silo ore for a site that needs it.
6. From the map: BUILD, a tap, and a site is down; a digger told BUILD on
   it builds it.
7. FIRST FACTORY can still be won.
8. All of it on a phone.

## Tests

- `test/sites.test.js` (headless):
  - Placing a site costs nothing.
  - Swings build only up to the ore delivered.
  - Ore tips in from a digger and from a hauler.
  - A parked digger leaves its dig to build and comes back after.
  - A parked hauler fetches from the silo and delivers.
  - A destroyed site frees the factory slot.
  - Raiders hunt sites.
- Update `test/base.test.js` and `test/buildings.test.js`: instant rising
  is gone.
- Smoke: FIRST FACTORY places a factory site and builds it with the bucket.

## Performance

Nothing measurable: a few more checks per parked crew mech a frame, over a
handful of sites.

## Build order

1. **Sites and building:**
   - The site data, the swing, the tip-in.
   - Parked diggers that build and haulers that fetch.
   - The cockpit's BUILD placing a site.
   - The site's look and its HUD line.
2. **From the map:** the BUILD button, the footprint at the pointer, the
   BUILD order, and site markers.

## Open questions

- **Cancelling a site.** Default: not in this spec. Later, a `CANCEL` on a
  picked site that refunds the ore it holds.
- **Repairing with the bucket.** Swinging at a damaged building of your own
  could mend it the same way. Default: not yet; the bay mends mechs.
- **Haulers' priority.** Default: a hauler follows its digger (FOLLOW)
  over fetching, and fetching over its own loading. Revisit after play.
