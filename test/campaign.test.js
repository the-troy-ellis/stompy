import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, freeze, input } from './helpers.js';
import { destroy } from '../src/sim/combat.js';
import { destroyEntity } from '../src/sim/entities.js';
import { MISSIONS, missionDef } from '../src/data/missions.js';
import { NAMES } from '../src/data/names.js';
import { BOUND } from '../src/world/terrain.js';
import { WAVE_WARN } from '../src/sim/waves.js';

const play = (n, diff = 'normal') => {
  const G = createGame({ fx: recordFx(), seed: 1 });
  G.diff = diff;
  const def = missionDef(n);
  startMatch(G, def, def.seed, n === 0, 'kestrel');
  G.kind = 'campaign';
  return G;
};
const hostiles = G => G.mechs.filter(m => m.team !== 0 && m.alive);
const killAll = G => { for (const m of hostiles(G)) destroy(G, m, G.player); };
const said = (G, line) => G.fx.calls('say').some(c => c.args[0] === line);

test('Act I is m01-m04, named only in names.js, each on its own seed, everything on the map', () => {
  assert.deepEqual(MISSIONS.slice(0, 4).map(m => m.key), ['m01', 'm02', 'm03', 'm04']);
  for (let n = 0; n < 4; n++) {
    const def = missionDef(n), G = play(n);
    assert.equal(def.name, NAMES.missions[def.key]);
    assert.ok(Number.isInteger(def.seed));
    assert.equal(def.pal, 'dusk');
    assert.ok(def.intel.length > 0 && def.intel.length < 90, `${def.key}: one short brief`);
    for (const t of [...G.mechs, ...G.entities]) assert.ok(Math.abs(t.x) <= BOUND && Math.abs(t.z) <= BOUND, `${def.key}: ${t.id || t.type} off the map`);
    for (const e of def.entities || []) for (const p of e.path || []) assert.ok(p[1] <= BOUND, `${def.key}: path point off the map`);
    assert.equal(G.state, 'play');
  }
});

test('m01: two JACKALs, one asleep, one that walks in; won when both are down', () => {
  const G = play(0);
  assert.equal(hostiles(G).length, 2);
  stepFor(G, 0.5);
  killAll(G);
  stepFor(G, 0.5);
  assert.equal(G.won, true);
});

test('m02: knocking over the second tower calls in a JACKAL; the third tower wins it, ELIMINATE optional', () => {
  const G = play(1);
  for (const m of hostiles(G)) freeze(m);
  const relays = G.entities.filter(e => e.tags.includes('relay'));
  assert.equal(relays.length, 3);
  assert.ok(relays.every(e => e.mesh === 'relay' && e.targetable));
  destroyEntity(G, relays[0], G.player);
  stepFor(G, WAVE_WARN + 1);
  assert.equal(hostiles(G).length, 2, 'one tower is not enough to bring company');
  destroyEntity(G, relays[1], G.player, { punch: true, yaw: 0 });
  stepFor(G, 0.2);
  assert.ok(said(G, 'Reinforcements inbound.'), 'the wave is called first');
  stepFor(G, WAVE_WARN);
  assert.equal(hostiles(G).length, 3, 'company');
  destroyEntity(G, relays[2], G.player);
  stepFor(G, 0.2);
  assert.equal(G.won, true);
  assert.equal(G.objectives[1].state, 'active', 'the JACKALs were optional');
});

test('m03: four trucks drive about 1.6 km to the exit; two home is a win, three lost is a loss', () => {
  const G = play(2);
  const trucks = G.entities.filter(e => e.kind === 'vehicle');
  assert.equal(trucks.length, 4);
  const exit = G.entities.find(e => e.id === 'exit'), lead = trucks[0];
  const route = Math.hypot(lead.x - lead.path[0][0], lead.z - lead.path[0][1]) + lead.path.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - lead.path[i][0], p[1] - lead.path[i][1]), 0);
  assert.ok(route > 1500 && route < 1750, `${route} m`);
  assert.equal(G.def.prefer, 'convoy');
  // Unmolested (the waves stand still), the convoy gets there.
  stepFor(G, 300, () => { for (const m of hostiles(G)) freeze(m); return input(); }, 1 / 20);
  assert.equal(G.won, true, `trucks home: ${G.objectives[0].home}, ${Math.round(G.objectives[0].dist)} m short`);
  assert.ok(Math.hypot(lead.x - exit.x, lead.z - exit.z) < exit.trigger + 5);

  const L = play(2);
  for (const t of L.entities.filter(e => e.kind === 'vehicle').slice(0, 3)) destroyEntity(L, t, null);
  stepFor(L, 0.5);
  assert.equal(L.won, false);
  assert.equal(L.state, 'over');
});

test('m03: the flanking JACKALs arrive in two waves on the clock', () => {
  const G = play(2);
  assert.equal(hostiles(G).length, 0);
  stepFor(G, 31);
  assert.equal(hostiles(G).length, 2);
  stepFor(G, 75);
  assert.equal(hostiles(G).length, 3);
});

test('m04: the WARDEN and two JACKALs; ELIMINATE wins it', () => {
  const G = play(3);
  assert.deepEqual(hostiles(G).map(m => m.type).sort(), ['jackal', 'jackal', 'warden']);
  killAll(G);
  stepFor(G, 0.5);
  assert.equal(G.won, true);
});

test('ELIMINATE waits for a wave that is still on its way', () => {
  const G = createGame({ fx: recordFx(), seed: 2 });
  startMatch(G, { name: 'W', pal: 'dusk', intel: '', foes: ['jackal'], waves: [{ at: 10, foes: ['jackal'] }] }, 2, false, 'kestrel');
  killAll(G);
  stepFor(G, 1);
  assert.notEqual(G.state, 'over', 'one more is coming');
  stepFor(G, 10);
  assert.equal(hostiles(G).length, 1);
  killAll(G);
  stepFor(G, 0.5);
  assert.equal(G.won, true);
});
