# Co-op campaign

| | |
|---|---|
| Status | ready |
| Milestone | M5b |
| Size | L (split: rooms on the relay; host-authoritative enemies; objectives + entities sync; UI) |
| Depends on | [08-lan-polish.md](08-lan-polish.md) (protocol v2, lobby), [03-objectives.md](03-objectives.md), [05-ai.md](05-ai.md) |
| Touch parity | all overlay taps |

## Summary

Two to four pilots fly campaign or free-play missions together over the same
relay. One client (the host) runs the enemy AI and the objectives and relays
their state; everyone else runs their own mech exactly as in the arena and
sends hits on enemies to the host. The relay gains rooms so co-op and the
arena share one server.

## Design

### Rooms

The relay keeps `rooms: { code: Room }`. The arena is room `ARENA`, always
present. `hello` gains `room` (default `ARENA`) and `create: { kind: 'coop',
mission, diff, seed }` to make a new room; the server answers `welcome` with
`room`, `host` (the pilot id that is host) and the room's `def`. A room's
first pilot is host; if the host leaves, the next lowest id becomes host and
gets `{ t: 'host' }`; the game continues from the last relayed enemy state
(enemies may stutter once; acceptable). Rooms die when empty. Room codes are
four letters from a no-vowel alphabet to avoid words. Max 4 per co-op room.

The server does not understand missions; it stores `def` opaquely and relays.

