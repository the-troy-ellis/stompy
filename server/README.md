# The arena relay

`server.py` is the multiplayer relay: the public arena for up to eight
pilots (free-for-all or team deathmatch), private arenas like it, and co-op
rooms of up to four. A private arena or co-op room is opened under a
four-letter code, which is the only way in, and is gone 10 minutes after
it empties. It
simulates nothing. Each game sends its own mech about 15
times a second and the relay passes it on, keeps the scores and runs the
rounds. Python 3.9 or later, standard library only (`data.py` reads
`loadout_tables.json`, which `npm run fixture:loadout` writes from the
game's own tables).

    python3 server/server.py                 # port 8096; the game connects to :8096/ws
    python3 server/server.py 8123            # another port, as before
    python3 server/server.py --help          # every flag

| Flag | Environment | Default | |
|---|---|---|---|
| `--host` | `STOMPY_HOST` | `0.0.0.0` | address to listen on |
| `--port` | `STOMPY_PORT` | `8096` | |
| `--mode` | `STOMPY_MODE` | `ffa` | `ffa` (free-for-all) or `tdm` (team deathmatch) |
| `--limit` | `STOMPY_SCORE_LIMIT` | `10` | a pilot's kills to win a free-for-all round |
| `--team-limit` | `STOMPY_TEAM_LIMIT` | `20` | a side's kills to win a team round |
| `--gap` | `STOMPY_ROUND_GAP` | `10` | seconds between rounds |
| `--per-ip` | `STOMPY_PER_IP` | `8` | sockets one address may hold (phones and a laptop behind one NAT) |
| `--log` | `STOMPY_LOG` | none | also append the log to this file |
| | `STOMPY_ORIGINS` | none | hosted pages allowed to connect, comma separated (`me.github.io,stompy.example.com`); the LAN rule (`stompy.*`, an IP, localhost) always holds |
| | `STOMPY_ADMIN` | none | a token a `hello` may present (`admin`) to send `{t: 'kick', id}`; no UI |

It logs joins, leaves, rounds and refusals to stdout, and to the file if one
is set; rotating that file is logrotate's job. `stompy-relay.service` is a
systemd unit for running it on a small machine.

What it checks: the `hello` version (`PROTOCOL`, kept equal to the game's
by a Node test), every state message rebuilt clean, loadouts against the
game's tables, at most 40 weapon effects a second per pilot, and at most
`--per-ip` sockets from one address. A malformed message is dropped, not
the pilot.

On the internet:
- **Floods:** a pilot sending more than 60 messages a second on average is
  dropped, and the others play on. A co-op host gets three times that,
  since it sends the world.
- **Rooms:** one address may open 3 rooms (co-op or private arenas) in 10 minutes; the next gets
  `busy`. An empty room waits 10 minutes for someone to come back, then it
  is gone. The arena never is.
- **Callsigns:** one containing a word from `names_deny.txt` (yours to fill
  in) becomes PILOT n.
- **Health:** `GET /health` on the same port answers
  `{"rooms", "players", "uptime"}` for an uptime monitor or Caddy's health
  check. The game finds the relay at its page's host on 8096, or wherever
`?relay=` or the MULTIPLAYER panel's RELAY field says.

Tests: `npm run test:server` (`test_server.py`), including a 1,000-message
fuzz of state messages and a fuzzing pilot over a real socket.
