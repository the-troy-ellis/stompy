import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes } from './helpers.js';
import { CHASSIS, HPK } from '../src/data/chassis.js';
import { WEAPONS } from '../src/data/weapons.js';
import { SYSTEMS } from '../src/data/systems.js';
import { stockLoadout, validate, tonsOf, stats, weaponList, applyLoadout, choicesFor } from '../src/sim/loadout.js';
import { newMech } from '../src/sim/state.js';

// What each chassis carried before the mechlab existed, in HUD order.
const BEFORE = {
  kestrel: [['laser', 'LA'], ['laser', 'RA'], ['ac', 'T'], ['lrm', 'T'], ['fusion', 'T']],
  jackal: [['mlaser', 'LA'], ['mlaser', 'RA'], ['fusion', 'T']],
  warden: [['lrm', 'T'], ['ac', 'RA'], ['laser', 'LA'], ['fusion', 'T']],
  puncher: [['ac', 'T'], ['srm', 'T'], ['fusion', 'T']],   // M2: arms carry fists, not guns
  light1: [['srm', 'LA'], ['mlaser', 'RA'], ['mg', 'T'], ['fusion', 'T']],
  sniper1: [['gauss', 'RA'], ['ppc', 'LA'], ['mlaser', 'T'], ['fusion', 'T']],
};

test('the stock loadout is exactly what each chassis always carried, and uses about 85% of its budget', () => {
  for (const k of Object.keys(CHASSIS)) {
    const lo = stockLoadout(k), v = validate(k, lo);
    assert.deepEqual(weaponList(k, lo), BEFORE[k], k);
    assert.ok(v.ok, `${k} stock is over budget`);
    const use = v.tons / CHASSIS[k].tons;
    assert.ok(use > 0.8 && use < 0.9, `${k} stock uses ${(use * 100).toFixed(0)}%`);
    const G = createTestGame({ chassis: k, foes: [] }), P = G.player;
    assert.deepEqual(P.hp, CHASSIS[k].hp, 'stock armour is the chassis armour');
    assert.equal(P.sink, CHASSIS[k].sink);
    assert.equal(P.maxSpeed, CHASSIS[k].speed);
  }
});

test('validate drops unknown hardpoints, resets wrong or unknown weapons to stock, keeps EMPTY, clamps levels, and flags overweight', () => {
  const v = validate('kestrel', { hp: { la: 'mlaser', ra: 'ac', t1: 'nope', t2: null, zz: 'laser' }, sys: { sinks: 9, armour: -1, jets: 1.5 } });
  assert.deepEqual(v.loadout.hp, { la: 'mlaser', ra: 'laser', t1: 'ac', t2: null });
  assert.deepEqual(v.loadout.sys, { sinks: 3, armour: 0, jets: 1, knuckles: 0 });
  assert.equal(v.ok, true);
  assert.deepEqual(validate('jackal', null).loadout, stockLoadout('jackal'), 'junk is stock');
  assert.deepEqual(validate('jackal', 'x').loadout, stockLoadout('jackal'));
  const heavy = validate('jackal', { hp: { la: 'laser', ra: 'laser' }, sys: { sinks: 3, armour: 2, jets: 2 } });
  assert.equal(heavy.ok, false, `${heavy.tons} t on a ${CHASSIS.jackal.tons} t budget`);
  assert.equal(heavy.tons, tonsOf('jackal', heavy.loadout));
});

test('every hardpoint offers every weapon of its category and EMPTY, and nothing else', () => {
  for (const ch of Object.values(CHASSIS)) for (const h of ch.hardpoints) {
    const c = choicesFor(h);
    assert.ok(c.includes(null) && c.includes(h.stock));
    for (const w of c) if (w) assert.notEqual(WEAPONS[w].kind, 'fusion');
  }
});

test('adding a weapon never lowers firepower; more sinks never worsen the heat balance', () => {
  for (const [k, ch] of Object.entries(CHASSIS)) {
    const empty = { hp: Object.fromEntries(ch.hardpoints.map(h => [h.id, null])), sys: { ...ch.systems } };
    let prev = stats(k, empty).firepower;
    const lo = JSON.parse(JSON.stringify(empty));
    for (const h of ch.hardpoints) { lo.hp[h.id] = h.stock; const f = stats(k, lo).firepower; assert.ok(f >= prev, k); prev = f; }
    let hb = -Infinity;
    for (let L = 0; L <= SYSTEMS.sinks.max; L++) { const b = stats(k, { ...lo, sys: { ...lo.sys, sinks: L } }).heatBalance; assert.ok(b > hb); hb = b; }
  }
});

