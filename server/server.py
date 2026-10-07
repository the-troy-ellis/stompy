#!/usr/bin/env python3
"""Stompy multiplayer relay: one arena for up to eight phones, free-for-all or team deathmatch.

The server does not simulate anything. Each client runs its own mech and
sends its state ~15 times a second; the server stamps it with the sender's id
and relays it to everyone else. Hits are decided by the shooter's client (what
you see is what counts, which feels fair on Wi-Fi) and forwarded to the
victim, whose client applies the damage and reports its own death. The server
keeps the only shared state: who is connected, the scores, and the round.

Fine among friends on a LAN; trivially cheatable by anyone who edits the JS.

WebSockets are implemented here directly (RFC 6455: handshake, masked client
frames, ping/pong, close) so this stays stdlib-only.

    python3 server.py [port]        # default 8096; the game connects to :8096/ws
"""
import argparse
import asyncio
import base64
import hashlib
import ipaddress
import json
import os
import random
import secrets
import struct
import time
from urllib.parse import urlsplit

from data import CHASSIS, check_loadout

GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_PLAYERS = 8
SCORE_LIMIT = int(os.environ.get("STOMPY_SCORE_LIMIT", 10))   # kills to win a round
ROUND_GAP = int(os.environ.get("STOMPY_ROUND_GAP", 10))       # seconds between rounds
MAX_MESSAGE = 16 * 1024   # bytes; a state update is ~200
HELLO_TIMEOUT = 10
PING_EVERY = 10
DROP_AFTER = 25           # seconds of silence (a phone that went to sleep)
MAX_BUFFERED = 256 * 1024 # a client this far behind is dropped, not waited for
PALETTES = ("dusk", "ice", "volcanic")
PROTOCOL = 12             # src/net/protocol.js PROTOCOL; a hello with another is told to update (a Node test keeps them equal)
HALF = 96 * 24 / 2        # the map's half width (src/world/terrain.js): positions are clamped to it
FX_RATE = 40              # weapon effects per second per pilot; more are dropped (a beam flash is per shot, guided updates 15 Hz)
PER_IP = int(os.environ.get("STOMPY_PER_IP", 4))   # sockets from one address at once (phones and a laptop behind one NAT)
MODE = os.environ.get("STOMPY_MODE", "ffa")         # the arena's mode: ffa (free-for-all) or tdm (team deathmatch)
MODES = ("ffa", "tdm")
TEAM_LIMIT = int(os.environ.get("STOMPY_TEAM_LIMIT", 20))   # a team's kills to win a round in tdm
TEAM_COLORS = (0, 1)      # STEEL and RED (src/data/colors.js MP_COLORS): in tdm a team's colour is forced
KEEP = 30                 # seconds a departed pilot's id and score wait for a hello with their token (a dropped phone)
VOTES = ("next", "same", "mode")   # the round-end vote, in order (a tie goes to the first): next map, same map, the other mode
LOG_FILE = os.environ.get("STOMPY_LOG")             # also log to this file (appended; rotation is logrotate's job)
_log_out = None

OP_CONT, OP_TEXT, OP_BIN, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


def log(*a):
    """A line to stdout (systemd's journal) and, with STOMPY_LOG, to that file, timestamped."""
    global _log_out
    print(*a, flush=True)
    if LOG_FILE:
        try:
            if _log_out is None:
                _log_out = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
            _log_out.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")
        except OSError as e:
            print(f"log file {LOG_FILE}: {e}", flush=True)


class Client:
    def __init__(self, writer):
        self.writer = writer
        self.id = 0
        self.name = ""
        self.color = 0        # as shown: the pick from hello, or the team's colour in tdm
        self.pick = 0         # the colour the pilot chose (hello)
        self.team = 0         # tdm: 0 STEEL, 1 RED; picked in the lobby before READY
        self.ch = "kestrel"   # the chassis, for the lobby's pilot list (hello, then each state message)
        self.ready = False    # in the lobby until READY
        self.ping = 0         # ms, as the client last measured its round trip
        self.kills = 0
        self.deaths = 0
        self.streak = 0       # kills since the last death
        self.best = 0         # the round's best streak
        self.acc = -1         # the round's accuracy in %, as the client reports it at round end (-1: not yet)
        self.token = ""       # from welcome: a hello carrying it within KEEP seconds of a drop resumes this pilot
        self.last = time.monotonic()
        self.fx_tokens, self.fx_at = float(FX_RATE), time.monotonic()   # the fx rate limit: a bucket that refills at FX_RATE a second


