#!/usr/bin/env python3
"""Stompy multiplayer relay: one arena for up to eight phones, free-for-all or team
deathmatch, and co-op rooms of up to four flying a mission together.

The server does not simulate anything. Each client runs its own mech and
sends its state ~15 times a second; the server stamps it with the sender's id
and relays it to everyone else. Hits are decided by the shooter's client (what
you see is what counts, which feels fair on Wi-Fi) and forwarded to the
victim, whose client applies the damage and reports its own death. The server
keeps the only shared state: who is connected, the scores, and the round.

Rooms: the arena is room ARENA, always there. A hello with `create` opens a
co-op room under a new four-letter code; its first pilot is the host, whose
client runs the enemies and the objectives (docs/specs/09-coop.md). The
server does not understand missions: it routes. A guest's `ehit` goes to the
host only; the host's `es`, `ent`, `entx`, `obj` and `over` go to everyone
else; only the host's `hit` (enemy fire) reaches a pilot. When the host
leaves, the lowest id left takes over; an empty co-op room is gone.

Fine among friends on a LAN; trivially cheatable by anyone who edits the JS.

WebSockets are implemented here directly (RFC 6455: handshake, masked client
frames, ping/pong, close) so this stays stdlib-only.

    python3 server.py [port]        # default 8096; the game connects to :8096/ws
"""
import argparse
import asyncio
import base64
import hashlib
import hmac
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
PROTOCOL = 19             # src/net/protocol.js PROTOCOL; a hello with another is told to update (a Node test keeps them equal)
HALF = 96 * 24 / 2        # the map's half width (src/world/terrain.js): positions are clamped to it
FX_RATE = 40              # weapon effects per second per pilot; more are dropped (a beam flash is per shot, guided updates 15 Hz)
PER_IP = int(os.environ.get("STOMPY_PER_IP", 8))   # sockets from one address at once (phones and a laptop behind one NAT)
ORIGINS = {h.strip().lower() for h in os.environ.get("STOMPY_ORIGINS", "").split(",") if h.strip()}   # hosted pages allowed besides the LAN rule
PROXY = os.environ.get("STOMPY_PROXY", "")   # behind a proxy: "local" (Caddy on this machine) or "private" (a container host's); see from_proxy
ADMIN = os.environ.get("STOMPY_ADMIN", "")          # a hello presenting this may kick (no UI: the hook)
MSG_RATE = 60             # messages a second a pilot may send, on average (a co-op host runs the world: HOST_RATE times that)
HOST_RATE = 3
MSG_BURST = 2             # seconds of it in hand at once; past the bucket, the pilot is dropped
ROOM_RATE, ROOM_WINDOW = 3, 600   # rooms one address may open per ROOM_WINDOW seconds
ROOM_IDLE = 600           # seconds an empty co-op room waits for someone before it is gone
DENY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "names_deny.txt")   # callsign words turned away (the owner edits it)
STARTED = time.monotonic()
MODE = os.environ.get("STOMPY_MODE", "ffa")         # the arena's mode: ffa (free-for-all) or tdm (team deathmatch)
MODES = ("ffa", "tdm")
TEAM_LIMIT = int(os.environ.get("STOMPY_TEAM_LIMIT", 20))   # a team's kills to win a round in tdm
TEAM_COLORS = (0, 1)      # STEEL and RED (src/data/colors.js MP_COLORS): in tdm a team's colour is forced
ARENA = "ARENA"           # the arena's room code: always there
COOP_MAX = 4              # pilots in a co-op room
CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ"   # room codes: four of these (no vowels, so no words)
FROM_HOST = ("es", "ent", "entx", "obj", "over")   # co-op: the host's world, relayed to everyone else
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
        self.room = None      # the Room joined (None until the hello)
        self.last = time.monotonic()
        self.fx_tokens, self.fx_at = float(FX_RATE), time.monotonic()   # the fx rate limit: a bucket that refills at FX_RATE a second
        self.msg_tokens, self.msg_at = float(MSG_RATE * MSG_BURST), time.monotonic()   # every message: a bucket; empty, and the pilot is dropped
        self.admin = False    # presented STOMPY_ADMIN in hello


