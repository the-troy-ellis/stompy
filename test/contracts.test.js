import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { destroy } from '../src/sim/combat.js';
import { destroyEntity } from '../src/sim/entities.js';
import { stepFor, freeze, input } from './helpers.js';
import { MISSIONS, missionDef, missionFoes, CONTRACT_OBJECTIVES } from '../src/data/missions.js';
import { CHASSIS } from '../src/data/chassis.js';
import { BOUND } from '../src/world/terrain.js';

const play = n => {
  const G = createGame({ fx: recordFx(), seed: 1 }), def = missionDef(n);
  G.diff = 'normal';
  startMatch(G, def, def.seed, false, 'kestrel');
  G.kind = 'campaign';
  for (const k in G.player.hp) G.player.hp[k] = 1e6;
  return G;
};
const hostiles = G => G.mechs.filter(m => m.team !== 0 && m.alive);
const park = G => () => { for (const m of hostiles(G)) freeze(m); return input(); };
const BIG = ['warden', 'sniper1', 'puncher'];
const CONTRACTS = Array.from({ length: 15 }, (_, i) => MISSIONS.length + i);

test('contracts start after twelve, named by number, and are the same every time', () => {
  assert.equal(missionDef(12).name, 'Contract 13');
  for (const n of CONTRACTS) assert.deepEqual(missionDef(n), missionDef(n), `contract ${n + 1}`);
  assert.notDeepEqual(missionFoes(missionDef(12)), missionFoes(missionDef(17)), 'different contracts, different mechs');
});

test('biome by n % 3, objective by n % 5, weather that suits the biome', () => {
  const SKIES = { dusk: ['rain', 'dust'], ice: ['snow', 'fog'], volcanic: ['dust', 'fog'] };
  const seen = new Set();
  for (const n of CONTRACTS) {
    const d = missionDef(n);
    assert.equal(d.pal, ['dusk', 'ice', 'volcanic'][n % 3]);
    assert.equal(d.objectives[0].type, CONTRACT_OBJECTIVES[n % 5]);
    if (d.weather) assert.ok(SKIES[d.pal].includes(d.weather), `${d.name}: ${d.weather} in ${d.pal}`);
    if (d.time) assert.equal(d.time, 'night');
    seen.add(d.objectives[0].type);
  }
  assert.equal(seen.size, 5, 'all five objective types come round');
});

test('the count grows as it always has; the whole roster turns up, the big ones counted in the brief', () => {
  const kinds = new Set();
  for (const n of CONTRACTS) {
    const all = missionFoes(missionDef(n)), heavies = Math.floor(n / 3);
    assert.equal(all.length, 3 + Math.floor(n / 2));
    assert.equal(all.filter(t => BIG.includes(t)).length, heavies, `contract ${n + 1}`);
    for (const t of all) { assert.ok(CHASSIS[t]); kinds.add(t); }
  }
  for (const t of Object.keys(CHASSIS)) assert.ok(kinds.has(t), `${t} never turns up`);
  const light = CONTRACTS.flatMap(n => missionFoes(missionDef(n)).filter(t => !BIG.includes(t)));
  assert.ok(light.filter(t => t === 'kestrel').length < light.filter(t => t === 'jackal').length + light.filter(t => t === 'light1').length, 'lighter mechs more often');
});

test('every contract loads with everything on the map', () => {
  for (const n of CONTRACTS) {
    const G = play(n);
    assert.equal(G.state, 'play');
    for (const t of [...G.mechs, ...G.entities]) assert.ok(Math.abs(t.x) <= BOUND && Math.abs(t.z) <= BOUND, `contract ${n + 1}: ${t.id || t.type} off the map`);
    for (const e of G.entities) for (const p of e.path || []) assert.ok(Math.abs(p[0]) <= BOUND && Math.abs(p[1]) <= BOUND, `contract ${n + 1}: route off the map`);
  }
});

test('each kind of contract can be won', () => {
  const byType = t => CONTRACTS.find(n => missionDef(n).objectives[0].type === t);
  let G = play(byType('eliminate'));
  for (const m of hostiles(G)) destroy(G, m, G.player);
  stepFor(G, 0.5); assert.equal(G.won, true, 'eliminate');

  G = play(byType('destroy'));
  for (const e of G.entities.filter(x => x.tags.includes('relay'))) destroyEntity(G, e, G.player);
  stepFor(G, 0.5); assert.equal(G.won, true, 'destroy');

  G = play(byType('survive'));
  stepFor(G, 151, park(G), 1 / 20); assert.equal(G.won, true, 'survive');

  G = play(byType('extract'));
  const lz = G.entities.find(e => e.id === 'lz');
  G.player.x = lz.x; G.player.z = lz.z;
  stepFor(G, 0.5, park(G)); assert.equal(G.won, true, 'extract');

  G = play(byType('escort'));
  stepFor(G, 320, park(G), 1 / 20); assert.equal(G.won, true, `escort: ${G.objectives[0].home} home`);
});