players: dict[int, Client] = {}
conns: dict[str, int] = {}   # open sockets per address, for the PER_IP cap
departed: dict[str, dict] = {}   # token -> a dropped pilot's id and score, until KEEP runs out
arena = {"seed": random.randrange(1, 10**6), "pal": random.choice(PALETTES), "over": False,
         "mode": MODE if MODE in MODES else "ffa", "teams": [0, 0],   # teams: each team's kills this round (tdm)
         "votes": {}, "round": 0}   # votes: pilot id -> VOTES index, between rounds; round: counts rounds (a score kept from an old one is void)
sleep = asyncio.sleep     # the gap between rounds waits on this (the tests swap in a fake clock)


# ---------------------------------------------------------------- WebSocket

def origin_ok(origin):
    """Only pages served as stompy.* (or from an IP / localhost) may connect.

    Without this, any web page a LAN user visits could open a socket here.
    """
    if not origin:
        return True  # not a browser
    host = (urlsplit(origin).hostname or "").lower()
    if host.startswith("stompy.") or host in ("localhost", "stompy"):
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def handshake(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError):
        return False
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split()
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    key = headers.get("sec-websocket-key", "")
    if (len(parts) < 2 or parts[0] != "GET" or parts[1].split("?")[0] != "/ws"
            or "websocket" not in headers.get("upgrade", "").lower() or not key):
        writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        return False
    if not origin_ok(headers.get("origin")):
        writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        return False
    accept = base64.b64encode(hashlib.sha1(key.encode() + GUID).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
    await writer.drain()
    return True


async def read_message(reader):
    """One complete message as (opcode, bytes), reassembling fragments.

    Control frames (ping/pong/close) can arrive between fragments and are
    returned immediately.
    """
    data, first_op = b"", None
    while True:
        b0, b1 = await reader.readexactly(2)
        fin, op, masked, n = b0 & 0x80, b0 & 0x0F, b1 & 0x80, b1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", await reader.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", await reader.readexactly(8))[0]
        if not masked or n > MAX_MESSAGE or len(data) + n > MAX_MESSAGE:
            raise ConnectionError("bad frame")
        mask = await reader.readexactly(4)
        payload = bytearray(await reader.readexactly(n))
        for i in range(n):
            payload[i] ^= mask[i & 3]
        if op >= 0x8:
            return op, bytes(payload)
        if op != OP_CONT:
            first_op = op
        data += payload
        if fin:
            return first_op, data


def frame(op, payload=b""):
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | op, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | op, 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | op, 127, n)
    return head + payload


def send(c, obj):
    """Queue a message without waiting: one slow phone must not stall the rest."""
    w = c.writer
    if w.is_closing():
        return
    if w.transport.get_write_buffer_size() > MAX_BUFFERED:
        log(f"dropping {c.name or c.id}: too far behind")
        w.close()
        return
    w.write(frame(OP_TEXT, json.dumps(obj, separators=(",", ":")).encode()))


def broadcast(obj, skip=None):
    for c in list(players.values()):
        if c is not skip:
            send(c, obj)


# ---------------------------------------------------------------- the arena

def scores():
    return [{"id": c.id, "name": c.name, "color": c.color, "kills": c.kills, "deaths": c.deaths,
             "ch": c.ch, "ready": 1 if c.ready else 0, "ping": c.ping, "team": c.team, "best": c.best, "acc": c.acc}
            for c in sorted(players.values(), key=lambda c: c.id)]


def tdm():
    return arena["mode"] == "tdm"


def limit():
    """Kills to win the round: a pilot's in ffa, a team's in tdm."""
    return TEAM_LIMIT if tdm() else SCORE_LIMIT


def paint(c):
    """The pilot's colour as everyone sees it: their pick, or their team's in tdm."""
    c.color = TEAM_COLORS[c.team] if tdm() else c.pick


