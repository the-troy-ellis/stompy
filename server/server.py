#!/usr/bin/env python3
"""Stompy multiplayer relay: one free-for-all arena for up to eight phones.

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
import asyncio
import base64
import hashlib
import ipaddress
import json
import os
import random
import struct
import sys
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
PROTOCOL = 8              # src/net/protocol.js PROTOCOL; a hello with another is told to update (a Node test keeps them equal)
HALF = 96 * 24 / 2        # the map's half width (src/world/terrain.js): positions are clamped to it
FX_RATE = 40              # weapon effects per second per pilot; more are dropped (a beam flash is per shot, guided updates 15 Hz)

OP_CONT, OP_TEXT, OP_BIN, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


def log(*a):
    print(*a, flush=True)


class Client:
    def __init__(self, writer):
        self.writer = writer
        self.id = 0
        self.name = ""
        self.color = 0
        self.kills = 0
        self.deaths = 0
        self.last = time.monotonic()
        self.fx_tokens, self.fx_at = float(FX_RATE), time.monotonic()   # the fx rate limit: a bucket that refills at FX_RATE a second


players: dict[int, Client] = {}
arena = {"seed": random.randrange(1, 10**6), "pal": random.choice(PALETTES), "over": False}


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
    return [{"id": c.id, "name": c.name, "color": c.color, "kills": c.kills, "deaths": c.deaths}
            for c in sorted(players.values(), key=lambda c: c.id)]


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


def clean_state(msg):
    """A state message rebuilt from the fields the game sends, every number
    finite and in range, so nothing malformed reaches the other screens."""
    hp = msg.get("hp")
    hp = [num(v, 0, 200) for v in hp[:5]] if isinstance(hp, list) else []
    out = {"t": "s", "ch": msg.get("ch") if msg.get("ch") in CHASSIS else "kestrel",
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
    arena["over"] = True
    log(f"round over: {winner.name} wins")
    broadcast({"t": "roundover", "winner": winner.id, "name": winner.name, "next": ROUND_GAP, "scores": scores()})
    await asyncio.sleep(ROUND_GAP)
    arena.update(seed=random.randrange(1, 10**6), pal=random.choice(PALETTES), over=False)
    for c in players.values():
        c.kills = c.deaths = 0
    broadcast({"t": "newround", "seed": arena["seed"], "pal": arena["pal"], "scores": scores()})


def handle_message(c, msg):
    t = msg.get("t")
    if t in ("s", "fx"):
        # Movement and weapon effects: stamp the sender and pass them on. A
        # state message is rebuilt clean; effects past the rate are dropped.
        if t == "fx" and not fx_allowed(c):
            return
        out = clean_state(msg) if t == "s" else msg
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
    elif t == "hit":
        target = players.get(int(num(msg.get("to"), 0, 99)))
        if target and target is not c and not arena["over"]:
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
        killer = players.get(int(num(msg.get("by"), 0, 99)))
        if killer is c:
            killer = None
        if killer and not arena["over"]:
            killer.kills += 1
        kill = {"t": "kill", "victim": c.id, "killer": killer.id if killer else 0, "scores": scores()}
        if msg.get("me"):
            kill["me"] = 1   # a punch: the kill feed says so
        broadcast(kill)
        if killer and killer.kills >= SCORE_LIMIT and not arena["over"]:
            asyncio.ensure_future(end_round(killer))


async def session(reader, writer):
    peer = writer.get_extra_info("peername")
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
        c.id = next(i for i in range(1, MAX_PLAYERS + 1) if i not in players)
        c.name = clean_name(hello.get("name"), c.id)
        c.color = int(num(hello.get("color"), 0, 7))
        players[c.id] = c
        log(f"join {c.id} {c.name} from {peer[0] if peer else '?'} ({len(players)} playing)")
        send(c, {"t": "welcome", "id": c.id, "seed": arena["seed"], "pal": arena["pal"],
                 "limit": SCORE_LIMIT, "over": arena["over"], "scores": scores()})
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
                    handle_message(c, msg)
    except (asyncio.IncompleteReadError, ConnectionError, asyncio.TimeoutError, OSError, ValueError):
        pass
    finally:
        if c and players.get(c.id) is c:
            del players[c.id]
            log(f"leave {c.id} {c.name} ({len(players)} playing)")
            broadcast({"t": "leave", "id": c.id, "scores": scores()})
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


async def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
    server = await asyncio.start_server(session, "0.0.0.0", port, limit=16 * 1024)
    log(f"stompy arena on :{port}/ws (max {MAX_PLAYERS}, first to {SCORE_LIMIT})")
    asyncio.ensure_future(heartbeat())
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
