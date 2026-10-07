# Internet play and hosting

| | |
|---|---|
| Status | draft (hosting choice is the owner's) |
| Milestone | M5c |
| Size | M (split: TLS + relay config; latency; abuse limits; hosting scripts) |
| Depends on | [08-lan-polish.md](08-lan-polish.md), [09-coop.md](09-coop.md) |
| Touch parity | n/a |

## Summary

Make the relay reachable from anywhere, over TLS, with room codes, and make
the client tolerate internet latency. Recommend a hosting setup and script it,
while keeping the relay URL configurable so the owner can choose differently.

## Hosting recommendation

The site is static and the relay is one Python process. The split that costs
least and keeps options open:

- **Site**: GitHub Pages from the `pages.yml` workflow (M0), at
  `https://<owner>.github.io/stompy/` or a custom domain. itch.io gets the
  same `dist/` as a zip when the owner wants it there.
- **Relay**: one small VPS (the cheapest tier anywhere; the relay needs
  almost nothing), running `server.py` under systemd behind **Caddy**, which
  gets a TLS certificate automatically and proxies `wss://relay.<domain>/ws`
  to `127.0.0.1:8096`. Caddy also serves `dist/` if the owner prefers one box
  for both; the plan supports either.

Why not a serverless WebSocket product: the relay holds state (rooms,
scores, tokens) in memory and wants one process; a VPS is simpler and free of
vendor-specific code. Why not rewrite the relay in Node: nothing in M5
requires it and the stdlib Python server is tested and small.

Alternative the owner may prefer: Fly.io or a similar container host running
the Python relay with their TLS termination. The `server/Dockerfile` in this
spec makes that a one-command deploy too.

Everything above is a recommendation; the client never hardcodes a host.
`RELAY_DEFAULT` in `src/net/client.js` is `null` and the SETTINGS field or
`?relay=` provides it; the Pages build can bake a default via a build-time
define (`--define:RELAY_DEFAULT='"wss://relay.example/ws"'`).

## Design

### TLS and origins

- Client: `wss://` whenever the page is `https://` (already the rule) or the
  relay URL says so.
- Server `origin_ok` gains an allow-list from `STOMPY_ORIGINS` (comma
  separated, exact hosts); the existing `stompy.*`/IP/localhost rule stays as
  a fallback for LAN use.
- Caddyfile, systemd unit and a `deploy.sh` (rsync `server/`, restart) in
  `server/deploy/`. A `Dockerfile` for container hosts.

### Latency

Wi-Fi is 5–20 ms; the internet is 40–150 ms with jitter. Changes:

- `netInterp` keeps a 100 ms interpolation delay buffer (two most recent
  states, interpolate between them at `now − 100 ms`), extrapolating only
  beyond that. Today it extrapolates from the latest; at 120 ms jitter that
  rubber-bands.
- State send rate stays 15 Hz; `es` 10 Hz. Consider 20 Hz for `s` when the
  measured RTT is under 60 ms (adaptive, host-side flag).
- Hit tolerance: the victim applies hits as now (shooter's view counts); no
  rewind. Document in the lobby that the shooter's view wins.
- Guided missiles and fusion scans are shooter-side already; nothing changes.
- HUD: a latency readout (`RTT 84 ms`) in the lobby and, over 200 ms, a small
  amber `LAG` tag on the HUD.

### Room codes over the internet

Co-op rooms (M5b) already have codes. Add arena rooms too: `ARENA` is the
public one; `CREATE PRIVATE` makes a coded FFA/TDM room for friends. The
lobby shows the code large so it can be read over a call. No matchmaking, no
room list; codes are the discovery mechanism, by design.

### Abuse limits

- Per-IP connections: 8 (flag). Per-IP room creation: 3 per 10 minutes.
- Message rate: 60/s per client hard cap, then disconnect.
- Names: the existing filter plus a short deny-list file the owner can edit.
- Payload caps as today (16 kB).
- A `STOMPY_ADMIN` token enabling `{ t: 'kick', id }` from a client that
  presents it in `hello`; no UI, just the hook.
- Idle rooms GC after 10 minutes with nobody; the public arena never dies.

As shipped (#215, `PROTOCOL` 18): in `server/server.py`, with the flags
and file in `server/README.md`.
- **Origins:** `STOMPY_ORIGINS` names allowed hosts beside the LAN rule.
- **Per-IP sockets:** the cap is now 8 by default.
- **Room creation:** 3 per 10 minutes per address. The next one gets `busy`,
  and the menu says TOO MANY ROOMS FROM HERE. TRY AGAIN IN A FEW MINUTES.
- **Message rate:** a bucket of 60 a second, holding 2 s of them; empty, and
  the pilot is dropped.
  - **Changed from the spec:** a co-op host gets 3×, because it sends every
    enemy's state, fire and hits as well as its own.
  - **The flood test:** the flooder is dropped while the others play on.
  - **The fuzz test:** it lifts the cap, since it tests junk, not floods.
- **Names:** `server/names_deny.txt`, one word a line, matched in letters and
  digits only. It ships empty for the owner to fill in.
- **Admin:** `STOMPY_ADMIN`. A `hello` with `admin` set to it may send
  `kick {id}` for a pilot in the same room. There's no UI.
- **Idle rooms:** an empty co-op room now waits `ROOM_IDLE` (10 minutes)
  before it is collected (it was at once before), so a pilot who drops can
  still come back to it.
- **Health:** `GET /health` answers `200 {rooms, players, uptime}`.

### Observability

A `/health` HTTP response on the same port (`GET /health` → `200 {rooms,
players, uptime}`) so an uptime monitor can watch it and Caddy can health
check. One log line per join/leave/round as today.

## Code touchpoints

- `server/server.py`: origins env, limits, `/health`, admin kick, arena rooms.
- `server/deploy/Caddyfile`, `stompy-relay.service`, `deploy.sh`,
  `Dockerfile`, `README.md` with the steps.
- `src/net/interp.js`: delay buffer; `client.js`: RTT, `RELAY_DEFAULT`
  define; `src/render/hud.js`: LAG tag; `src/ui/lobby.js`: private rooms.
- `scripts/build.mjs`: `--define` passthrough from env.

## Acceptance criteria

1. Two clients on different networks (one on mobile data) play an arena round
   and a co-op mission through the TLS relay.
2. Simulated 120 ms ± 40 ms latency (Chrome's network throttling or `tc` on
   the server): remote mechs move smoothly; no snapping at walking speed
   (visual check, and a test of `netInterp` with jittered timestamps asserting
   bounded position error).
3. `/health` answers; Caddy proxies `wss`; systemd restarts the relay after a
   kill.
4. Limits: a flood test disconnects the offender and leaves others playing.
5. Deploy from a clean VPS following `server/deploy/README.md` takes under
   15 minutes.

## Open questions

- Hosting choice (Pages + VPS recommended; one VPS; itch.io + VPS). The code
  supports all three; only the default `RELAY_DEFAULT` differs.
- Domain name. Needed for TLS on the relay; the owner provides it.
- Whether the public ARENA room should exist on the internet relay at all or
  everything should be by code. Default: public arena on, since a quiet
  public room costs nothing and is a nice "someone's here" moment.
