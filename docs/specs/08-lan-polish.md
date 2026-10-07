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

As shipped (#184): `src/net/relay.js` (`normalRelay`, `resolveRelay`) holds
the rules.
- **Entries:** a full `ws://` or `wss://` address keeps its own port (the
  scheme's own behind TLS). A bare host or host:port gets port 8096 and
  `/ws`. Any other scheme is not a relay.
- **`?relay=`** is saved as the field, so it sticks.
- **The field lives on the MULTIPLAYER panel**, not SETTINGS. That's where a
  player joins, and SETTINGS is already taller than a phone held sideways.
- **The dim line under it** reads `CONNECTS TO <address>`, or `NOT A RELAY
  ADDRESS -- USING <address>` for an entry that isn't one.
- **On a phone held sideways** the panel's colour swatches shrink to one row,
  so JOIN ARENA stays on screen.

### Lobby

Joining no longer launches straight into the arena. `welcome` puts the client
in a LOBBY overlay: the pilot list (name, colour swatch, chassis, ping),
current mode and map, score limit, a READY button and the team picker in TDM.
The match is already running for others; READY spawns you in. The host-less
model stays: the server starts a round when the first pilot readies, and
anyone can join a round in progress as today.

Ping: the server echoes `{ t: 'ping', n }` with its time; the client shows
the round trip in the lobby and, with `?debug=1`, on the HUD.

As shipped (#185, `PROTOCOL` 9): `src/ui/lobby.js` builds the overlay.
- **Joining:** `welcome` builds the arena and opens the LOBBY over it. The
  pilot is placed but not spawned, sends no state (nobody sees a ghost),
  has no cockpit HUD, can't pause, and keeps the cursor.
- **The overlay:** each pilot's swatch, callsign, chassis (from `hello`,
  then their state messages), ping, and IN or HERE, under
  `FREE-FOR-ALL · <MAP> · FIRST TO n`, with READY and LEAVE.
- **READY** sends `ready`, spawns you and hides the lobby; the others' lists
  say IN.
- **Updates:** the lobby updates in place as pilots join, ready up and
  ping. Rebuilding it lost taps on READY on a phone.
- **Ping:** `ping {n, rtt}` every 2 s carries your last round trip. The
  echo `{n, ts, pings}` carries everyone's, and `?debug=1` shows yours.
- **A new round** keeps a pilot still in the lobby there.
- **Not here:** the server does not hold a round until someone readies; the
  round runs from the server's start, as before.

### Modes

`mode: 'ffa' | 'tdm'` on the server, in `welcome` and `newround`. TDM: two
teams, STEEL and RED palettes forced per team (colour choice becomes team
choice), team score is kills, friendly fire off (`hit` from a teammate is
dropped by the server), spawn points biased to the team's half (`spawnPoint`
takes a side). First to 20.

As shipped (#186, `PROTOCOL` 10): the relay's `--mode tdm` (or
`STOMPY_MODE=tdm`) runs it, first to `--team-limit` (20). `src/net/teams.js`
holds the sides.
- **Sides:** a pilot joins on the side with fewer pilots (STEEL on a tie).
  In the lobby, a STEEL / RED picker sits over READY. A tap sends `team`, and
  the relay moves the pilot; once in, the side is set until the next lobby.
- **Colours:** each pilot wears their side's colour, STEEL or RED. Their own
  pick comes back in a free-for-all.
- **Friendly fire is off:** a teammate is never a hostile, so it can't be
  targeted, locked or marked. Hitting one throws no sparks and sends nothing,
  and the relay drops any `hit` between teammates anyway. A teammate never
  scores a kill.
- **Score:** a side's score is its pilots' kills this round, as `teams` on
  `kill`. The HUD shows both sides in their colours, yours first, over the
  board grouped by side. A phone shows the two scores and your own
  kills/deaths. The banner says YOUR TEAM WINS THE ROUND or STEEL / RED
  WINS THE ROUND.
- **Spawns:** `spawnPoint(G, side)` keeps STEEL on the south half and RED on
  the north. A spawn stays at least 25 m off the middle line, as far as it can
  get from hostiles; teammates don't count.
- **The vote** (#187) will switch modes between rounds. `newround` already
  carries `mode` and `limit`, and the relay repaints everyone for the new
  mode.

### Vote

At `roundover`, the overlay shows the summary (kills, deaths, accuracy, best
streak per pilot) and three buttons: next map (random), SAME MAP, and the
other mode. The server tallies for `ROUND_GAP` seconds; plurality wins, ties
go to the first option. `vote { map, mode }`, result in `newround`.

As shipped (#187, `PROTOCOL` 11): `src/ui/summary.js` builds the overlay.
- **The summary:** `roundover` opens it over the arena with the round's
  headline (YOU WIN THE ROUND, YOUR TEAM WINS THE ROUND, ...). It shows each
  pilot's kills, deaths, accuracy and best streak, most kills first (by side
  in team deathmatch), and counts down to the next round.
- **Accuracy:** only each client counts its own shots, so it sends `stats
  {acc}` at `roundover`. The relay clamps it to 0-100 and passes it on, and
  the table shows -- until it arrives.
- **Best streak:** the relay counts kills between deaths.
- **The vote:** NEXT MAP, SAME MAP, and the other mode's name (TEAM
  DEATHMATCH or FREE-FOR-ALL, on a new map). A tap sends `vote {map, mode}`;
  a pilot can change it, and the last vote counts. Every vote and accuracy
  sends a `tally` with the counts, and the overlay updates in place, as the
  lobby does.
- **The result:** after `ROUND_GAP`, the most votes wins. A tie, or no votes,
  goes to NEXT MAP. Votes from pilots who left don't count. `newround`
  carries `vote`; SAME MAP keeps the seed and palette, and the other mode
  switches `mode` and `limit` and repaints the sides.
- **While it's up:** no pause menu; the cockpit's own round banner is hidden.
  A pilot still in the lobby doesn't get one.
- **The fake clock:** the relay's gap waits on `server.sleep`, which the tests
  swap for an event they release once the votes are in (acceptance 5).

### Spectate

Dead pilots see a chase camera behind the pilot who killed them, cycling with
TGT/T through alive pilots; the aim drag or mouse orbits. The HUD shows
`SPECTATING <NAME>` and the respawn countdown. The camera is a render concern;
`game.spectate = { id, yaw, pitch }`.

As shipped (#188): `src/net/spectate.js` holds `startSpectate`,
`nextSpectate`, `orbitSpectate`, `spectated` and `spectateCamera`.
- **When:** spectating starts once your own topple has played out, on your
  killer, or the lowest-numbered pilot alive if there is none. It ends at
  the respawn.
- **Who:** a watched pilot who dies hands over to the next one alive. With
  nobody left, the cockpit view stays.
- **The camera:** 24 m behind the pilot's torso, scaled by chassis, pitched
  0.28 rad above it and kept 2 m above the ground.
- **Controls:** the mouse (in pointer lock) or the aim drag orbits; T or TGT
  moves to the next pilot.
- **The HUD:** `SPECTATING <NAME>` and `RESPAWN IN n · T: NEXT PILOT`, low
  in the view and clear of the messages. The crosshair is hidden.

### Reconnect

The server keeps a departed pilot's score for 30 s keyed by a `token` it gave
in `welcome`; a `hello` with that token resumes the id and score. The client
stores the token in memory only and retries the socket three times, 2 s
apart, showing `RECONNECTING`.

### Kill feed

Top-right under the hostile count: the last four `kill` messages, fading
over 6 s, in the pilot colours. Replaces the centre `msg` for kills.

As shipped (#190): `src/net/killfeed.js` (`addKill`, `liveKills`,
`killWords`) holds the feed and the words; the HUD draws it under the
scoreboard (a phone's one-line rank).
- **The words:** KILLER DESTROYED VICTIM, PUNCHED OUT for a punch, and
  VICTIM WENT DOWN for a pilot with no killer.
- **The colours:** each name in its pilot's colour, the verb in amber when
  you are in it.
- **Legibility:** a faint dark band behind each line, so a pale name reads
  against a bright sky.
- **A new round** clears the feed.

### Server operations

- `--host`, `--port`, `--mode`, `--limit` flags in addition to the env vars.
- Logs to stdout and, with `STOMPY_LOG=path`, to a file with rotation off
  (logrotate's job).
- `server/stompy-relay.service` systemd unit example and a `README` in
  `server/`.
- Per-IP connection cap of 4 (phones and a laptop behind one NAT in M5c need
  more; make it a flag).

As shipped (#191):
- **Flags:** `--host`, `--port`, `--mode` (ffa for now), `--limit`, `--gap`,
  `--per-ip` and `--log`, each defaulting to its environment variable.
  `server.py <port>` still works.
- **Logging:** log lines go to stdout and, with `STOMPY_LOG`, are appended
  timestamped to that file.
- **The per-address cap:** a socket past the cap gets HTTP 429 before the
  WebSocket upgrade.
- **Bad messages:** a malformed message is caught and logged, and only that
  message is dropped. The fuzz tests found a crash on a chassis sent as a
  list or dict (`ch in CHASSIS` on an unhashable value); that is fixed in
  `clean_state` and in `data.py`'s loadout check.
- **Fuzz tests (acceptance 8):** 1,000 random state messages through
  `clean_state` come out finite, in range and serialisable without NaN, and a
  pilot sending 300 junk messages over a real socket stays connected and
  relayed.
- **Deployment:** `server/stompy-relay.service` (systemd, an unprivileged
  dynamic user) and `server/README.md`.

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
  Default: keep the picker in FFA (as shipped).
- Score limit for TDM: 20 (as shipped; `--team-limit` changes it).