As shipped (#201, `PROTOCOL` 13): `server/server.py` has `Room` and
`rooms`, and the arena's pilots are room `ARENA`'s.
- **Opening and joining:** `hello {create: {mission, diff, seed}}` opens a
  room; `hello {room: code}` joins one, in any case. An unknown code gets
  `noroom`, and a fifth pilot gets `full {max: 4}`.
- **`def`:** the host's `create`, cleaned to `{kind, mission, diff, seed}`.
- **`welcome`:** carries `room`, `kind`, `host` and `def`, plus `started` (set
  by the host's READY) for anyone joining after.
- **Routing:** as in the authority table below. Only the host's `es`, `ent`,
  `entx`, `obj` and `over` are relayed. `ehit` goes to the host only. Only
  the host's `hit` reaches a pilot, with `from: 0` and the enemy's `eid`.
- **Leaving:** when the host leaves, the lowest id left gets `host {id}`. A
  pilot who drops can come back within 30 s with their token (#189), and the
  room's last pilot leaving closes it.

### Authority split

| Thing | Owner | How it travels |
|---|---|---|
| Each pilot's mech | that pilot's client | `s` as in the arena |
| Enemy mechs | host | `es` (enemy state) at 10 Hz per enemy, same fields as `s` plus `eid`, `type`, `lo`, `ai` state name (for debug) |
| Enemy weapon effects | host | `fx` with `eid` as the source; guests draw ghosts as they do for other pilots |
| Hits on enemies | the shooter decides, sends `ehit { eid, amt, p, fu }` to the host; host applies | server routes `ehit` to the host only |
| Hits on pilots by enemies | host decides (it runs the AI's `fire`), sends `hit` to the victim as a pilot would | existing `hit` path |
| Entities (structures, convoy) | host | `ent` snapshots at 2 Hz (positions for vehicles, hp for all), events `entx` (destroyed) immediately |
| Objectives | host | `obj` on every state change: `[{ id, state, progress }]` |
| Mission over | host | `over { won, stats per pilot }`; the server also stores it so late joiners get the debrief |
| Waves | host | spawns locally, enemies appear via `es` |

Guests' `update` skips `think` and `stepMech` for enemy mechs and treats them
as `remote` (interpolated), exactly like other pilots today. Guests still run
`beamTick`/`fusionTick` against enemies for their own beams (the damage call
is what gets rerouted). The host's `damage(enemy)` from a guest's `ehit` uses
the guest's reported hit point for section routing, same as pilot hits.

Enemy awareness and targeting: the host's AI picks targets among pilots per
[05-ai.md](05-ai.md). The fusion cannon works on enemies for every pilot (the
`fu` flag on `ehit`); the host applies the outright kill.

As shipped (#202, `PROTOCOL` 14):
- **`src/net/coop.js`** has `startCoop`, `hostTick`, `applyEnemyState`,
  `flushEHits` and `applyEHit`. `G.role` gates the sim.
- **Numbering:** enemies are numbered (`eid`) in `G.mechs` order at the
  start, the same on every client, and the host numbers waves as they come.
- **A guest's enemies** are remote copies, moved by `net/remote.js`. That's
  the code that already moved other pilots, now shared.
- **`es`** carries `gt`, and a guest's clock is pulled to it when more than
  0.1 s off.
- **Hits on enemies** queue by `eid` (`sim/hitqueue.js`, which every hit site
  now uses). A guest's fusion pulse sends `ehit {fu: 1}` straight away.
- **Enemy fire** on the wire carries `eid`, and a volley or fusion shot at an
  enemy carries `te` / `e2`.
- **Guests** run no objectives, turrets or waves.
- **Targets:** as host, `preyOf` picks each enemy's pilot. It takes the
  nearest alive and keeps it unless another is 30% closer; solo play always
  fights you, as before.
- **Not yet:** the client sets `G.role` once co-op has a UI (#205); until
  then nothing outside the tests is host or guest.

As shipped (#203, `PROTOCOL` 15): the rest of the table, in `src/net/coop.js`.
- **The host** sends:
  - `ent` twice a second: `[id, hp, x, z, yaw, wp]` for mission entities with
    hp, and for vehicles;
  - `entx` at once when one falls, with the punch's direction;
  - `obj` whenever an objective changes state, and twice a second when its
    progress (left, done, alive, ...) moved, with which waves have come;
  - `over {won}` once.
- **A guest** applies these through `guestApply`.
  - **Vehicles:** they drive their own path between snapshots, and each
    snapshot corrects them.
  - **Lost messages:** an entity the host has down that is still up here
    goes down (a lost `entx`).
  - **Waiting objectives:** one the host has started is activated here too.
- **A guest's hits on entities:** a guest's damage to a mission entity
  doesn't apply locally. It goes to the host as `ehit {ent: id}`, with the
  punch direction if it was a punch. The relay checks the id and passes it
  to the host only.
- **Host migration (acceptance 2):** on `host`, the new host calls
  `becomeHost`. Its enemies become its own, picking up from the last report,
  and later enemies are numbered after the highest eid. From then it runs
  objectives, turrets and waves, and a wave the old host already sent is not
  sent again. The headless test plays it out on mission 2. The host drops
  after two relays and the wave. The guest takes over: the wave enemy keeps
  walking, the guest knocks the last relay down, and it wins and sends
  `over`.

### Determinism needs

Terrain: seeded already. Props (M4): seeded. Spawns: host-only, relayed, so
guests need no RNG agreement. Lightning (M4): seeded from `game.time`, which
the host sends in `es` as `gt` so guests can resync within 0.1 s.

### Scaling

Enemy count scales with pilots: +1 light mech per extra pilot in ELIMINATE
and waves; convoy and structure counts unchanged; EXTRACT requires all alive
pilots in the zone. Never HP.

As shipped (#204): `coopDef(def, pilots)` in `src/sim/coopRules.js`.
- **Elimination missions:** each pilot past the first adds one light mech,
  a JACKAL (`COOP_EXTRA` in `src/data/coop.js`), at the end of `foes`.
  Only the host builds the mission this way, and the extras reach the
  guests as enemies they hadn't seen.
- **Waves:** each one gets the same extras on the host (`waveExtra`).
- **Unchanged:** structures and convoys, and every mech's armour.
- **EXTRACT:** waits for every pilot still standing, and its distance is the
  furthest one's.

### Death and respawn

A dead pilot spectates (M5a's camera) and respawns at the next objective
change or after 45 s at the start zone with full armour but no ammo refill,
whichever is first. Mission fails when all pilots are dead at once. The
single-player rule (die = fail) is kept for one-pilot rooms.

As shipped (#204): `coopLives(G)` is true for a guest, and for a host with
another pilot.
- **Going down:** `destroy` sends `died`, says MECH DESTROYED and arms the
  respawn. It doesn't end the mission.
- **Coming back:** `tickCoopRespawn` brings the pilot back at the mission's
  start (`G.startAt`) after `COOP_RESPAWN` (45 s), or at once when any
  objective changes state. Armour comes back full and the guns work again;
  the ammunition is what it went down with.
- **Failing:** the host fails the mission when every pilot is down at once
  (`allDown`).
- **A host alone:** dying ends it, as in single player.
- **While down:** the host keeps running the objectives, since its teammates
  are still fighting.

### UI

MULTIPLAYER panel gains a mode switch: ARENA / CO-OP. CO-OP shows HOST
(mission picker from the campaign strip, difficulty) and JOIN (room code
field). The lobby from M5a shows the mission name and the host marker; the
host's READY starts the mission for everyone. Debrief is shared (`over`
carries per-pilot stats) and each client saves campaign progress if it won
(`camp.mission` advances for guests too).

Text: `HOST`, `JOIN`, `ROOM CODE`, `ROOM <CODE>`, `WAITING FOR HOST`,
`<NAME> IS NOW HOST`. Voice: existing lines.

As shipped (#205):
- **The MULTIPLAYER panel:** one row reads ARENA / CO-OP, and in co-op also
  HOST / JOIN.
  - **HOST:** picks a mission from the campaign strip (any you can play)
    and a difficulty, and opens a room.
  - **JOIN:** takes the four-letter ROOM CODE, in any case.
  - **On a phone held sideways:** the blurb goes and the pickers sit one to a
    line, so the launch button (JOIN ARENA, HOST, JOIN) stays on screen.
- **The lobby:** `ROOM <CODE> · MISSION n: NAME · DIFFICULTY` over the
  pilots, with HOST marked and READY for those who have pressed it.
  - **A guest's READY** says WAITING FOR HOST.
  - **The host's READY** starts the mission on every screen at once.
  - **The room's mission:** everyone builds the same mission and seed, and
    the host builds it for the pilots in the room (more enemies,
    `coopDef`).
  - **Joining late:** a guest who joins a mission under way goes straight
    in. Enemies already down are reported as gone every 2 s, and the
    entities and objectives catch up from the host's snapshots.
- **In the mission:**
  - `G.mode` is `coop`, and the other pilots are teammates: team 0, never a
    target, with friendly fire off.
  - Punches and guided volleys show on the others' screens, as in the arena.
  - Down, you watch a teammate with M5a's spectator camera, and the HUD says
    `BACK IN n`.
  - `<NAME> IS NOW HOST` when the host leaves.
- **The debrief:** each screen shows its own debrief, plus a table of every
  pilot's kills (the host counts them and sends them with `over`) and deaths
  (the relay's). A win is saved to every pilot's campaign, and a loss to
  none. LEAVE goes back to the menu.
- **Dropping:** a pilot who drops comes back to the room (#207's token, kept
  per room). If the tries run out, JOIN from the menu goes back to the same
  room.
- **Acceptance 1:** the smoke run plays it on mission 2 with two browsers
  against the real relay:
  - ONE hosts, and TWO joins by the code.
  - Both see the same enemies, and each other as teammates.
  - TWO's hit on a relay lands on the host's.
  - The relays down, both get the debrief with the crew table, and both
    saves move to mission 3.

## Code touchpoints

- `server/server.py`: rooms, routing table (`ehit` → host, `es`/`ent`/`obj`
  → everyone but host), host succession, room GC; tests.
- `src/net/protocol.js` (v3 messages), `src/net/coop.js` (new: host
  send cadence, guest apply), `client.js` (room join/create).
- `src/sim/update.js`: `game.net.role` (`'solo' | 'host' | 'guest'`) gates
  `think`, enemy `stepMech`, objective ticks and wave spawns.
- `src/sim/combat.js`: `damage` on an enemy when `role === 'guest'` queues
  `ehit`.
- `src/sim/objectives.js`, `entities.js`: `serialize()`/`apply()` for the
  host/guest split.
- `src/ui/menu.js`, `lobby.js`, `screens.js` (shared debrief).

## Acceptance criteria

1. Two clients complete mission 2 (DESTROY) together on a LAN: both see the
   same enemies and structures, both get the debrief, both advance.
2. Host leaves mid-mission; the guest becomes host within 2 s and the mission
   continues (enemies keep moving; objectives keep ticking).
3. A guest's fusion cannon kills an enemy; the host applies and relays it.
4. Four clients, mission 5 (SURVIVE), on the reference phone as a guest:
   frame budget held; relay traffic under 20 kB/s per client (measured).
5. Server tests: room creation, code uniqueness, routing table, host
   succession, GC, max 4.
6. Headless test: a `host` game and a `guest` game connected through an
   in-memory fake relay reach the same objective states and enemy hp after a
   scripted fight.

As shipped (#206): `test/fakeRelay.js` is an in-memory co-op room with
`server.py`'s routing. Pilot 1 is host and builds the mission for the room,
every pilot's `s` goes to the others at 15 Hz, and it counts the bytes each
pilot receives. `test/convergence.test.js` uses it twice:
- **Acceptance 6:** on mission 2, the guest fells a relay and hurts every
  enemy, and the host hits one too. Afterwards, host and guest agree on every
  enemy's life and armour, every entity standing, and every objective's state
  and count.
- **Acceptance 4:** four pilots play all 150 s of mission 5 (three waves,
  each with the three extra JACKALs for the extra pilots). Every 10 s window
  stays under 20 kB/s per pilot.
  - **Before the fix:** one `es` per enemy per tick ran to 38.6 kB/s per
    guest at 15 enemies.
  - **After:** the batched, changes-only `es` (`PROTOCOL` 16; see
    `docs/architecture.md`) peaks at about 17.9 kB/s per guest and 8.0 kB/s
    for the host. About 7.6 kB/s of a guest's share is the other three
    pilots' own state.

## Performance

Host runs the AI for up to ~10 enemies as single player already does. Guest
traffic: 10 enemies × 10 Hz × ~200 B = 20 kB/s inbound; fine on Wi-Fi and
acceptable on mobile data for M5c.

## Open questions

- Should guests be able to pick any unlocked chassis of their own, or only
  what the host has unlocked? Default: their own unlocks.
- Respawn in co-op at all, or hardcore? Default: respawn as described; the
  owner may prefer no respawns on HARD.