def tally():
    """Each option's votes from the pilots still here, in VOTES order."""
    n = [0] * len(VOTES)
    for cid, v in arena["votes"].items():
        if cid in players:
            n[v] += 1
    return n


def vote_result():
    """The option with the most votes; a tie (or no votes) goes to the first."""
    n = tally()
    return n.index(max(n))


def keep(c, now=None):
    """A dropped pilot's place, kept under their token for KEEP seconds."""
    now = time.monotonic() if now is None else now
    departed[c.token] = {"id": c.id, "until": now + KEEP, "round": arena["round"], "team": c.team, "ready": c.ready,
                         "kills": c.kills, "deaths": c.deaths, "streak": c.streak, "best": c.best}


def resume(token, now=None):
    """The place kept under `token`, if it is still waiting (and taken off the
    list); expired places are cleared on the way."""
    now = time.monotonic() if now is None else now
    for t in [t for t, d in departed.items() if d["until"] < now]:
        del departed[t]
    saved = departed.pop(token, None) if isinstance(token, str) else None
    return saved if saved and saved["id"] not in players else None


def free_id():
    """The lowest id nobody has, sparing the ones kept for dropped pilots while any other is free."""
    held = {d["id"] for d in departed.values()}
    free = [i for i in range(1, MAX_PLAYERS + 1) if i not in players]
    return next((i for i in free if i not in held), free[0])


def smaller_team(skip=None):
    """The team with fewer pilots (STEEL on a tie): where a newcomer starts."""
    n = [0, 0]
    for p in players.values():
        if p is not skip:
            n[p.team] += 1
    return 1 if n[1] < n[0] else 0


def clean_name(raw, cid):
    name = "".join(ch for ch in str(raw or "")[:16] if ch.isalnum() or ch in " _-").strip().upper()[:12]
    return name or f"PILOT {cid}"