class Room:
    """An arena (kind "arena": the public ARENA, or a private one by its code)
    or a co-op room (kind "coop"), and who is in it."""
    def __init__(self, code, kind, players=None, mission=None, state=None):
        self.code, self.kind = code, kind
        self.arena = (state or new_arena()) if kind == "arena" else None   # an arena's round: its map, mode, teams, votes
        self.players = {} if players is None else players
        self.max = MAX_PLAYERS if kind == "arena" else COOP_MAX
        self.host = 0          # co-op: the pilot id whose client runs the enemies and objectives
        self.mission = mission  # co-op: the host's `create` (mission, difficulty, seed), passed on as `def`
        self.started = False   # co-op: the host has pressed READY
        self.over = None       # co-op: the host's `over`, for anyone who joins after
        self.empty_since = None   # a coded room: when the last pilot left (ROOM_IDLE later, it is collected)


def new_arena(mode=None):
    """A fresh round's state for an arena room."""
    return {"seed": random.randrange(1, 10**6), "pal": random.choice(PALETTES), "over": False,
            "mode": mode if mode in MODES else "ffa", "teams": [0, 0],   # teams: each team's kills this round (tdm)
            "votes": {}, "round": 0}   # votes: pilot id -> VOTES index, between rounds; round: counts rounds (a score kept from an old one is void)


players: dict[int, Client] = {}   # the public arena's pilots
arena = new_arena(MODE)   # the public arena's round
rooms: dict[str, Room] = {ARENA: Room(ARENA, "arena", players, state=arena)}
opened: dict[str, list] = {}   # address -> when it opened rooms, for ROOM_RATE
conns: dict[str, int] = {}   # open sockets per address, for the PER_IP cap
departed: dict[str, dict] = {}   # token -> a dropped pilot's id and score, until KEEP runs out
sleep = asyncio.sleep     # the gap between rounds waits on this (the tests swap in a fake clock)


# ---------------------------------------------------------------- WebSocket

def origin_ok(origin):
    """Only pages served as stompy.* (or from an IP / localhost) may connect.

    Without this, any web page a LAN user visits could open a socket here.
    """
    if not origin:
        return True  # not a browser
    host = (urlsplit(origin).hostname or "").lower()
    if host in ORIGINS:   # a hosted page the owner named (STOMPY_ORIGINS)
        return True
    if host.startswith("stompy.") or host in ("localhost", "stompy"):
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def client_ip(peer_ip, headers):
    """The pilot's address. Behind a proxy every socket comes from the proxy,
    so it's the last X-Forwarded-For entry, the one the proxy wrote;
    otherwise the socket's own."""
    if from_proxy(peer_ip):
        fwd = headers.get("x-forwarded-for", "").split(",")[-1].strip()
        try:
            return str(ipaddress.ip_address(fwd))
        except ValueError:
            pass
    return peer_ip


def from_proxy(ip):
    """Whether a socket from `ip` is the proxy's (PROXY): from this machine
    ("local"), or from any private address ("private", a container host's
    proxy, which no one on the internet can come from)."""
    if PROXY not in ("local", "private"):
        return False
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.is_loopback or (PROXY == "private" and a.is_private)


async def handshake(reader, writer, admit=lambda headers: True):
    """The upgrade to a WebSocket; `admit` gets the headers last and may
    refuse (it writes the answer)."""
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
    if len(parts) >= 2 and parts[0] == "GET" and parts[1].split("?")[0] == "/health":
        # For an uptime monitor or Caddy's health check: rooms, pilots, how long up.
        body = json.dumps(health()).encode()
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode()
                     + b"\r\nConnection: close\r\n\r\n" + body)
        return False
    key = headers.get("sec-websocket-key", "")
    if (len(parts) < 2 or parts[0] != "GET" or parts[1].split("?")[0] != "/ws"
            or "websocket" not in headers.get("upgrade", "").lower() or not key):
        writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        return False
    if not origin_ok(headers.get("origin")):
        writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        return False
    if not admit(headers):
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


