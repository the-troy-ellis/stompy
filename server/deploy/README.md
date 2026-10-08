# Putting the relay on the internet

From a clean VPS to a relay at `wss://relay.<your domain>/ws`, with its own
TLS certificate, in about fifteen minutes. The game itself stays on GitHub
Pages (or anywhere static); this is only the relay. The plan behind it is
`docs/specs/10-internet-play.md` § Hosting recommendation.

In this folder:

| File | What it is |
|---|---|
| `Caddyfile` | Caddy in front: TLS, `/ws` and `/health` passed to the relay on 127.0.0.1:8096 |
| `stompy-relay.service` | the systemd unit: the relay on 127.0.0.1:8096, restarted whenever it stops |
| `deploy.sh` | copies `server/` to the VPS and restarts the relay; run it again for every update |
| `../Dockerfile` | the relay on a container host instead (the end of this page) |

## What you need

- A VPS: the cheapest tier anywhere. One small process; any Debian 12 or
  Ubuntu 24.04 box will do. You can ssh in as root (or a user with
  password-free sudo).
- A domain, and a DNS `A` record (and `AAAA` if the VPS has IPv6) for
  `relay.<your domain>` pointing at the VPS. Do this first: the certificate
  waits on it.
- On your machine: this repo, `ssh` and `rsync`.

Below, `relay.example.com` is your relay's name and `you.github.io` is where
the game is served from. Put your own in.

## 1. The VPS (2 minutes)

    ssh root@relay.example.com
    apt update && apt install -y python3 rsync caddy

Caddy starts itself and listens on 80 and 443. If the VPS runs a firewall,
open those two (`ufw allow 80,443/tcp`). Port 8096 stays closed: only Caddy
talks to the relay.

## 2. The relay (1 minute)

From the repo on your machine:

    server/deploy/deploy.sh root@relay.example.com

It copies `server/` to `/opt/stompy/server`, installs and starts the
`stompy-relay` service, and prints the relay's `/health`:
`{"rooms": 1, "players": 0, "uptime": 1}`. It also notes that the origins
aren't set yet; that's step 4.

## 3. Caddy (2 minutes)

On the VPS:

    sed 's/relay.example.com/relay.yourdomain.com/' /opt/stompy/server/deploy/Caddyfile > /etc/caddy/Caddyfile
    systemctl reload caddy

Caddy fetches a certificate in the next few seconds. Check from anywhere:

    curl https://relay.yourdomain.com/health

If that hangs or fails, the DNS record isn't there yet or 80/443 are closed:
`journalctl -u caddy -n 30` says which.

## 4. Who may connect (1 minute)

A browser page may only open a socket to the relay if the relay knows its
host. On the VPS:

    mkdir -p /etc/stompy
    echo "STOMPY_ORIGINS=you.github.io" > /etc/stompy/relay.env
    echo "STOMPY_ADMIN=$(python3 -c 'import secrets; print(secrets.token_hex(16))')" >> /etc/stompy/relay.env
    systemctl restart stompy-relay

`STOMPY_ORIGINS` takes several hosts, comma separated (a custom domain for
the game, say). `STOMPY_ADMIN` is the token for kicking a pilot (no UI yet);
keep it. Every other setting in `server/README.md` can go in this file too,
one `NAME=value` a line (`STOMPY_MODE=tdm`, for one).

## 5. The game finds it (2 minutes)

- To try it now: open the game with `?relay=wss://relay.yourdomain.com/ws`,
  or put that address in MULTIPLAYER > RELAY.
- For everyone: in the GitHub repo, Settings > Secrets and variables >
  Actions > Variables, set `STOMPY_RELAY_DEFAULT` to
  `wss://relay.yourdomain.com/ws`. The next Pages build has it baked in.

## 6. Check it (2 minutes)

- Two devices on different networks (a phone on mobile data is the honest
  one) join the arena. The relay's log shows each from its own address:

      journalctl -u stompy-relay -f

- The relay comes back by itself:

      systemctl kill -s KILL stompy-relay; sleep 3; systemctl is-active stompy-relay

  says `active`.

## Later

- **An update:** `server/deploy/deploy.sh root@relay.example.com` again. The
  relay restarts, so a round in progress ends; pilots reconnect on their own.
- **Logs:** `journalctl -u stompy-relay`, and `/var/log/stompy/relay.log`.
  Rotating that file is logrotate's job.
- **Callsigns:** words for `server/names_deny.txt` go in the repo and out
  with the next deploy.
- **An uptime monitor:** point it at `https://relay.yourdomain.com/health`.
- **The game on the same box:** the Caddyfile's commented block serves
  `dist/` from `/opt/stompy/dist`; add that host to `STOMPY_ORIGINS`.

## On a container host instead

The `Dockerfile` in `server/` runs the relay anywhere that runs containers
and terminates TLS in front of them (Fly.io, Railway, a Docker machine of
your own):

    docker build -t stompy-relay server
    docker run -p 8096:8096 -e STOMPY_ORIGINS=you.github.io stompy-relay

Point the host's HTTPS service at the container's port 8096, with
WebSockets on; the relay address is then `wss://<the app's host>/ws`. Docker
checks `/health` every 30 seconds. The image sets `STOMPY_PROXY=private`:
the host's proxy connects from a private address and names the pilot in
`X-Forwarded-For`, so the per-address limits still count each pilot, not
the proxy.
