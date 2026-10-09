"""Tests for the arena relay: the pure helpers directly, and a session over a
real socket with a tiny hand-rolled WebSocket client.

    python3 -m unittest discover server
"""
import asyncio
import base64
import json
import os
import struct
import sys
import unittest

os.environ.setdefault("STOMPY_ROUND_GAP", "0")
sys.path.insert(0, os.path.dirname(__file__))
import server as relay  # noqa: E402
import data  # noqa: E402


class Helpers(unittest.TestCase):
    def test_origin(self):
        ok = relay.origin_ok
        self.assertTrue(ok(None))
        self.assertTrue(ok("http://localhost:8000"))
        self.assertTrue(ok("http://192.168.1.20:8000"))
        self.assertTrue(ok("https://stompy.example.net"))
        self.assertFalse(ok("https://evil.example.net"))
        self.assertFalse(ok("http://notstompy.local"))

    def test_clean_name(self):
        self.assertEqual(relay.clean_name("  pilot one ", 3), "PILOT ONE")
        self.assertEqual(relay.clean_name("<script>", 4), "SCRIPT")
        self.assertEqual(relay.clean_name("", 5), "PILOT 5")
        self.assertEqual(len(relay.clean_name("x" * 40, 1)), 12)

    def test_num(self):
        self.assertEqual(relay.num("3.5", 0, 10), 3.5)
        self.assertEqual(relay.num(99, 0, 10), 10)
        self.assertEqual(relay.num("nope", 0, 10, 7), 7)
        self.assertEqual(relay.num(float("nan"), 0, 10, 1), 1)

    def test_loadout_validation_matches_the_game(self):
        # Every case in the fixture was answered by the JS validate(); the Python must agree.
        for case in data.TABLES["cases"]:
            norm, tons, ok = data.validate_loadout(case["ch"], case["input"])
            want = case["want"]
            self.assertEqual(norm, want["loadout"], case)
            self.assertEqual(tons, want["tons"], case)
            self.assertEqual(ok, want["ok"], case)

    def test_check_loadout_passes_clean_and_stocks_the_rest(self):
        stock = data.stock_loadout("kestrel")
        lo, rejected = data.check_loadout("kestrel", stock)
        self.assertEqual((lo, rejected), (stock, False))
        custom = {"hp": {"la": "mlaser", "ra": "laser", "t1": None, "t2": "lrm"}, "sys": {"sinks": 2, "armour": 0, "jets": 1, "knuckles": 0}}
        self.assertEqual(data.check_loadout("kestrel", custom), (custom, False))
        self.assertEqual(data.check_loadout("kestrel", {"hp": {"la": "ac"}, "sys": stock["sys"]}), (stock, True))   # wrong category
        heavy = {"hp": {"la": "laser", "ra": "laser"}, "sys": {"sinks": 3, "armour": 2, "jets": 2}}
        self.assertEqual(data.check_loadout("jackal", heavy), (data.stock_loadout("jackal"), True))           # over tonnage
        self.assertEqual(data.check_loadout("nope", stock), (None, True))

    def test_fx_bucket_refills_at_the_rate(self):
        c = relay.Client(None)
        c.fx_at = 100.0
        self.assertEqual(sum(relay.fx_allowed(c, 100.0) for _ in range(100)), relay.FX_RATE)
        self.assertFalse(relay.fx_allowed(c, 100.0))
        self.assertEqual(sum(relay.fx_allowed(c, 100.5) for _ in range(100)), relay.FX_RATE // 2)   # half a second: half a bucket

    def test_flags_and_the_bare_port(self):
        a = relay.parse_args(["--host", "127.0.0.1", "--port", "9000", "--limit", "20", "--per-ip", "8", "--log", "/tmp/x.log"])
        self.assertEqual((a.host, a.port, a.limit, a.per_ip, a.log, a.mode), ("127.0.0.1", 9000, 20, 8, "/tmp/x.log", "ffa"))
        a = relay.parse_args(["--mode", "tdm", "--team-limit", "30"])
        self.assertEqual((a.mode, a.team_limit), ("tdm", 30))
        self.assertEqual(relay.parse_args(["8123"]).port, 8123, "server.py <port> as before")
        self.assertEqual(relay.parse_args([]).port, 8096)

    def test_log_goes_to_the_file_too(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "relay.log")
            relay.LOG_FILE, relay._log_out = path, None
            try:
                relay.log("join 1 ACE")
            finally:
                relay._log_out.close()
                relay.LOG_FILE, relay._log_out = None, None
            with open(path, encoding="utf-8") as f:
                self.assertRegex(f.read(), r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d join 1 ACE\n$")

    def test_fuzz_state_messages_never_crash_or_pass_junk(self):
        # Acceptance 8: a thousand state messages of NaNs, strings, huge numbers
        # and odd shapes; every one comes out finite and in range, and serialisable.
        import math
        import random as rnd
        r = rnd.Random(8)
        junk = [float("nan"), float("inf"), -float("inf"), 1e308, -1e308, "12", "x", None, True, [], {}, [1, 2], [float("nan")] * 3, 2**70, -0.0]
        pick = lambda: r.choice(junk + [r.uniform(-1e6, 1e6)])
        keys = ["ch", "x", "y", "z", "yaw", "tw", "p", "sp", "air", "al", "sd", "hp", "bm", "be", "bf", "fl", "sc", "sq", "pu", "lt", "zz"]
        for _ in range(1000):
            msg = {"t": "s"}
            for k in r.sample(keys, r.randint(0, len(keys))):
                msg[k] = [pick() for _ in range(r.randint(0, 7))] if k in ("hp", "be", "fl") and r.random() < 0.7 else pick()
            out = relay.clean_state(msg)
            json.dumps(out, allow_nan=False)   # no NaN or Infinity goes out
            self.assertNotIn("zz", out)
            for k, v in out.items():
                for n in (v if isinstance(v, list) else [v]):
                    if isinstance(n, (int, float)) and not isinstance(n, bool):
                        self.assertTrue(math.isfinite(n), (k, v))
            self.assertTrue(abs(out["x"]) <= relay.HALF and abs(out["z"]) <= relay.HALF)
            self.assertEqual(len(out["hp"]), 5)
            self.assertTrue(all(0 <= h <= 200 for h in out["hp"]))
            self.assertIn(out["ch"], data.CHASSIS)

    def test_frame_roundtrip_sizes(self):
        for n in (0, 10, 125, 126, 70000):
            f = relay.frame(relay.OP_TEXT, b"x" * n)
            self.assertEqual(f[0], 0x80 | relay.OP_TEXT)
            self.assertTrue(f.endswith(b"x" * n))


# ---------------------------------------------------------------- a client

class WSClient:
    """Just enough of RFC 6455 to talk to the relay from a test."""

    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer

    @classmethod
    async def connect(cls, port, origin="http://localhost:8000", forwarded=None):
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        key = base64.b64encode(os.urandom(16)).decode()
        fwd = f"X-Forwarded-For: {forwarded}\r\n" if forwarded else ""
        writer.write((f"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n{fwd}\r\n").encode())
        await writer.drain()
        head = await reader.readuntil(b"\r\n\r\n")
        status = head.split(b" ")[1]
        if status != b"101":
            writer.close()
            return None
        return cls(reader, writer)

    async def send(self, obj):
        payload = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(payload)
        head = struct.pack("!BB", 0x81, 0x80 | n) if n < 126 else struct.pack("!BBH", 0x81, 0x80 | 126, n)
        self.writer.write(head + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(payload)))
        await self.writer.drain()

    async def recv(self, timeout=2):
        while True:
            b0, b1 = await asyncio.wait_for(self.reader.readexactly(2), timeout)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack("!H", await self.reader.readexactly(2))[0]
            data = await self.reader.readexactly(n)
            if op == relay.OP_PING:
                continue
            return json.loads(data)

    def close(self):
        self.writer.close()


class Session(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        relay.players.clear()
        relay.conns.clear()
        relay.departed.clear()
        relay.opened.clear()
        relay.DENY = set()
        relay.ADMIN = ""
        relay.MSG_RATE = 60
        relay.PROXY = ""
        for code in [k for k in relay.rooms if k != relay.ARENA]:
            del relay.rooms[code]
        relay.PER_IP = 99   # every test client is 127.0.0.1; the cap has its own test
        relay.arena.update(seed=5, pal="dusk", over=False, mode="ffa", teams=[0, 0], votes={}, round=0)
        relay.sleep = asyncio.sleep
        self.server = await asyncio.start_server(relay.session, "127.0.0.1", 0, limit=16 * 1024)
        self.port = self.server.sockets[0].getsockname()[1]
        self.clients = []

    async def asyncTearDown(self):
        for c in self.clients:
            c.close()
        self.server.close()
        await self.server.wait_closed()
        await asyncio.sleep(0.05)

    async def join(self, name, color=0):
        c = await WSClient.connect(self.port)
        self.clients.append(c)
        await c.send({"t": "hello", "v": relay.PROTOCOL, "name": name, "color": color})
        welcome = await c.recv()
        return c, welcome

    async def test_another_version_is_told_to_update_and_closed(self):
        c = await WSClient.connect(self.port)
        self.clients.append(c)
        await c.send({"t": "hello", "v": relay.PROTOCOL - 1, "name": "OLD", "color": 0})
        self.assertEqual(await c.recv(), {"t": "version", "need": relay.PROTOCOL})
        self.assertEqual(await c.reader.read(), b"")   # and the socket closes: no hang
        self.assertEqual(relay.players, {})

    async def test_state_is_rebuilt_clean(self):
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()  # B joined
        await a.send({"t": "s", "ch": "tank", "x": 1e12, "y": "high", "z": -5, "hp": [10, None, 900], "be": [1, 2],
                      "fl": [1, 2, 3], "pu": 7, "lt": "yes", "evil": "<script>"})
        m = await b.recv()
        self.assertEqual(m["ch"], "kestrel")
        self.assertEqual((m["x"], m["y"], m["z"]), (relay.HALF, 0, -5))
        self.assertEqual(m["hp"], [10, 0, 200, 0, 0])
        self.assertEqual((m["be"], m["fl"], m["pu"], m["lt"]), (0, [1, 2, 3], 2, 1))
        self.assertNotIn("evil", m)

    async def test_weapon_effects_past_the_rate_are_dropped(self):
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()  # B joined
        for i in range(relay.FX_RATE + 20):
            await a.send({"t": "fx", "k": "pu", "n": i})
        got = 0
        try:
            while True:
                m = await b.recv(timeout=0.3)
                got += m["t"] == "fx"
        except asyncio.TimeoutError:
            pass
        self.assertGreaterEqual(got, relay.FX_RATE)
        self.assertLess(got, relay.FX_RATE + 10)

    async def test_lobby_ready_and_ping(self):
        a, wa = await self.join("A")
        self.assertEqual(wa["mode"], "ffa")
        self.assertEqual((wa["scores"][0]["ch"], wa["scores"][0]["ready"]), ("kestrel", 0), "in the lobby until READY")
        b = await WSClient.connect(self.port)
        self.clients.append(b)
        await b.send({"t": "hello", "v": relay.PROTOCOL, "name": "B", "color": 1, "ch": "warden"})
        await b.recv()  # welcome
        joined = await a.recv()
        self.assertEqual(joined["scores"][1]["ch"], "warden")
        await b.send({"t": "ready"})
        ready = await a.recv()
        self.assertEqual((ready["t"], ready["id"]), ("ready", 2))
        self.assertEqual(ready["scores"][1]["ready"], 1)
        self.assertEqual((await b.recv())["t"], "ready", "the pilot readying hears it too")
        await b.send({"t": "ping", "n": 7, "rtt": 42.4})
        pong = await b.recv()
        self.assertEqual((pong["t"], pong["n"]), ("ping", 7))
        self.assertEqual(pong["pings"], {"1": 0, "2": 42})
        await b.send({"t": "ping", "n": "x", "rtt": "NaN"})
        self.assertEqual((await b.recv())["n"], 0, "a junk ping is answered, not trusted")
        await b.send({"t": "hello", "v": relay.PROTOCOL, "name": "X", "ch": "tank"})   # a second hello is ignored
        c = await WSClient.connect(self.port)
        self.clients.append(c)
        await c.send({"t": "hello", "v": relay.PROTOCOL, "name": "C", "ch": ["not", "a", "chassis"]})
        self.assertEqual((await c.recv())["scores"][2]["ch"], "kestrel", "a junk chassis in hello is stock, not a crash")
        await a.recv(); await b.recv()  # C joined
        await a.send({"t": "s", "ch": "jackal"})
        self.assertEqual((await b.recv())["ch"], "jackal")

    async def test_a_fuzzing_pilot_never_takes_the_relay_down(self):
        relay.MSG_RATE = 10000   # junk, not a flood: the flood has its own test
        import random as rnd
        r = rnd.Random(9)
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()  # B joined
        junk = [float("nan"), 1e308, "x", None, True, [], {}, [1, "a", None], {"k": 1}, -5, 2**60]
        for _ in range(300):
            msg = {"t": r.choice(["s", "fx", "hit", "died", "ready", "ping", "zz", 5, None])}
            for k in r.sample(["ch", "x", "hp", "to", "amt", "p", "kb", "by", "lo", "k", "fu", "hh", "n", "rtt"], r.randint(0, 6)):
                msg[k] = r.choice(junk)
            await b.send(msg)
        await b.send({"t": "s", "x": 7})   # and B is still connected and relayed
        while True:
            m = await a.recv()
            if m.get("t") == "s" and m.get("x") == 7:
                break
        self.assertIn(2, relay.players)

    async def test_one_address_gets_at_most_per_ip_sockets(self):
        relay.PER_IP = 2
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        self.assertIsNone(await WSClient.connect(self.port), "a third socket from 127.0.0.1 is refused")
        b.close()
        await asyncio.sleep(0.1)
        c = await WSClient.connect(self.port)
        self.assertIsNotNone(c, "one closed, room for another")
        self.clients.append(c)

    async def test_behind_a_proxy_each_forwarded_address_gets_its_own_cap(self):
        relay.PROXY, relay.PER_IP = "local", 2
        socks = [await WSClient.connect(self.port, forwarded=ip) for ip in ("203.0.113.5", "203.0.113.5", "203.0.113.5", "203.0.113.6")]
        self.clients += [c for c in socks if c]
        self.assertEqual([c is not None for c in socks], [True, True, False, True], "two from .5, the third refused; .6 has its own two")
        self.assertEqual(relay.conns, {"203.0.113.5": 2, "203.0.113.6": 1})
        socks[0].close()
        await asyncio.sleep(0.1)
        self.assertEqual(relay.conns.get("203.0.113.5"), 1, "a closed socket is given back to its address")

    async def test_rooms_per_address_follow_the_forwarded_address(self):
        relay.PROXY = "local"
        for i in range(relay.ROOM_RATE):
            c = await WSClient.connect(self.port, forwarded="198.51.100.1")
            self.clients.append(c)
            await c.send({"t": "hello", "v": relay.PROTOCOL, "name": f"H{i}", "color": 0, "create": {"mission": "m1"}})
            self.assertEqual((await c.recv())["t"], "welcome")
        c = await WSClient.connect(self.port, forwarded="198.51.100.1")
        self.clients.append(c)
        await c.send({"t": "hello", "v": relay.PROTOCOL, "name": "MORE", "color": 0, "create": {"mission": "m1"}})
        self.assertEqual((await c.recv())["t"], "busy")
        c = await WSClient.connect(self.port, forwarded="198.51.100.2")
        self.clients.append(c)
        await c.send({"t": "hello", "v": relay.PROTOCOL, "name": "OTHER", "color": 0, "create": {"mission": "m1"}})
        self.assertEqual((await c.recv())["t"], "welcome", "another address behind the same proxy still may")

    def test_the_forwarded_address_counts_only_from_a_proxy_on_this_machine(self):
        h = {"x-forwarded-for": "6.6.6.6, 203.0.113.9"}
        relay.PROXY = ""
        self.assertEqual(relay.client_ip("127.0.0.1", h), "127.0.0.1", "off: the header is anyone's to write")
        relay.PROXY = "local"
        self.assertEqual(relay.client_ip("127.0.0.1", h), "203.0.113.9", "the last entry, the one the proxy wrote")
        self.assertEqual(relay.client_ip("::1", h), "203.0.113.9")
        self.assertEqual(relay.client_ip("192.0.2.4", h), "192.0.2.4", "a socket from elsewhere is its own address")
        self.assertEqual(relay.client_ip("10.1.2.3", h), "10.1.2.3", "local: not even a private one")
        relay.PROXY = "private"
        self.assertEqual(relay.client_ip("10.1.2.3", h), "203.0.113.9", "private: a container host's proxy")
        self.assertEqual(relay.client_ip("fdaa::3", h), "203.0.113.9")
        self.assertEqual(relay.client_ip("93.184.216.34", h), "93.184.216.34", "a public address is never the proxy")
        self.assertEqual(relay.client_ip("127.0.0.1", {"x-forwarded-for": "junk"}), "127.0.0.1")
        self.assertEqual(relay.client_ip("127.0.0.1", {}), "127.0.0.1")

    async def test_bad_origin_is_refused(self):
        c = await WSClient.connect(self.port, origin="https://evil.example")
        self.assertIsNone(c)

    async def test_welcome_join_leave(self):
        a, wa = await self.join("ALPHA")
        self.assertEqual(wa["t"], "welcome")
        self.assertEqual(wa["id"], 1)
        self.assertEqual(wa["seed"], 5)
        b, wb = await self.join("BRAVO", 2)
        self.assertEqual(wb["id"], 2)
        joined = await a.recv()
        self.assertEqual((joined["t"], joined["id"]), ("join", 2))
        self.assertEqual([p["name"] for p in joined["scores"]], ["ALPHA", "BRAVO"])
        b.close()
        left = await a.recv()
        self.assertEqual((left["t"], left["id"]), ("leave", 2))

    async def test_state_is_stamped_and_relayed_to_others_only(self):
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()  # B joined
        await a.send({"t": "s", "x": 1, "y": 2, "z": 3})
        msg = await b.recv()
        self.assertEqual(msg["t"], "s")
        self.assertEqual(msg["id"], 1)
        self.assertEqual(msg["x"], 1)
        with self.assertRaises(asyncio.TimeoutError):
            await a.recv(timeout=0.3)

    async def test_an_invalid_loadout_is_relayed_as_stock_and_the_sender_told(self):
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()
        good = {"hp": {"la": "mlaser", "ra": "laser", "t1": "ac", "t2": "lrm"}, "sys": {"sinks": 1, "armour": 0, "jets": 1, "knuckles": 0}}
        await a.send({"t": "s", "ch": "kestrel", "x": 0, "lo": good})
        self.assertEqual((await b.recv())["lo"], good)
        await a.send({"t": "s", "ch": "jackal", "x": 0, "lo": {"hp": {"la": "laser", "ra": "laser"}, "sys": {"sinks": 3, "armour": 2, "jets": 2}}})
        self.assertEqual((await b.recv())["lo"], data.stock_loadout("jackal"))
        self.assertEqual(await a.recv(), {"t": "note", "k": "lo"})
        await a.send({"t": "s", "ch": "nope", "x": 0, "lo": good})
        self.assertNotIn("lo", await b.recv())

    async def test_hit_is_clamped_and_fusion_passes(self):
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()
        await a.send({"t": "hit", "to": 2, "amt": 500, "p": [1, 2, 3], "fu": 0})
        hit = await b.recv()
        self.assertEqual((hit["t"], hit["from"], hit["amt"], hit["fu"]), ("hit", 1, 40, 0))
        await a.send({"t": "hit", "to": 2, "amt": 40, "p": [1e9, "x", 3], "fu": 1})
        hit = await b.recv()
        self.assertEqual(hit["fu"], 1)
        self.assertEqual(hit["p"], [1e4, 0, 3])
        await a.send({"t": "hit", "to": 2, "amt": 8, "p": [0, 0, 0], "kb": [99, "x"], "me": 1})
        hit = await b.recv()
        self.assertEqual((hit["kb"], hit["me"]), ([30, 0], 1))
        self.assertNotIn("st", hit)
        await a.send({"t": "hit", "to": 2, "amt": 6, "p": [0, 0, 0], "kb": "nope", "st": 1})
        hit = await b.recv()
        self.assertEqual(hit["st"], 1)
        self.assertNotIn("kb", hit)
        self.assertNotIn("hh", hit)
        await a.send({"t": "hit", "to": 2, "amt": 1, "p": [0, 0, 0], "hh": 999})   # a flamer's heat, clamped
        hit = await b.recv()
        self.assertEqual(hit["hh"], 20)
        await a.send({"t": "hit", "to": 2, "amt": 1, "p": [0, 0, 0], "hh": -5})
        hit = await b.recv()
        self.assertNotIn("hh", hit)
        await a.send({"t": "hit", "to": 1, "amt": 10, "p": [0, 0, 0]})  # never to yourself
        with self.assertRaises(asyncio.TimeoutError):
            await a.recv(timeout=0.3)

    async def test_died_scores_and_the_limit_ends_the_round(self):
        old = relay.SCORE_LIMIT
        relay.SCORE_LIMIT = 2
        try:
            a, _ = await self.join("A")
            b, _ = await self.join("B")
            await a.recv()
            await b.send({"t": "died", "by": 1, "me": 1})
            kill = await a.recv()
            self.assertEqual((kill["t"], kill["victim"], kill["killer"], kill["me"]), ("kill", 2, 1, 1))
            self.assertEqual(kill["scores"][0]["kills"], 1)
            self.assertEqual(kill["scores"][1]["deaths"], 1)
            await b.recv()
            await b.send({"t": "died", "by": 2})  # suicide: a death, no kill
            kill = await a.recv()
            self.assertEqual(kill["killer"], 0)
            self.assertNotIn("me", kill)
            await b.recv()
            await b.send({"t": "died", "by": 1})
            await a.recv()
            over = await a.recv()
            self.assertEqual((over["t"], over["winner"]), ("roundover", 1))
            new = await a.recv()
            self.assertEqual(new["t"], "newround")
            self.assertEqual(new["scores"][0]["kills"], 0)
        finally:
            relay.SCORE_LIMIT = old

    async def test_tdm_teams_are_picked_in_the_lobby_and_wear_their_colours(self):
        relay.arena["mode"] = "tdm"
        a, wa = await self.join("A", color=5)
        self.assertEqual((wa["mode"], wa["limit"], wa["teams"]), ("tdm", relay.TEAM_LIMIT, [0, 0]))
        self.assertEqual((wa["scores"][0]["team"], wa["scores"][0]["color"]), (0, 0), "first in: STEEL, in STEEL's colour")
        b, wb = await self.join("B", color=5)
        self.assertEqual((wb["scores"][1]["team"], wb["scores"][1]["color"]), (1, 1), "the next one evens it up: RED")
        await a.recv()  # B joined
        await b.send({"t": "team", "team": 0})
        moved = await a.recv()
        self.assertEqual((moved["t"], moved["id"], moved["scores"][1]["team"], moved["scores"][1]["color"]), ("team", 2, 0, 0))
        self.assertEqual((await b.recv())["t"], "team", "the pilot moving hears it too")
        await b.send({"t": "team", "team": "junk"})
        self.assertEqual((await a.recv())["scores"][1]["team"], 0, "junk is STEEL, not a crash")
        await b.recv()
        await b.send({"t": "ready"})
        await a.recv(); await b.recv()
        await b.send({"t": "team", "team": 1})   # once in, the side is set
        with self.assertRaises(asyncio.TimeoutError):
            await a.recv(timeout=0.3)
        self.assertEqual(relay.players[2].team, 0)

    async def test_ffa_has_no_teams_to_pick_and_keeps_the_colour(self):
        a, wa = await self.join("A", color=5)
        self.assertEqual((wa["mode"], wa["limit"], wa["scores"][0]["color"]), ("ffa", relay.SCORE_LIMIT, 5))
        await a.send({"t": "team", "team": 1})
        with self.assertRaises(asyncio.TimeoutError):
            await a.recv(timeout=0.3)

    async def test_tdm_drops_friendly_hits(self):
        relay.arena["mode"] = "tdm"
        a, _ = await self.join("A")       # STEEL
        b, _ = await self.join("B")       # RED
        c, _ = await self.join("C")       # STEEL
        await a.recv(); await a.recv(); await b.recv()   # the joins
        await a.send({"t": "hit", "to": 3, "amt": 10, "p": [0, 0, 0]})
        with self.assertRaises(asyncio.TimeoutError):
            await c.recv(timeout=0.3)
        await a.send({"t": "hit", "to": 3, "amt": 40, "p": [0, 0, 0], "fu": 1})   # not even a fusion discharge
        with self.assertRaises(asyncio.TimeoutError):
            await c.recv(timeout=0.3)
        await a.send({"t": "hit", "to": 2, "amt": 10, "p": [0, 0, 0]})
        hit = await b.recv()
        self.assertEqual((hit["t"], hit["from"], hit["amt"]), ("hit", 1, 10), "the other side still takes it")

    async def test_tdm_team_score_is_kills_and_the_team_limit_ends_the_round(self):
        relay.arena["mode"] = "tdm"
        old = relay.TEAM_LIMIT
        relay.TEAM_LIMIT = 2
        try:
            a, _ = await self.join("A")   # STEEL
            b, _ = await self.join("B")   # RED
            c, _ = await self.join("C")   # STEEL
            await a.recv(); await a.recv(); await b.recv()
            await b.send({"t": "died", "by": 1})
            kill = await a.recv()
            self.assertEqual((kill["killer"], kill["teams"]), (1, [1, 0]))
            await c.send({"t": "died", "by": 1})   # a teammate: a death, and nobody scores
            kill = await a.recv()
            self.assertEqual((kill["teams"], kill["scores"][0]["kills"]), ([1, 0], 1))
            await b.send({"t": "died", "by": 3})
            kill = await a.recv()
            self.assertEqual(kill["teams"], [2, 0], "C's kill counts for STEEL too")
            over = await a.recv()
            self.assertEqual((over["t"], over["team"], over["teams"]), ("roundover", 0, [2, 0]))
            new = await a.recv()
            self.assertEqual((new["t"], new["mode"], new["limit"], new["teams"]), ("newround", "tdm", 2, [0, 0]))
            self.assertEqual([p["team"] for p in new["scores"]], [0, 1, 0], "the sides carry over")
        finally:
            relay.TEAM_LIMIT = old

    async def round_over_with_three(self):
        """Three pilots and a round won by A's first kill, the gap held open
        by a fake clock until the test lets it pass. Returns the clients
        (their join messages read) and the clock's release."""
        gate = asyncio.Event()

        async def fake_sleep(_):
            await gate.wait()
        relay.sleep = fake_sleep
        old = relay.SCORE_LIMIT
        relay.SCORE_LIMIT = 1
        self.addCleanup(setattr, relay, "SCORE_LIMIT", old)
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        c, _ = await self.join("C")
        await a.recv(); await a.recv(); await b.recv()   # the joins
        await b.send({"t": "died", "by": 1})
        for x in (a, b, c):
            self.assertEqual((await x.recv())["t"], "kill")
            self.assertEqual((await x.recv())["t"], "roundover")
        return a, b, c, gate

    async def until(self, client, t):
        while True:
            m = await client.recv()
            if m["t"] == t:
                return m

    async def test_vote_two_pick_same_map_and_the_next_round_has_the_same_seed(self):
        a, b, c, gate = await self.round_over_with_three()
        await a.send({"t": "vote", "map": "same", "mode": "ffa"})
        tally = await a.recv()
        self.assertEqual((tally["t"], tally["votes"]), ("tally", [0, 1, 0]))
        await b.send({"t": "vote", "map": "same", "mode": "ffa"})
        await c.send({"t": "vote", "map": "next", "mode": "ffa"})
        await c.send({"t": "stats", "acc": 250})   # clamped
        tally = await self.until(c, "tally")
        while tally["votes"] != [1, 2, 0] or tally["scores"][2]["acc"] != 100:
            tally = await self.until(c, "tally")
        gate.set()
        new = await self.until(a, "newround")
        self.assertEqual((new["seed"], new["pal"], new["vote"], new["mode"]), (5, "dusk", "same", "ffa"))
        self.assertEqual([(p["kills"], p["best"], p["acc"]) for p in new["scores"]], [(0, 0, -1)] * 3, "a fresh round")

    async def test_vote_a_tie_goes_to_the_next_map_and_a_late_vote_is_ignored(self):
        a, b, c, gate = await self.round_over_with_three()
        await a.send({"t": "vote", "map": "next", "mode": "ffa"})
        await b.send({"t": "vote", "map": "same", "mode": "ffa"})
        await self.until(c, "tally"); await self.until(c, "tally")
        gate.set()
        new = await self.until(a, "newround")
        self.assertEqual(new["vote"], "next")
        self.assertNotEqual((new["seed"], new["pal"]), (5, "dusk"), "a new map")
        await a.send({"t": "vote", "map": "same", "mode": "ffa"})   # the round is on: no vote to cast
        with self.assertRaises(asyncio.TimeoutError):
            await a.recv(timeout=0.3)
        self.assertEqual(relay.arena["votes"], {})

    async def test_vote_the_other_mode_switches_to_teams_and_paints_the_sides(self):
        a, b, c, gate = await self.round_over_with_three()
        for x in (a, b):
            await x.send({"t": "vote", "map": "next", "mode": "tdm"})
        await a.send({"t": "vote", "map": "same", "mode": "tdm"})   # a vote can change; the other mode still wins
        await self.until(c, "tally"); await self.until(c, "tally"); await self.until(c, "tally")
        gate.set()
        new = await self.until(a, "newround")
        self.assertEqual((new["vote"], new["mode"], new["limit"]), ("mode", "tdm", relay.TEAM_LIMIT))
        self.assertEqual([p["color"] for p in new["scores"]], [relay.TEAM_COLORS[p["team"]] for p in new["scores"]])

    async def test_best_streak_counts_kills_between_deaths(self):
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()
        for _ in range(3):
            await b.send({"t": "died", "by": 1})
            await a.recv()
        await a.send({"t": "died", "by": 2})
        await a.recv()
        await b.send({"t": "died", "by": 1})
        kill = await a.recv()
        self.assertEqual([(p["kills"], p["best"]) for p in kill["scores"]], [(4, 3), (1, 1)])

    async def rejoin(self, name, token):
        c = await WSClient.connect(self.port)
        self.clients.append(c)
        await c.send({"t": "hello", "v": relay.PROTOCOL, "name": name, "color": 0, "token": token})
        return c, await c.recv()

    async def drop(self, client, other):
        """Kill a pilot's socket; `other` hears them leave."""
        client.close()
        self.assertEqual((await other.recv())["t"], "leave")

    async def test_a_dropped_pilot_comes_back_with_the_token_to_the_same_id_and_score(self):
        a, wa = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()
        await a.send({"t": "ready"})
        await a.recv(); await b.recv()
        await b.send({"t": "died", "by": 1})
        await a.recv(); await b.recv()
        token = wa["token"]
        self.assertEqual(len(token), 16)
        await self.drop(a, b)
        c, _ = await self.join("C")   # someone else joins meanwhile: not on A's id
        self.assertEqual((await b.recv())["id"], 3)
        a2, back = await self.rejoin("A", token)
        self.assertEqual((back["id"], back["resumed"]), (1, 1))
        me = back["scores"][0]
        self.assertEqual((me["id"], me["kills"], me["ready"]), (1, 1, 1), "the kill and the READY kept")
        self.assertNotEqual(back["token"], token, "a new token for the next drop")
        joined = await b.recv()
        self.assertEqual((joined["t"], joined["id"]), ("join", 1))
        _, again = await self.rejoin("A2", token)   # a token is good once
        self.assertEqual(again["resumed"], 0)

    async def test_a_token_past_its_time_or_unknown_is_a_new_pilot(self):
        a, wa = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()
        await b.send({"t": "died", "by": 1})
        await a.recv(); await b.recv()
        await self.drop(a, b)
        relay.departed[wa["token"]]["until"] = 0   # 30 s on
        _, back = await self.rejoin("A", wa["token"])
        self.assertEqual((back["resumed"], back["scores"][0]["kills"], back["scores"][0]["ready"]), (0, 0, 0))
        _, junk = await self.rejoin("X", ["not", "a", "token"])
        self.assertEqual(junk["resumed"], 0)

    async def test_a_drop_across_rounds_keeps_the_id_and_side_but_not_the_old_score(self):
        relay.arena["mode"] = "tdm"
        a, _ = await self.join("A")
        b, wb = await self.join("B")   # RED
        await a.recv()
        await a.send({"t": "died", "by": 2})
        await a.recv(); await b.recv()
        await self.drop(b, a)
        relay.arena["round"] += 1   # a new round began while B was away
        _, back = await self.rejoin("B", wb["token"])
        me = back["scores"][1]
        self.assertEqual((me["id"], me["team"], me["color"], me["kills"]), (2, 1, 1, 0))

    async def hello(self, name, **extra):
        c = await WSClient.connect(self.port)
        self.clients.append(c)
        await c.send({"t": "hello", "v": relay.PROTOCOL, "name": name, "color": 0, **extra})
        return c, await c.recv()

    async def coop(self, n=2):
        """A co-op room with n pilots: the host (created it) and guests (joined by code)."""
        host, w = await self.hello("H", create={"mission": 2, "diff": "hard", "seed": 77, "junk": "x"})
        code, out = w["room"], [host]
        for i in range(1, n):
            g, _ = await self.hello(f"G{i}", room=code.lower())
            out.append(g)
            for earlier in out[:-1]:
                self.assertEqual((await earlier.recv())["t"], "join")
        return code, w, out

    async def test_a_coop_room_gets_a_code_a_host_and_its_mission(self):
        code, w, (host, guest) = await self.coop(2)
        self.assertEqual(len(code), 4)
        self.assertTrue(all(ch in relay.CODE_LETTERS for ch in code), "no vowels, so no words")
        self.assertEqual((w["kind"], w["host"], w["id"], w["started"]), ("coop", 1, 1, 0))
        self.assertEqual(w["def"], {"kind": "coop", "mission": 2, "diff": "hard", "seed": 77}, "the mission kept, cleaned")
        self.assertNotIn("seed", w, "no arena round in a co-op room")
        self.assertIn(code, relay.rooms)
        a, wa = await self.join("ARENA PILOT")   # the arena is its own room
        self.assertEqual((wa["room"], wa["kind"], wa["id"], len(wa["scores"])), ("ARENA", "arena", 1, 1))
        await guest.send({"t": "ready"})
        r = await host.recv()
        self.assertEqual((r["t"], r["started"]), ("ready", 0), "a guest's READY doesn't start it")
        await guest.recv()
        await host.send({"t": "ready"})
        self.assertEqual((await guest.recv())["started"], 1, "the host's does")
        with self.assertRaises(asyncio.TimeoutError):
            await a.recv(timeout=0.3)   # nothing from the co-op room reaches the arena

    async def test_an_unknown_code_is_told_so(self):
        c, m = await self.hello("X", room="QQQQ")
        self.assertEqual(m, {"t": "noroom"})

    def test_room_codes_are_unique(self):
        letters = iter("BBBB" "BBBB" "CCCC")
        relay.rooms["BBBB"] = relay.Room("BBBB", "coop")
        try:
            self.assertEqual(relay.new_code(lambda _: next(letters)), "CCCC")
        finally:
            del relay.rooms["BBBB"]

    async def test_coop_routing_host_world_out_guest_hits_in(self):
        code, _, (host, g1, g2) = await self.coop(3)
        await host.send({"t": "es", "eid": 4, "x": 1})
        for g in (g1, g2):
            self.assertEqual(await g.recv(), {"t": "es", "eid": 4, "x": 1})
        await g1.send({"t": "obj", "list": []})   # only the host's world counts
        await g1.send({"t": "ehit", "eid": 4, "amt": 99, "p": [1, 2, 3], "fu": 1, "kb": [50, 0]})
        eh = await host.recv()
        self.assertEqual((eh["t"], eh["from"], eh["eid"], eh["amt"], eh["fu"], eh["kb"]), ("ehit", 2, 4, 40, 1, [30, 0]))
        await g1.send({"t": "ehit", "ent": "relay2", "amt": 7, "me": 1, "yaw": 1.5, "p": [0, 0, 0]})
        eh = await host.recv()
        self.assertEqual((eh["ent"], eh["amt"], eh["yaw"], eh["me"]), ("relay2", 7, 1.5, 1), "a mission entity, by its id")
        self.assertNotIn("eid", eh)
        await g1.send({"t": "ehit", "ent": "<bad id>", "eid": 3, "amt": 1})
        self.assertEqual((await host.recv())["eid"], 3, "a junk id is no entity")
        await g1.send({"t": "hit", "to": 3, "amt": 10, "p": [0, 0, 0]})   # pilots never hit each other
        await host.send({"t": "ehit", "eid": 4, "amt": 5})                 # the host applies its own
        with self.assertRaises(asyncio.TimeoutError):
            await g2.recv(timeout=0.3)
        with self.assertRaises(asyncio.TimeoutError):
            await host.recv(timeout=0.3)
        await host.send({"t": "hit", "to": 3, "amt": 12, "p": [0, 0, 0], "eid": 4})   # enemy fire
        h = await g2.recv()
        self.assertEqual((h["t"], h["from"], h["eid"], h["amt"]), ("hit", 0, 4, 12))

    async def private(self, mode="ffa", n=2):
        """A private arena with n pilots: the first opened it, the rest joined by its code."""
        first, w = await self.hello("P1", create={"kind": "arena", "mode": mode})
        out, ws = [first], [w]
        for i in range(1, n):
            c, wc = await self.hello(f"P{i + 1}", room=w["room"].lower())
            out.append(c)
            ws.append(wc)
        for k, c in enumerate(out[:-1]):   # each one's join messages from the later ones
            for _ in range(n - 1 - k):
                self.assertEqual((await c.recv())["t"], "join")
        return out, ws

    async def test_two_meet_in_a_private_arena_and_the_public_one_sees_neither(self):
        (a, b), (wa, wb) = await self.private()
        pub, wp = await self.join("PUB")
        self.assertEqual((wa["kind"], wa["mode"], len(wa["room"])), ("arena", "ffa", 4))
        self.assertEqual((wb["room"], [p["name"] for p in wb["scores"]]), (wa["room"], ["P1", "P2"]))
        self.assertEqual((wp["room"], [p["name"] for p in wp["scores"]]), (relay.ARENA, ["PUB"]), "the public arena lists only its own")
        await a.send({"t": "s", "x": 3, "z": 4})
        m = await b.recv()
        self.assertEqual((m["t"], m["id"], m["x"]), ("s", wa["id"], 3))
        await pub.send({"t": "s", "x": 9, "z": 9})
        await b.send({"t": "died", "by": wa["id"]})
        self.assertEqual([p["kills"] for p in (await a.recv())["scores"]], [1, 0], "the kill is the private room's")
        with self.assertRaises(asyncio.TimeoutError):
            await pub.recv(timeout=0.3)   # nothing from the private room reaches the public one
        self.assertEqual((relay.players[1].name, relay.players[1].kills), ("PUB", 0))
        with self.assertRaises(asyncio.TimeoutError):
            await a.recv(timeout=0.3)   # nor the other way

    async def test_a_private_team_deathmatch_has_its_own_sides_and_round(self):
        gate = asyncio.Event()

        async def fake_sleep(_):
            await gate.wait()
        relay.sleep = fake_sleep
        old = relay.TEAM_LIMIT
        relay.TEAM_LIMIT = 1
        self.addCleanup(setattr, relay, "TEAM_LIMIT", old)
        (a, b), (wa, wb) = await self.private("tdm")
        self.assertEqual((wa["mode"], wa["limit"], wa["teams"]), ("tdm", 1, [0, 0]))
        self.assertEqual([p["team"] for p in wb["scores"]], [0, 1], "sides fill within the room")
        pub, wp = await self.join("PUB")
        self.assertEqual((wp["mode"], wp["scores"][0]["team"]), ("ffa", 0), "the public arena keeps its own mode")
        await b.send({"t": "died", "by": wa["id"]})
        for x in (a, b):
            self.assertEqual((await x.recv())["t"], "kill")
            over = await x.recv()
            self.assertEqual((over["t"], over["team"]), ("roundover", 0))
        self.assertFalse(relay.arena["over"], "only the private room's round is over")
        await a.send({"t": "vote", "map": "next", "mode": "ffa"})
        self.assertEqual((await a.recv())["votes"], [0, 0, 1])
        gate.set()
        nr = await self.until(b, "newround")
        self.assertEqual((nr["mode"], [p["kills"] for p in nr["scores"]]), ("ffa", [0, 0]), "its vote picked its next round")
        self.assertEqual(relay.arena["mode"], "ffa")
        with self.assertRaises(asyncio.TimeoutError):
            await pub.recv(timeout=0.3)

    async def test_an_empty_private_arena_waits_then_is_gone(self):
        (a, b), (wa, _) = await self.private()
        code = wa["room"]
        a.close(); b.close()
        await asyncio.sleep(0.1)
        self.assertIn(code, relay.rooms)
        relay.collect_rooms(relay.time.monotonic() + relay.ROOM_IDLE + 1)
        self.assertNotIn(code, relay.rooms)
        self.assertIn(relay.ARENA, relay.rooms, "the public arena never goes")

    async def test_a_private_arena_counts_against_the_room_limit_and_odd_modes_are_ffa(self):
        for i in range(relay.ROOM_RATE):
            _, w = await self.hello(f"H{i}", create={"kind": "arena", "mode": "chess" if i == 0 else "tdm"})
            self.assertEqual(w["mode"], "ffa" if i == 0 else "tdm")
        _, w = await self.hello("MORE", create={"kind": "arena"})
        self.assertEqual(w["t"], "busy")

    async def test_a_dropped_pilot_comes_back_to_the_private_arena_with_the_score(self):
        (a, b), (wa, wb) = await self.private()
        await b.send({"t": "died", "by": wa["id"]})
        await a.recv(); await b.recv()
        b.close()
        await self.until(a, "leave")
        c, back = await self.hello("P2", room=wa["room"], token=wb["token"])
        self.assertEqual((back["room"], back["resumed"], back["id"]), (wa["room"], 1, wb["id"]))
        self.assertEqual([p["deaths"] for p in back["scores"]], [0, 1])

    async def test_the_host_leaving_hands_over_and_an_empty_room_is_gone(self):
        code, _, (host, g1, g2) = await self.coop(3)
        host.close()
        for g in (g1, g2):
            self.assertEqual((await g.recv())["t"], "leave")
            m = await g.recv()
            self.assertEqual((m["t"], m["id"]), ("host", 2))
        await g1.send({"t": "es", "eid": 1})   # the new host's world goes out
        self.assertEqual((await g2.recv())["t"], "es")
        g1.close()
        self.assertEqual((await g2.recv())["t"], "leave")
        g2.close()
        await asyncio.sleep(0.15)
        self.assertIn(code, relay.rooms, "empty, it waits a while for someone to come back")
        relay.collect_rooms(relay.time.monotonic() + relay.ROOM_IDLE - 5)
        self.assertIn(code, relay.rooms)
        relay.collect_rooms(relay.time.monotonic() + relay.ROOM_IDLE + 1)
        self.assertNotIn(code, relay.rooms, "then it is gone")
        self.assertIn(relay.ARENA, relay.rooms, "the arena never is")
        _, m = await self.hello("LATE", room=code)
        self.assertEqual(m["t"], "noroom")

    async def test_a_coop_room_holds_four_and_keeps_the_end_for_late_joiners(self):
        code, _, pilots = await self.coop(4)
        _, m = await self.hello("FIFTH", room=code)
        self.assertEqual(m, {"t": "full", "max": 4})
        pilots[3].close()
        for p in pilots[:3]:
            await p.recv()   # leave
        await pilots[0].send({"t": "over", "won": 1})
        await pilots[1].recv()
        late, w = await self.hello("LATE", room=code)
        self.assertEqual(w["t"], "welcome")
        self.assertEqual(await late.recv(), {"t": "over", "won": 1})

    async def test_health_answers_with_rooms_pilots_and_uptime(self):
        await self.join("A")
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        writer.write(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
        raw = await reader.read()
        writer.close()
        head, body = raw.split(b"\r\n\r\n", 1)
        self.assertTrue(head.startswith(b"HTTP/1.1 200"))
        h = json.loads(body)
        self.assertEqual((h["rooms"], h["players"]), (1, 1))
        self.assertGreaterEqual(h["uptime"], 0)

    async def test_a_flood_drops_the_offender_and_the_others_play_on(self):
        relay.MSG_RATE = 20
        a, _ = await self.join("A")
        b, _ = await self.join("B")
        await a.recv()
        for i in range(200):   # far past 20 a second
            try:
                await b.send({"t": "ping", "n": i, "rtt": 1})
            except (ConnectionError, OSError):
                break
        left = await a.recv()
        while left["t"] != "leave":
            left = await a.recv()
        self.assertEqual(left["id"], 2, "the flooder is dropped")
        c, _ = await self.join("C")
        await c.send({"t": "s", "x": 3})
        while (await a.recv())["t"] != "s":
            pass   # and A still hears the others

    async def test_one_address_opens_at_most_three_rooms_in_ten_minutes(self):
        for i in range(3):
            _, w = await self.hello(f"H{i}", create={"mission": 1})
            self.assertEqual(w["t"], "welcome")
        _, m = await self.hello("H3", create={"mission": 1})
        self.assertEqual(m, {"t": "busy"})
        self.assertTrue(relay.may_open_room("127.0.0.1", relay.time.monotonic() + relay.ROOM_WINDOW + 1), "later it may again")

    def test_origins_the_owner_names_are_allowed_too(self):
        old = relay.ORIGINS
        relay.ORIGINS = {"me.github.io"}
        try:
            self.assertTrue(relay.origin_ok("https://me.github.io"))
            self.assertFalse(relay.origin_ok("https://you.github.io"))
            self.assertTrue(relay.origin_ok("http://192.168.1.4:8000"), "the LAN rule stays")
        finally:
            relay.ORIGINS = old

    def test_a_callsign_with_a_denied_word_becomes_a_plain_one(self):
        relay.DENY = {"bad"}
        self.assertEqual(relay.clean_name("b.a.d guy", 3), "PILOT 3")
        self.assertEqual(relay.clean_name("good", 3), "GOOD")
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write("# comment\nWorse  # trailing\n\n")
        self.assertEqual(relay.load_deny(f.name), {"worse"})
        os.unlink(f.name)
        self.assertEqual(relay.load_deny(relay.DENY_FILE), set(), "it ships empty: the owner fills it in")

    async def test_the_admin_token_may_kick_and_nobody_else(self):
        relay.ADMIN = "letmein"
        boss, _ = await self.hello("BOSS", admin="letmein")
        pest, _ = await self.join("PEST")
        other, _ = await self.join("OTHER")
        await boss.recv(); await boss.recv(); await pest.recv()
        await pest.send({"t": "kick", "id": 3})   # not an admin: nothing
        with self.assertRaises(asyncio.TimeoutError):
            await other.recv(timeout=0.3)
        await boss.send({"t": "kick", "id": 2})
        left = await other.recv()
        self.assertEqual((left["t"], left["id"]), ("leave", 2))
        _, w = await self.hello("FAKE", admin="nope")
        self.assertFalse(relay.players[w["id"]].admin)

    async def test_ninth_pilot_is_turned_away(self):
        for i in range(8):
            await self.join(f"P{i}")
        extra = await WSClient.connect(self.port)
        self.clients.append(extra)
        await extra.send({"t": "hello", "v": relay.PROTOCOL, "name": "LATE"})
        full = await extra.recv()
        self.assertEqual((full["t"], full["max"]), ("full", 8))


if __name__ == "__main__":
    unittest.main()