def broadcast(obj, skip=None, room=None):
    """To everyone in the room (the arena unless one is named) but `skip`."""
    for c in list((room.players if room else players).values()):
        if c is not skip:
            send(c, obj)


# ---------------------------------------------------------------- the arena

def scores(room=None):
    return [{"id": c.id, "name": c.name, "color": c.color, "kills": c.kills, "deaths": c.deaths,
             "ch": c.ch, "ready": 1 if c.ready else 0, "ping": c.ping, "team": c.team, "best": c.best, "acc": c.acc}
            for c in sorted((room.players if room else players).values(), key=lambda c: c.id)]


def room_of(c):
    return c.room or rooms[ARENA]


def state_of(room=None):
    """An arena room's round (the public arena's unless one is named)."""
    return (room or rooms[ARENA]).arena


def tdm(room=None):
    return state_of(room)["mode"] == "tdm"


def limit(room=None):
    """Kills to win the round: a pilot's in ffa, a team's in tdm."""
    return TEAM_LIMIT if tdm(room) else SCORE_LIMIT


def paint(c):
    """The pilot's colour as everyone sees it: their pick, or their team's in tdm."""
    room = room_of(c)
    c.color = TEAM_COLORS[c.team] if room.kind == "arena" and tdm(room) else c.pick


def tally(room=None):
    """Each option's votes from the pilots still here, in VOTES order."""
    room = room or rooms[ARENA]
    n = [0] * len(VOTES)
    for cid, v in room.arena["votes"].items():
        if cid in room.players:
            n[v] += 1
    return n


def vote_result(room=None):
    """The option with the most votes; a tie (or no votes) goes to the first."""
    n = tally(room)
    return n.index(max(n))


def keep(c, now=None):
    """A dropped pilot's place, kept under their token for KEEP seconds."""
    now = time.monotonic() if now is None else now
    room = room_of(c)
    departed[c.token] = {"id": c.id, "room": room.code, "until": now + KEEP, "round": room.arena["round"] if room.arena else 0, "team": c.team, "ready": c.ready,
                         "kills": c.kills, "deaths": c.deaths, "streak": c.streak, "best": c.best}


def resume(token, room=None, now=None):
    """The place kept under `token` in this room, if it is still waiting (and
    taken off the list); expired places are cleared on the way."""
    room = room or rooms[ARENA]
    now = time.monotonic() if now is None else now
    for t in [t for t, d in departed.items() if d["until"] < now]:
        del departed[t]
    saved = departed.pop(token, None) if isinstance(token, str) else None
    return saved if saved and saved["room"] == room.code and saved["id"] not in room.players else None


def free_id(room=None):
    """The lowest id nobody in the room has, sparing the ones kept for dropped pilots while any other is free."""
    room = room or rooms[ARENA]
    held = {d["id"] for d in departed.values() if d["room"] == room.code}
    free = [i for i in range(1, room.max + 1) if i not in room.players]
    return next((i for i in free if i not in held), free[0])


def new_code(pick=secrets.choice):
    """Four letters no room has."""
    while True:
        code = "".join(pick(CODE_LETTERS) for _ in range(4))
        if code not in rooms:
            return code


def clean_mission(create):
    """A co-op room's mission as the host asked for it: the server only keeps and passes it on."""
    return {"kind": "coop", "mission": int(num(create.get("mission"), 0, 99)),
            "diff": "".join(ch for ch in str(create.get("diff") or "normal")[:8] if ch.isalpha()).lower() or "normal",
            "seed": int(num(create.get("seed"), 0, 10**9))}