test('ARMOUR +2 raises every section by 20% and lowers speed by 8%', () => {
  const G = createTestGame({ foes: [] });
  const m = newMech(G, 'kestrel', 1, 0, 50, 0, { loadout: { hp: stockLoadout('kestrel').hp, sys: { sinks: 0, armour: 2, jets: 1 } } });
  for (const k of HPK) assert.equal(m.max[k], Math.round(CHASSIS.kestrel.hp[k] * 1.2), k);
  assert.ok(Math.abs(m.maxSpeed - CHASSIS.kestrel.speed * 0.92) < 1e-9);
  assert.equal(CHASSIS.kestrel.hp.T, 72, 'the chassis table is untouched');
});

test('a JACKAL with two more energy weapons and +3 sinks holds a 20 s laser burst that stock cannot', () => {
  const run = sys => {
    const G = createTestGame({ chassis: 'jackal', foes: ['warden'] });
    foes(G)[0].alive = false;
    applyLoadout(G, G.player, { hp: { la: 'mlaser', ra: 'mlaser' }, sys });
    let peak = 0;
    for (let i = 0; i < 20; i++) { stepFor(G, 1, input({ held: { energy: true } })); peak = Math.max(peak, G.player.heat); }
    return { peak, shut: G.player.shutdown };
  };
  const stock = run({ sinks: 0, armour: 0, jets: 1 }), sunk = run({ sinks: 3, armour: 0, jets: 0 });
  assert.ok(sunk.peak < stock.peak, `sinks: peak ${sunk.peak.toFixed(0)} vs stock ${stock.peak.toFixed(0)}`);
  assert.ok(sunk.peak < 100, `+3 sinks still overheated (${sunk.peak.toFixed(0)})`);
  assert.ok(validate('jackal', { hp: { la: 'mlaser', ra: 'mlaser' }, sys: { sinks: 3, armour: 0, jets: 0 } }).ok);
});

test('JUMP JETS 0 never lifts, 2 climbs higher and longer than stock', () => {
  const flight = jets => {
    const G = createTestGame({ foes: [] });
    G.player.jets = jets;
    let top = 0;
    for (let i = 0; i < 180; i++) { stepFor(G, 1 / 60, input({ jets: true })); top = Math.max(top, G.player.y); }
    return top;
  };
  const none = flight(0), stock = flight(1), boosted = flight(2);
  assert.equal(none, 0);
  assert.ok(stock > 5 && boosted > stock * 1.15, `stock ${stock.toFixed(1)} m, boosted ${boosted.toFixed(1)} m`);
});

test('one tap cycles a hardpoint through its category and EMPTY, wrapping, and the systems through their levels', async () => {
  const { cycleWeapon, cycleSystem } = await import('../src/sim/loadout.js');
  let lo = stockLoadout('kestrel');
  const seen = new Set();
  for (let i = 0; i < choicesFor(CHASSIS.kestrel.hardpoints[0]).length; i++) { seen.add(lo.hp.la); lo = cycleWeapon('kestrel', lo, 'la', 1); }
  assert.deepEqual([...seen].sort(), choicesFor(CHASSIS.kestrel.hardpoints[0]).sort());
  assert.equal(lo.hp.la, 'laser', 'a full lap comes back to stock');
  assert.equal(cycleWeapon('kestrel', lo, 'la', -1).hp.la, null, 'backwards from the first is EMPTY');
  assert.equal(cycleWeapon('kestrel', lo, 'nope', 1), lo);
  let s = stockLoadout('kestrel');
  for (let L = 0; L < 4; L++) s = cycleSystem(s, 'sinks', 1);
  assert.equal(s.sys.sinks, 0, 'four taps on a 0-3 slot wrap round');
  assert.equal(cycleSystem(s, 'jets', -1).sys.jets, 0);
  assert.equal(stockLoadout('kestrel').hp.la, 'laser', 'cycling never mutates its input');
});

test('the server\'s copy of the mechlab tables is up to date with the game (npm run fixture:loadout)', async () => {
  const { readFileSync } = await import('node:fs');
  const { loadoutFixture } = await import('../src/sim/loadout.js');
  const onDisk = JSON.parse(readFileSync(new URL('../server/loadout_tables.json', import.meta.url), 'utf8'));
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(loadoutFixture())), 'server/loadout_tables.json is stale: run npm run fixture:loadout');
});
