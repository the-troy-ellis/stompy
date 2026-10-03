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
        custom = {"hp": {"la": "mlaser", "ra": "laser", "t1": None, "t2": "lrm"}, "sys": {"sinks": 2, "armour": 0, "jets": 1}}
        self.assertEqual(data.check_loadout("kestrel", custom), (custom, False))
        self.assertEqual(data.check_loadout("kestrel", {"hp": {"la": "ac"}, "sys": stock["sys"]}), (stock, True))   # wrong category
        heavy = {"hp": {"la": "laser", "ra": "laser"}, "sys": {"sinks": 3, "armour": 2, "jets": 2}}
        self.assertEqual(data.check_loadout("jackal", heavy), (data.stock_loadout("jackal"), True))           # over tonnage
        self.assertEqual(data.check_loadout("nope", stock), (None, True))

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
        await c.send({"t": "hello", "name": name, "color": color})
        welcome = await c.recv()
        return c, welcome

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
        good = {"hp": {"la": "mlaser", "ra": "laser", "t1": "ac", "t2": "lrm"}, "sys": {"sinks": 1, "armour": 0, "jets": 1}}
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
        await extra.send({"t": "hello", "name": "LATE"})
        full = await extra.recv()
        self.assertEqual((full["t"], full["max"]), ("full", 8))


if __name__ == "__main__":
    unittest.main()
