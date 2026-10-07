# LAN arena polish

| | |
|---|---|
| Status | in progress (#183 protocol v2 shipped) |
| Milestone | M5a |
| Size | M (split: protocol + relay URL; lobby + spectate; TDM + vote; server hardening) |
| Depends on | M0 stage 5 |
| Touch parity | lobby and vote are overlay taps; spectate uses the existing aim drag |

## Summary

Turn the arena from a demo into a feature: a configurable relay address, a
lobby, team deathmatch, a vote at round end, a spectator camera, and a server
that validates what the next milestones will send it.

## Design

### Protocol version and hygiene

- `hello` carries `v: PROTOCOL` (set in M0). The server answers a mismatch
  with `{ t: 'version', need }` and closes; the client shows
  `UPDATE THE GAME TO PLAY (v2)`.
- Fix the duplicate `sp` key: speed stays `sp`, scan progress becomes `sq`.
- `fx` messages are rate-limited server-side: 40 per second per client,
  excess dropped (a beam flash is per shot, guided updates are 15 Hz; this is
  generous).
- State messages validated: numbers finite, positions within `±HALF`, `hp`
  array of 5 in `[0, 200]`, `ch` in the chassis allow-list, `lo` validated
  (from [02-mechlab.md](02-mechlab.md)).

### Relay URL

Resolution order: `?relay=wss://host:port/ws` query parameter (saved), the
SETTINGS field RELAY (saved under `net.relay`), else today's rule
(`ws[s]://<page host>:8096/ws`). The MULTIPLAYER panel shows the resolved
address in the dim style so a LAN host can read it out.

### Lobby

Joining no longer launches straight into the arena. `welcome` puts the client
in a LOBBY overlay: the pilot list (name, colour swatch, chassis, ping),
current mode and map, score limit, a READY button and the team picker in TDM.
The match is already running for others; READY spawns you in. The host-less
model stays: the server starts a round when the first pilot readies, and
anyone can join a round in progress as today.

Ping: the server echoes `{ t: 'ping', n }` with its time; the client shows
the round trip in the lobby and, with `?debug=1`, on the HUD.

### Modes

`mode: 'ffa' | 'tdm'` on the server, in `welcome` and `newround`. TDM: two
teams, STEEL and RED palettes forced per team (colour choice becomes team
choice), team score is kills, friendly fire off (`hit` from a teammate is
dropped by the server), spawn points biased to the team's half (`spawnPoint`
takes a side). First to 20.

### Vote

At `roundover`, the overlay shows the summary (kills, deaths, accuracy, best
streak per pilot) and three buttons: next map (random), SAME MAP, and the
other mode. The server tallies for `ROUND_GAP` seconds; plurality wins, ties
go to the first option. `vote { map, mode }`, result in `newround`.

### Spectate

Dead pilots see a chase camera behind the pilot who killed them, cycling with
TGT/T through alive pilots; the aim drag or mouse orbits. The HUD shows
`SPECTATING <NAME>` and the respawn countdown. The camera is a render concern;
`game.spectate = { id, yaw, pitch }`.

### Reconnect

The server keeps a departed pilot's score for 30 s keyed by a `token` it gave
in `welcome`; a `hello` with that token resumes the id and score. The client
stores the token in memory only and retries the socket three times, 2 s
apart, showing `RECONNECTING`.

### Kill feed

Top-right under the hostile count: the last four `kill` messages, fading
over 6 s, in the pilot colours. Replaces the centre `msg` for kills.

### Server operations

- `--host`, `--port`, `--mode`, `--limit` flags in addition to the env vars.
- Logs to stdout and, with `STOMPY_LOG=path`, to a file with rotation off
  (logrotate's job).
- `server/stompy-relay.service` systemd unit example and a `README` in
  `server/`.
- Per-IP connection cap of 4 (phones and a laptop behind one NAT in M5c need
  more; make it a flag).

## Code touchpoints

- `src/net/protocol.js` (version, `sq`, `vote`, `ping`, `token`, `mode`),
  `client.js` (relay resolution, lobby state, reconnect, spectate state),
  `src/ui/lobby.js` (new), `src/render/scene.js` (spectator camera),
  `src/render/hud.js` (kill feed, spectating line, ping).
- `server/server.py`: validation, rate limit, modes, votes, tokens, flags;
  `server/test_server.py` additions.
- `src/ui/menu.js`: RELAY setting; the MULTIPLAYER panel text:
  `Free-for-all or team deathmatch for up to 8 pilots. First to the limit wins the round.`

## Acceptance criteria

1. Old client (v1) against new server gets the update message, not a hang.
2. `?relay=` and the setting both work; the panel shows the address.
3. Lobby shows two pilots with chassis and ping; READY spawns; a pilot can
   change team in TDM before readying.
4. TDM: friendly hits do no damage (server test), team scores shown, spawn
   sides respected (test on `spawnPoint(side)`).
5. Vote: three clients, two pick SAME MAP, the next round has the same seed
   (server test with a fake clock).
6. Spectate: after death, the camera follows the killer; TGT cycles; respawn
   returns to the cockpit.
7. Kill the socket on one client for 10 s; it reconnects with its score.
8. Fuzz test: 1000 random `s` messages with NaNs, strings and huge numbers
   never crash the server or reach other clients un-clamped.

## Tests

`protocol.test.js` (new messages round-trip, no duplicate keys), `client.test.js`
(relay resolution order with fake `location` and store), server tests for
each server bullet.

## Performance

None client-side. Server: validation is a few comparisons per message;
15 Hz × 8 clients is nothing.

## Open questions

- Should FFA also force team-free colours or keep the eight-swatch picker?
  Default: keep the picker in FFA.
- Score limit for TDM: 20 proposed.
