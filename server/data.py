"""The mechlab tables and loadout validation for the arena relay.

The tables are loaded from loadout_tables.json, which scripts/loadout-fixture.mjs
writes from the game's own data (src/data/*.js), so the server never keeps a
hand-made copy that could drift. validate_loadout mirrors validate() in
src/sim/loadout.js; test_server.py replays the fixture's cases against it, and
test/loadout.test.js fails if the JSON falls behind the JS.
"""
import json
import math
import os

with open(os.path.join(os.path.dirname(__file__), "loadout_tables.json"), encoding="utf-8") as f:
    TABLES = json.load(f)
CHASSIS, WEAPONS, SYSTEMS = TABLES["chassis"], TABLES["weapons"], TABLES["systems"]


def _level(v, top, default):
    # JSON numbers only, whole ones; true/false are not levels.
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not float(v).is_integer():
        return default
    return max(0, min(top, int(v)))


def stock_loadout(chassis):
    ch = CHASSIS[chassis]
    return {"hp": {h["id"]: h["stock"] for h in ch["hardpoints"]}, "sys": {k: ch["systems"].get(k, 0) for k in SYSTEMS}}


def tons_of(chassis, loadout):
    ch = CHASSIS[chassis]
    t = ch["frame"]
    for h in ch["hardpoints"]:
        w = loadout["hp"].get(h["id"])
        if w:
            t += WEAPONS[w]["tons"]
    for k, s in SYSTEMS.items():
        t += (loadout["sys"].get(k) or 0) * s["tons"]
    return math.floor(t * 10 + 0.5) / 10


def validate_loadout(chassis, loadout):
    """-> (normalised loadout, tons, ok). Same rules as the JS validate()."""
    ch = CHASSIS[chassis]
    src = loadout if isinstance(loadout, dict) else {}
    in_hp = src.get("hp") if isinstance(src.get("hp"), dict) else {}
    in_sys = src.get("sys") if isinstance(src.get("sys"), dict) else {}
    hp = {}
    for h in ch["hardpoints"]:
        if h["id"] in in_hp and in_hp[h["id"]] is None:
            hp[h["id"]] = None
            continue
        w = in_hp.get(h["id"])
        hp[h["id"]] = w if isinstance(w, str) and w in WEAPONS and WEAPONS[w]["cat"] == h["cat"] else h["stock"]
    top = ch.get("max", {})   # a chassis may cap a system lower (PURPLE PUNCHER: jets 1)
    sys_ = {k: _level(in_sys.get(k), top.get(k, s["max"]), ch["systems"].get(k, 0)) for k, s in SYSTEMS.items()}
    out = {"hp": hp, "sys": sys_}
    tons = tons_of(chassis, out)
    return out, tons, tons <= ch["tons"]


def check_loadout(chassis, loadout):
    """What the relay passes on: the loadout as sent if it is clean and in
    budget, otherwise stock. Returns (loadout, rejected)."""
    if chassis not in CHASSIS:
        return None, True
    norm, _, ok = validate_loadout(chassis, loadout)
    sent = {"hp": loadout.get("hp"), "sys": loadout.get("sys")} if isinstance(loadout, dict) else None
    if ok and norm == sent:
        return norm, False
    return stock_loadout(chassis), True