def clean_hit(msg, sender):
    """A hit as the victim gets it: from whom, clamped (amt to 40, kb parts to 30, hh to 20)."""
    p = msg.get("p") if isinstance(msg.get("p"), list) else [0, 0, 0]
    # fu: a fusion-cannon discharge -- the victim's client treats it as
    # a kill rather than damage (hit damage is capped at 40).
    out = {"t": "hit", "from": sender, "amt": num(msg.get("amt"), 0, 40),
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
    return out


def smaller_team(skip=None, room=None):
    """The team with fewer pilots (STEEL on a tie): where a newcomer starts."""
    n = [0, 0]
    for p in (room or rooms[ARENA]).players.values():
        if p is not skip:
            n[p.team] += 1
    return 1 if n[1] < n[0] else 0


def health():
    return {"rooms": len(rooms), "players": sum(len(r.players) for r in rooms.values()), "uptime": int(time.monotonic() - STARTED)}


def load_deny(path=None):
    """The words no callsign may contain: one a line, # for comments, any case."""
    try:
        with open(path or DENY_FILE, encoding="utf-8") as f:
            return {w for w in (line.split("#")[0].strip().lower() for line in f) if w}
    except OSError:
        return set()


DENY = load_deny()


def clean_name(raw, cid):
    name = "".join(ch for ch in str(raw or "")[:16] if ch.isalnum() or ch in " _-").strip().upper()[:12]
    squashed = "".join(ch for ch in name.lower() if ch.isalnum())
    if any(w in squashed for w in DENY):
        return f"PILOT {cid}"   # a word on the deny-list: a plain callsign instead
    return name or f"PILOT {cid}"


def msg_allowed(c, now=None):
    """Spend one from the pilot's message bucket; False when it is empty (the
    pilot is then dropped). A co-op host sends the whole world: more."""
    now = time.monotonic() if now is None else now
    rate = MSG_RATE * (HOST_RATE if c.room and c.room.kind == "coop" and c.room.host == c.id else 1)
    c.msg_tokens = min(rate * MSG_BURST, c.msg_tokens + (now - c.msg_at) * rate)
    c.msg_at = now
    if c.msg_tokens < 1:
        return False
    c.msg_tokens -= 1
    return True


def may_open_room(ip, now=None):
    """ROOM_RATE rooms per ROOM_WINDOW seconds from one address; counts this one if allowed."""
    now = time.monotonic() if now is None else now
    recent = [t for t in opened.get(ip, []) if now - t < ROOM_WINDOW]
    if len(recent) >= ROOM_RATE:
        opened[ip] = recent
        return False
    opened[ip] = recent + [now]
    return True


def collect_rooms(now=None):
    """Coded rooms empty for ROOM_IDLE seconds are gone. The public arena never is."""
    now = time.monotonic() if now is None else now
    for code, room in list(rooms.items()):
        if code != ARENA and not room.players and room.empty_since is not None and now - room.empty_since >= ROOM_IDLE:
            del rooms[code]
            log(f"room {code} closed (empty {ROOM_IDLE} s)")


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
    if "ts" in msg:
        out["ts"] = int(num(msg.get("ts"), 0, 1e13))   # the sender's clock, ms: others draw it smoothly through jitter
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
    round: a new map, the same map, or the other mode on a new map. Each
    arena room runs its own."""
    room = room_of(winner)
    st = room.arena
    st["over"] = True
    st["votes"] = {}
    over = {"t": "roundover", "winner": winner.id, "name": winner.name, "next": ROUND_GAP, "teams": st["teams"], "scores": scores(room)}
    if tdm(room):
        over["team"] = winner.team
    log(f"round over in {room.code}: {'team ' + str(winner.team) if tdm(room) else winner.name} wins")
    broadcast(over, room=room)
    await sleep(ROUND_GAP)
    pick = vote_result(room)
    log(f"vote in {room.code} {tally(room)}: {VOTES[pick]}")
    if VOTES[pick] == "mode":
        st["mode"] = "tdm" if st["mode"] == "ffa" else "ffa"
    if VOTES[pick] != "same":
        st.update(seed=random.randrange(1, 10**6), pal=random.choice(PALETTES))
    st.update(over=False, teams=[0, 0], votes={}, round=st["round"] + 1)
    for c in room.players.values():
        c.kills = c.deaths = c.streak = c.best = 0
        c.acc = -1
        paint(c)
    broadcast({"t": "newround", "seed": st["seed"], "pal": st["pal"], "mode": st["mode"], "limit": limit(room),
               "teams": st["teams"], "vote": VOTES[pick], "scores": scores(room)}, room=room)


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
        broadcast(out, skip=c, room=c.room)
    elif t == "ready":
        # Out of the lobby and into the arena: everyone's pilot list says so.
        # In co-op, the host's READY starts the mission for everyone.
        room = c.room or rooms[ARENA]
        if not c.ready:
            c.ready = True
            if room.kind == "coop" and c.id == room.host:
                room.started = True
            broadcast({"t": "ready", "id": c.id, "started": 1 if room.started else 0, "scores": scores(room)}, room=room)
    elif t == "ping":
        # The lobby's ping: echoed at once with the server's time and every
        # pilot's last round trip; the client reports its own with the next.
        c.ping = int(num(msg.get("rtt"), 0, 9999))
        send(c, {"t": "ping", "n": msg.get("n") if isinstance(msg.get("n"), int) else 0, "ts": int(time.time() * 1000),
                 "pings": {str(p.id): p.ping for p in (c.room or rooms[ARENA]).players.values()}})
    elif t == "kick":
        # The owner's hook (STOMPY_ADMIN in hello): drop a pilot in the same room.
        target = (c.room or rooms[ARENA]).players.get(int(num(msg.get("id"), 0, 99)))
        if c.admin and target and target is not c:
            log(f"kick {target.id} {target.name} by {c.id} {c.name}")
            target.writer.close()
    elif c.room and c.room.kind == "coop":
        handle_coop(c, msg, t)
    else:
        handle_arena(c, msg, t)


def handle_arena(c, msg, t):
    """An arena room's own messages (the public one's or a private one's)."""
    room = room_of(c)
    st = room.arena
    if t == "team":
        # tdm: a pilot still in the lobby picks a side; the colour follows.
        if tdm(room) and not c.ready:
            c.team = 1 if num(msg.get("team"), 0, 1) >= 0.5 else 0
            paint(c)
            broadcast({"t": "team", "id": c.id, "scores": scores(room)}, room=room)
    elif t == "vote":
        # Between rounds: next map, same map, or the other mode. The last vote counts.
        if st["over"]:
            mode, choice = msg.get("mode"), msg.get("map")
            st["votes"][c.id] = 2 if mode in MODES and mode != st["mode"] else 1 if choice == "same" else 0
            broadcast({"t": "tally", "votes": tally(room), "scores": scores(room)}, room=room)
    elif t == "stats":
        # Round end: the pilot's own accuracy for the summary (shots are the client's to count).
        if st["over"]:
            c.acc = int(num(msg.get("acc"), 0, 100))
            broadcast({"t": "tally", "votes": tally(room), "scores": scores(room)}, room=room)
    elif t == "hit":
        target = room.players.get(int(num(msg.get("to"), 0, 99)))
        if target and target is not c and not st["over"] and not (tdm(room) and target.team == c.team):   # friendly fire is off
            send(target, clean_hit(msg, c.id))
    elif t == "died":
        c.deaths += 1
        c.streak = 0
        killer = room.players.get(int(num(msg.get("by"), 0, 99)))
        if killer is c:
            killer = None
        scored = killer and not st["over"] and not (tdm(room) and killer.team == c.team)   # a teammate never scores
        if scored:
            killer.kills += 1
            killer.streak += 1
            killer.best = max(killer.best, killer.streak)
            if tdm(room):
                st["teams"][killer.team] += 1
        kill = {"t": "kill", "victim": c.id, "killer": killer.id if killer else 0, "teams": st["teams"], "scores": scores(room)}
        if msg.get("me"):
            kill["me"] = 1   # a punch: the kill feed says so
        broadcast(kill, room=room)
        if scored and (st["teams"][killer.team] if tdm(room) else killer.kills) >= limit(room):
            asyncio.ensure_future(end_round(killer))


def handle_coop(c, msg, t):
    """A co-op room's own messages, routed by who the host is."""
    room = c.room
    host = room.players.get(room.host)
    if t in FROM_HOST:
        # The host's world (enemies, entities, objectives, the end): to
        # everyone else, as sent. `over` is kept for anyone who joins after.
        if c is host:
            if t == "over":
                room.over = msg
            broadcast(msg, skip=c, room=room)
    elif t == "ehit":
        # A guest's hit on an enemy (eid) or a mission entity (ent, its id): the
        # host applies it (the shooter decided it landed).
        if host and c is not host:
            out = clean_hit(msg, c.id)
            out["t"] = "ehit"
            ent = msg.get("ent")
            if isinstance(ent, str) and 0 < len(ent) <= 32 and all(ch.isalnum() or ch in "_-" for ch in ent):
                out["ent"] = ent
                if "yaw" in msg:
                    out["yaw"] = num(msg.get("yaw"), -1e3, 1e3)   # a punch: which way it falls
            else:
                out["eid"] = int(num(msg.get("eid"), 0, 9999))
            send(host, out)
    elif t == "hit":
        # Enemy fire, decided by the host's AI: to the pilot it hit. Pilots never hit each other here.
        target = room.players.get(int(num(msg.get("to"), 0, 99)))
        if c is host and target and target is not c:
            out = clean_hit(msg, 0)
            out["eid"] = int(num(msg.get("eid"), 0, 9999))
            send(target, out)
    elif t == "died":
        c.deaths += 1
        broadcast({"t": "kill", "victim": c.id, "killer": 0, "scores": scores(room)}, room=room)


async def session(reader, writer):
    peer = writer.get_extra_info("peername")
    ip = peer[0] if peer else "?"
    counted = None

    def take(addr):
        # One address holding too many sockets: refused before the upgrade.
        nonlocal counted
        if conns.get(addr, 0) >= PER_IP:
            writer.write(b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            log(f"refused {addr}: {PER_IP} sockets already")
            return False
        conns[addr] = conns.get(addr, 0) + 1
        counted = addr
        return True

    # Behind a proxy the address is in the headers, so it's counted there.
    proxied = from_proxy(ip)
    if not proxied and not take(ip):
        writer.close()
        return

    def admit(headers):
        nonlocal ip
        if not proxied:
            return True
        ip = client_ip(ip, headers)
        return take(ip)

    c = None
    try:
        if not await handshake(reader, writer, admit):
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
            log(f"turned away v{hello.get('v')} from {ip} (need v{PROTOCOL})")
            return
        # The room: a new one (`create`: a private arena, or co-op), one by
        # its code, or the public arena.
        create, want = hello.get("create"), hello.get("room")
        if isinstance(create, dict):
            if not may_open_room(ip):
                send(c, {"t": "busy"})   # too many rooms from here lately
                log(f"refused a room to {ip}: {ROOM_RATE} in {ROOM_WINDOW} s")
                return
            if create.get("kind") == "arena":
                room = Room(new_code(), "arena", state=new_arena(create.get("mode")))
                log(f"room {room.code} opened: a private {room.arena['mode']} arena")
            else:
                room = Room(new_code(), "coop", mission=clean_mission(create))
                log(f"room {room.code} opened: {room.mission}")
            rooms[room.code] = room
        else:
            room = rooms.get(want.strip().upper() if isinstance(want, str) else ARENA)
            if room is None:
                send(c, {"t": "noroom"})
                return
        if len(room.players) >= room.max:
            send(c, {"t": "full", "max": room.max})
            return
        c.room = room
        # A dropped pilot back within KEEP seconds: the same id, side and
        # score (this round's), and straight back in if they were.
        saved = resume(hello.get("token"), room)
        c.id = saved["id"] if saved else free_id(room)
        c.name = clean_name(hello.get("name"), c.id)
        c.pick = int(num(hello.get("color"), 0, 7))
        c.team = saved["team"] if saved else smaller_team(room=room) if room.kind == "arena" else 0
        if saved:
            c.ready = saved["ready"]
            if room.kind == "coop" or saved["round"] == room.arena["round"]:
                c.kills, c.deaths, c.streak, c.best = saved["kills"], saved["deaths"], saved["streak"], saved["best"]
        paint(c)
        c.ch = chassis_or_stock(hello.get("ch"))
        c.admin = bool(ADMIN) and isinstance(hello.get("admin"), str) and hmac.compare_digest(hello["admin"], ADMIN)
        c.token = secrets.token_hex(8)
        room.players[c.id] = c
        room.empty_since = None
        if room.kind == "coop" and room.host not in room.players:
            room.host = c.id   # the first pilot in hosts
        log(f"{'back' if saved else 'join'} {c.id} {c.name} in {room.code} from {ip} ({len(room.players)} there)")
        welcome = {"t": "welcome", "id": c.id, "room": room.code, "kind": room.kind, "host": room.host,
                   "token": c.token, "resumed": 1 if saved else 0, "scores": scores(room)}
        if room.kind == "arena":
            st = room.arena
            welcome.update(seed=st["seed"], pal=st["pal"], mode=st["mode"], limit=limit(room), teams=st["teams"], over=st["over"])
        else:
            welcome.update({"def": room.mission, "started": 1 if room.started else 0})
        send(c, welcome)
        if room.over:
            send(c, room.over)   # the mission already ended: the debrief
        broadcast({"t": "join", "id": c.id, "name": c.name, "color": c.color, "scores": scores(room)}, skip=c, room=room)

        while True:
            op, data = await read_message(reader)
            c.last = time.monotonic()
            if op == OP_CLOSE:
                writer.write(frame(OP_CLOSE, data[:2]))
                break
            if op == OP_PING:
                writer.write(frame(OP_PONG, data))
            elif op == OP_TEXT:
                if not msg_allowed(c):
                    log(f"dropping {c.id} {c.name}: over {MSG_RATE} messages a second")
                    break   # a flood: this pilot goes, the others play on
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
        room = c.room if c else None
        if room and room.players.get(c.id) is c:
            del room.players[c.id]
            keep(c)
            log(f"leave {c.id} {c.name} from {room.code} ({len(room.players)} there)")
            broadcast({"t": "leave", "id": c.id, "scores": scores(room)}, room=room)
            if room.code != ARENA and not room.players:
                room.empty_since = time.monotonic()   # gone after ROOM_IDLE unless someone comes back (collect_rooms)
                log(f"room {room.code} empty")
            elif room.kind == "coop":
                if room.host == c.id:
                    room.host = min(room.players)   # the lowest id left runs the world now
                    log(f"room {room.code}: {room.host} is host")
                    broadcast({"t": "host", "id": room.host, "scores": scores(room)}, room=room)
        if counted is not None:
            conns[counted] -= 1
            if conns[counted] <= 0:
                del conns[counted]
        writer.close()


async def heartbeat():
    """Ping everyone; drop anyone silent too long (phones sleep without closing)."""
    while True:
        await asyncio.sleep(PING_EVERY)
        now = time.monotonic()
        collect_rooms(now)
        for c in [c for room in list(rooms.values()) for c in room.players.values()]:
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
    p.add_argument("--proxy", choices=("", "local", "private"), default=PROXY,
                   help="behind a proxy, a pilot's address is its X-Forwarded-For: local for one on this machine (Caddy), private for a container host's (STOMPY_PROXY)")
    a = p.parse_args(argv)
    if a.port_arg is not None:
        a.port = a.port_arg
    return a


async def main():
    global SCORE_LIMIT, TEAM_LIMIT, ROUND_GAP, PER_IP, MODE, LOG_FILE, PROXY
    a = parse_args()
    SCORE_LIMIT, TEAM_LIMIT, ROUND_GAP, PER_IP, MODE, LOG_FILE, PROXY = a.limit, a.team_limit, a.gap, a.per_ip, a.mode, a.log, a.proxy
    arena["mode"] = MODE
    server = await asyncio.start_server(session, a.host, a.port, limit=16 * 1024)
    log(f"stompy arena on {a.host}:{a.port}/ws ({MODE}, max {MAX_PLAYERS}, first to {limit()}, {PER_IP} per address{f', behind a {PROXY} proxy' if PROXY else ''})")
    asyncio.ensure_future(heartbeat())
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
