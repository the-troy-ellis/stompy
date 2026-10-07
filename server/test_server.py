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
    async def connect(cls, port, origin="http://localhost:8000"):
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        key = base64.b64encode(os.urandom(16)).decode()
        writer.write((f"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n\r\n").encode())
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
        relay.PER_IP = 99   # every test client is 127.0.0.1; the cap has its own test
        relay.arena.update(seed=5, pal="dusk", over=False)
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
