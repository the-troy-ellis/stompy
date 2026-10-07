# The arena relay

`server.py` is the multiplayer relay: one free-for-all arena for up to
eight pilots. It simulates nothing. Each game sends its own mech about 15
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
| `--mode` | `STOMPY_MODE` | `ffa` | free-for-all (team deathmatch comes with M5a's TDM) |
| `--limit` | `STOMPY_SCORE_LIMIT` | `10` | kills to win a round |
| `--gap` | `STOMPY_ROUND_GAP` | `10` | seconds between rounds |
| `--per-ip` | `STOMPY_PER_IP` | `4` | sockets one address may hold (raise it for a LAN behind one NAT) |
| `--log` | `STOMPY_LOG` | none | also append the log to this file |

It logs joins, leaves, rounds and refusals to stdout, and to the file if one
is set; rotating that file is logrotate's job. `stompy-relay.service` is a
systemd unit for running it on a small machine.

What it checks: the `hello` version (`PROTOCOL`, kept equal to the game's
by a Node test), every state message rebuilt clean, loadouts against the
game's tables, at most 40 weapon effects a second per pilot, and at most
`--per-ip` sockets from one address. A malformed message is dropped, not
the pilot. The game finds the relay at its page's host on 8096, or wherever
`?relay=` or the MULTIPLAYER panel's RELAY field says.

Tests: `npm run test:server` (`test_server.py`), including a 1,000-message
fuzz of state messages and a fuzzing pilot over a real socket.