def num(v, lo, hi, default=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return default if v != v else max(lo, min(hi, v))   # v != v: NaN


def flag(v):
    return 1 if v else 0


def vec3(v, lim=1e4):
    """0 (none) or a point of three clamped numbers."""
    return [num(x, -lim, lim) for x in v[:3]] if isinstance(v, list) and len(v) >= 3 else 0


def chassis_or_stock(ch):
    """A chassis key from the list, else kestrel; whatever was sent (a list, a dict) never raises."""
    return ch if isinstance(ch, str) and ch in CHASSIS else "kestrel"


def clean_state(msg):
    """A state message rebuilt from the fields the game sends, every number
    finite and in range, so nothing malformed reaches the other screens."""
    hp = msg.get("hp")
    hp = [num(v, 0, 200) for v in hp[:5]] if isinstance(hp, list) else []
    out = {"t": "s", "ch": chassis_or_stock(msg.get("ch")),
           "x": num(msg.get("x"), -HALF, HALF), "y": num(msg.get("y"), -100, 2000), "z": num(msg.get("z"), -HALF, HALF),
           "yaw": num(msg.get("yaw"), -1e3, 1e3), "tw": num(msg.get("tw"), -4, 4), "p": num(msg.get("p"), -2, 2),
           "sp": num(msg.get("sp"), -60, 60), "air": flag(msg.get("air")), "al": flag(msg.get("al")), "sd": flag(msg.get("sd")),
           "hp": hp + [0.0] * (5 - len(hp)), "bm": flag(msg.get("bm")), "be": vec3(msg.get("be")), "bf": num(msg.get("bf"), 0, 10),
           "fl": vec3(msg.get("fl")), "sc": int(num(msg.get("sc"), 0, 99)), "sq": num(msg.get("sq"), 0, 1),
           "pu": int(num(msg.get("pu"), 0, 2)), "lt": flag(msg.get("lt"))}
    return out


def fx_allowed(c, now=None):
    """Spend one from the pilot's fx bucket; False when it's empty."""
    now = time.monotonic() if now is None else now
    c.fx_tokens = min(float(FX_RATE), c.fx_tokens + (now - c.fx_at) * FX_RATE)
    c.fx_at = now
    if c.fx_tokens < 1:
        return False
    c.fx_tokens -= 1
    return True


async def end_round(winner):
    """`winner`: the pilot who reached the limit; in tdm their team wins.
    Then ROUND_GAP seconds for the summary and the vote, which picks the next
    round: a new map, the same map, or the other mode on a new map."""
    arena["over"] = True
    arena["votes"] = {}
    over = {"t": "roundover", "winner": winner.id, "name": winner.name, "next": ROUND_GAP, "teams": arena["teams"], "scores": scores()}
    if tdm():
        over["team"] = winner.team
    log(f"round over: {'team ' + str(winner.team) if tdm() else winner.name} wins")
    broadcast(over)
    await sleep(ROUND_GAP)
    pick = vote_result()
    log(f"vote {tally()}: {VOTES[pick]}")
    if VOTES[pick] == "mode":
        arena["mode"] = "tdm" if arena["mode"] == "ffa" else "ffa"
    if VOTES[pick] != "same":
        arena.update(seed=random.randrange(1, 10**6), pal=random.choice(PALETTES))
    arena.update(over=False, teams=[0, 0], votes={}, round=arena["round"] + 1)
    for c in players.values():
        c.kills = c.deaths = c.streak = c.best = 0
        c.acc = -1
        paint(c)
    broadcast({"t": "newround", "seed": arena["seed"], "pal": arena["pal"], "mode": arena["mode"], "limit": limit(),
               "teams": arena["teams"], "vote": VOTES[pick], "scores": scores()})


def handle_message(c, msg):
    t = msg.get("t")
    if t in ("s", "fx"):
        # Movement and weapon effects: stamp the sender and pass them on. A
        # state message is rebuilt clean; effects past the rate are dropped.
        if t == "fx" and not fx_allowed(c):
            return
        out = clean_state(msg) if t == "s" else msg
        if t == "s":
            c.ch = out["ch"]
        out["id"] = c.id
        if t == "s" and "lo" in msg:
            # A mechlab loadout rides the state message now and then, checked
            # against the chassis as sent. One that is malformed or over its
            # tonnage goes out as stock, and the sender is told so its HUD can
            # say LOADOUT REJECTED; one for an unknown chassis is dropped.
            lo, rejected = check_loadout(msg.get("ch"), msg["lo"])
            if lo is not None:
                out["lo"] = lo
            if rejected:
                send(c, {"t": "note", "k": "lo"})
        broadcast(out, skip=c)
    elif t == "ready":
        # Out of the lobby and into the arena: everyone's pilot list says so.
        if not c.ready:
            c.ready = True
            broadcast({"t": "ready", "id": c.id, "scores": scores()})
    elif t == "team":
        # tdm: a pilot still in the lobby picks a side; the colour follows.
        if tdm() and not c.ready:
            c.team = 1 if num(msg.get("team"), 0, 1) >= 0.5 else 0
            paint(c)
            broadcast({"t": "team", "id": c.id, "scores": scores()})
    elif t == "vote":
        # Between rounds: next map, same map, or the other mode. The last vote counts.
        if arena["over"]:
            mode, choice = msg.get("mode"), msg.get("map")
            arena["votes"][c.id] = 2 if mode in MODES and mode != arena["mode"] else 1 if choice == "same" else 0
            broadcast({"t": "tally", "votes": tally(), "scores": scores()})
    elif t == "stats":
        # Round end: the pilot's own accuracy for the summary (shots are the client's to count).
        if arena["over"]:
            c.acc = int(num(msg.get("acc"), 0, 100))
            broadcast({"t": "tally", "votes": tally(), "scores": scores()})
    elif t == "ping":
        # The lobby's ping: echoed at once with the server's time and every
        # pilot's last round trip; the client reports its own with the next.
        c.ping = int(num(msg.get("rtt"), 0, 9999))
        send(c, {"t": "ping", "n": msg.get("n") if isinstance(msg.get("n"), int) else 0, "ts": int(time.time() * 1000),
                 "pings": {str(p.id): p.ping for p in players.values()}})
    elif t == "hit":
        target = players.get(int(num(msg.get("to"), 0, 99)))
        if target and target is not c and not arena["over"] and not (tdm() and target.team == c.team):   # friendly fire is off
            p = msg.get("p") if isinstance(msg.get("p"), list) else [0, 0, 0]
            # fu: a fusion-cannon discharge -- the victim's client treats it as
            # a kill rather than damage (hit damage is capped at 40).
            out = {"t": "hit", "from": c.id, "amt": num(msg.get("amt"), 0, 40),
                   "p": [num(v, -1e4, 1e4) for v in p[:3]], "fu": 1 if msg.get("fu") else 0}
            # kb: a shove [vx, vz] the victim adds to its push, clamped; me / st: punch / stomp.
            kb = msg.get("kb")
            if isinstance(kb, list) and len(kb) == 2:
                out["kb"] = [num(v, -30, 30) for v in kb]
            if msg.get("me"):
                out["me"] = 1
            if msg.get("st"):
                out["st"] = 1
            if msg.get("zap"):
                out["zap"] = 1   # a bolt: the victim's HUD scrambles
            hh = num(msg.get("hh"), 0, 20)
            if hh > 0:
                out["hh"] = hh   # heat poured in (TOASTER), clamped
            send(target, out)
    elif t == "died":
        c.deaths += 1
        c.streak = 0
        killer = players.get(int(num(msg.get("by"), 0, 99)))
        if killer is c:
            killer = None
        scored = killer and not arena["over"] and not (tdm() and killer.team == c.team)   # a teammate never scores
        if scored:
            killer.kills += 1
            killer.streak += 1
            killer.best = max(killer.best, killer.streak)
            if tdm():
                arena["teams"][killer.team] += 1
        kill = {"t": "kill", "victim": c.id, "killer": killer.id if killer else 0, "teams": arena["teams"], "scores": scores()}
        if msg.get("me"):
            kill["me"] = 1   # a punch: the kill feed says so
        broadcast(kill)
        if scored and (arena["teams"][killer.team] if tdm() else killer.kills) >= limit():
            asyncio.ensure_future(end_round(killer))


async def session(reader, writer):
    peer = writer.get_extra_info("peername")
    ip = peer[0] if peer else "?"
    if conns.get(ip, 0) >= PER_IP:
        # One address holding too many sockets: refused before the upgrade.
        writer.write(b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        log(f"refused {ip}: {PER_IP} sockets already")
        writer.close()
        return
    conns[ip] = conns.get(ip, 0) + 1
    c = None
    try:
        if not await handshake(reader, writer):
            return
        c = Client(writer)
        # The first message must be a hello with a callsign and colour.
        op, data = await asyncio.wait_for(read_message(reader), HELLO_TIMEOUT)
        hello = json.loads(data) if op == OP_TEXT else {}
        if hello.get("t") != "hello":
            return
        if hello.get("v") != PROTOCOL:
            # Another version of the game: say which one to get, and close.
            send(c, {"t": "version", "need": PROTOCOL})
            log(f"turned away v{hello.get('v')} from {peer[0] if peer else '?'} (need v{PROTOCOL})")
            return
        if len(players) >= MAX_PLAYERS:
            send(c, {"t": "full", "max": MAX_PLAYERS})
            return
        # A dropped pilot back within KEEP seconds: the same id, side and
        # score (this round's), and straight back in if they were.
        saved = resume(hello.get("token"))
        c.id = saved["id"] if saved else free_id()
        c.name = clean_name(hello.get("name"), c.id)
        c.pick = int(num(hello.get("color"), 0, 7))
        c.team = saved["team"] if saved else smaller_team()
        if saved:
            c.ready = saved["ready"]
            if saved["round"] == arena["round"]:
                c.kills, c.deaths, c.streak, c.best = saved["kills"], saved["deaths"], saved["streak"], saved["best"]
        paint(c)
        c.ch = chassis_or_stock(hello.get("ch"))
        c.token = secrets.token_hex(8)
        players[c.id] = c
        log(f"{'back' if saved else 'join'} {c.id} {c.name} from {peer[0] if peer else '?'} ({len(players)} playing)")
        send(c, {"t": "welcome", "id": c.id, "seed": arena["seed"], "pal": arena["pal"], "mode": arena["mode"],
                 "limit": limit(), "teams": arena["teams"], "over": arena["over"], "token": c.token,
                 "resumed": 1 if saved else 0, "scores": scores()})
        broadcast({"t": "join", "id": c.id, "name": c.name, "color": c.color, "scores": scores()}, skip=c)

        while True:
            op, data = await read_message(reader)
            c.last = time.monotonic()
            if op == OP_CLOSE:
                writer.write(frame(OP_CLOSE, data[:2]))
                break
            if op == OP_PING:
                writer.write(frame(OP_PONG, data))
            elif op == OP_TEXT:
                try:
                    msg = json.loads(data)
                except ValueError:
                    continue
                if isinstance(msg, dict):
                    try:
                        handle_message(c, msg)
                    except Exception as e:   # one malformed message is dropped, not the pilot (the fuzz tests try)
                        log(f"bad message from {c.id} {c.name}: {e!r}")
    except (asyncio.IncompleteReadError, ConnectionError, asyncio.TimeoutError, OSError, ValueError):
        pass
    finally:
        if c and players.get(c.id) is c:
            del players[c.id]
            keep(c)
            log(f"leave {c.id} {c.name} ({len(players)} playing)")
            broadcast({"t": "leave", "id": c.id, "scores": scores()})
        conns[ip] -= 1
        if conns[ip] <= 0:
            del conns[ip]
        writer.close()


async def heartbeat():
    """Ping everyone; drop anyone silent too long (phones sleep without closing)."""
    while True:
        await asyncio.sleep(PING_EVERY)
        now = time.monotonic()
        for c in list(players.values()):
            if now - c.last > DROP_AFTER:
                log(f"timeout {c.id} {c.name}")
                c.writer.close()
            elif not c.writer.is_closing():
                c.writer.write(frame(OP_PING))


def parse_args(argv=None):
    """Flags, each with an environment variable as its default; a bare port
    as the only argument still works (`server.py 8096`)."""
    p = argparse.ArgumentParser(description="Stompy's arena relay")
    p.add_argument("port_arg", nargs="?", type=int, help=argparse.SUPPRESS)
    p.add_argument("--host", default=os.environ.get("STOMPY_HOST", "0.0.0.0"), help="address to listen on (STOMPY_HOST, default 0.0.0.0)")
    p.add_argument("--port", type=int, default=int(os.environ.get("STOMPY_PORT", 8096)), help="port (STOMPY_PORT, default 8096)")
    p.add_argument("--mode", choices=MODES, default=MODE, help="arena mode: ffa or tdm (STOMPY_MODE, default ffa)")
    p.add_argument("--limit", type=int, default=SCORE_LIMIT, help=f"a pilot's kills to win a free-for-all round (STOMPY_SCORE_LIMIT, default {SCORE_LIMIT})")
    p.add_argument("--team-limit", type=int, default=TEAM_LIMIT, help=f"a team's kills to win a team round (STOMPY_TEAM_LIMIT, default {TEAM_LIMIT})")
    p.add_argument("--gap", type=int, default=ROUND_GAP, help=f"seconds between rounds (STOMPY_ROUND_GAP, default {ROUND_GAP})")
    p.add_argument("--per-ip", type=int, default=PER_IP, help=f"sockets from one address at once (STOMPY_PER_IP, default {PER_IP})")
    p.add_argument("--log", default=LOG_FILE, help="also log to this file (STOMPY_LOG)")
    a = p.parse_args(argv)
    if a.port_arg is not None:
        a.port = a.port_arg
    return a


async def main():
    global SCORE_LIMIT, TEAM_LIMIT, ROUND_GAP, PER_IP, MODE, LOG_FILE
    a = parse_args()
    SCORE_LIMIT, TEAM_LIMIT, ROUND_GAP, PER_IP, MODE, LOG_FILE = a.limit, a.team_limit, a.gap, a.per_ip, a.mode, a.log
    arena["mode"] = MODE
    server = await asyncio.start_server(session, a.host, a.port, limit=16 * 1024)
    log(f"stompy arena on {a.host}:{a.port}/ws ({MODE}, max {MAX_PLAYERS}, first to {limit()}, {PER_IP} per address)")
    asyncio.ensure_future(heartbeat())
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
