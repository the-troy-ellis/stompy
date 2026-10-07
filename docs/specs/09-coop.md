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

### Determinism needs

Terrain: seeded already. Props (M4): seeded. Spawns: host-only, relayed, so
guests need no RNG agreement. Lightning (M4): seeded from `game.time`, which
the host sends in `es` as `gt` so guests can resync within 0.1 s.

### Scaling

Enemy count scales with pilots: +1 light mech per extra pilot in ELIMINATE
and waves; convoy and structure counts unchanged; EXTRACT requires all alive
pilots in the zone. Never HP.

### Death and respawn

A dead pilot spectates (M5a's camera) and respawns at the next objective
change or after 45 s at the start zone with full armour but no ammo refill,
whichever is first. Mission fails when all pilots are dead at once. The
single-player rule (die = fail) is kept for one-pilot rooms.

### UI

MULTIPLAYER panel gains a mode switch: ARENA / CO-OP. CO-OP shows HOST
(mission picker from the campaign strip, difficulty) and JOIN (room code
field). The lobby from M5a shows the mission name and the host marker; the
host's READY starts the mission for everyone. Debrief is shared (`over`
carries per-pilot stats) and each client saves campaign progress if it won
(`camp.mission` advances for guests too).

Text: `HOST`, `JOIN`, `ROOM CODE`, `ROOM <CODE>`, `WAITING FOR HOST`,
`<NAME> IS NOW HOST`. Voice: existing lines.

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

## Performance

Host runs the AI for up to ~10 enemies as single player already does. Guest
traffic: 10 enemies × 10 Hz × ~200 B = 20 kB/s inbound; fine on Wi-Fi and
acceptable on mobile data for M5c.

## Open questions

- Should guests be able to pick any unlocked chassis of their own, or only
  what the host has unlocked? Default: their own unlocks.
- Respawn in co-op at all, or hardcore? Default: respawn as described; the
  owner may prefer no respawns on HARD.
