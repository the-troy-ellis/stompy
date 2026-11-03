// Spread out (docs/specs/32-base-loop.md § Part 3): the rock near the silo
// runs thin, lodes out from it are rich, deterministic by seed, and found by
// going near them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { oreSpread, lodesFor } from '../src/world/seams.js';
import { oreHere } from '../src/sim/dig.js';
import { ORE_SPREAD, ORE_LODES } from '../src/data/construct.js';
import { BX, BZ } from '../src/world/terrain.js';
import { stepFor, freeze } from './helpers.js';

const game = (seed = 5) => {
  const G = createGame({ fx: recordFx(), seed });
  startMatch(G, { name: 'Base', pal: 'dusk', intel: '', foes: [], base: { silo: [0, 0] }, objectives: [] }, seed, false, 'digger', { terrainOpts: { flat: true } });
  return G;
};
const said = G => G.fx.calls('say').map(c => c.args[0]);

test('ore by distance: 60% at the silo, all of it at 150 m, more past it, never below 60%', () => {
  assert.equal(oreSpread(0, ORE_SPREAD), 0.6);
  assert.equal(oreSpread(150, ORE_SPREAD), 1);
  assert.ok(oreSpread(300, ORE_SPREAD) > 1);
  assert.equal(oreSpread(5000, ORE_SPREAD), ORE_SPREAD.far);
  for (let d = 0; d < 600; d += 7) assert.ok(oreSpread(d, ORE_SPREAD) >= 0.6 && oreSpread(d + 7, ORE_SPREAD) >= oreSpread(d, ORE_SPREAD), `at ${d} m`);
});

test('three lodes from the seed: the same for a seed, 200–400 m from the silo, inside the map, apart', () => {
  for (const seed of [1, 5, 42, 977]) {
    const a = lodesFor(seed, 0, 0, BX, BZ, ORE_LODES), b = lodesFor(seed, 0, 0, BX, BZ, ORE_LODES);
    assert.deepEqual(a, b);
    assert.equal(a.length, 3);
    for (const l of a) {
      const d = Math.hypot(l.x, l.z);
      assert.ok(d >= 200 - 1e-6 && d <= 400 + 1e-6, `seed ${seed}: ${d.toFixed(0)} m`);
      assert.ok(Math.abs(l.x) < BX && Math.abs(l.z) < BZ && !l.found);
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) > 100, `seed ${seed}: spread round`);
  }
  assert.notDeepEqual(lodesFor(1, 0, 0, BX, BZ, ORE_LODES), lodesFor(2, 0, 0, BX, BZ, ORE_LODES), 'another map, other lodes');
});

test('a cut near the silo gives less than one out at a lode; no base, no change', () => {
  const G = game(), s = G.base.silo, [l] = G.base.lodes;
  assert.equal(G.base.lodes.length, ORE_LODES.n);
  const near = oreHere(G, s.x + 10, s.z), at = oreHere(G, l.x, l.z);
  assert.ok(near < 0.7 && near >= 0.6, `near: ${near}`);
  assert.equal(at, ORE_LODES.mult);
  assert.ok(oreHere(G, l.x + l.r + 1, l.z) < at, 'just outside it, plain');
  assert.equal(oreHere({ base: null }, 0, 0), 1);
});

test('a lode is found when a crew mech comes within 60 m: said once, and not before', () => {
  const G = game(), P = G.player, [l] = G.base.lodes;
  freeze(P);
  for (const m of G.crew) Object.assign(m, { x: l.x + ORE_LODES.find + 30, z: l.z });
  stepFor(G, 0.2);
  assert.ok(G.base.lodes.every(k => !k.found) && !said(G).includes('Ore found.'));
  Object.assign(P, { x: l.x + ORE_LODES.find - 5, z: l.z });
  stepFor(G, 0.2);
  assert.ok(l.found);
  stepFor(G, 0.5);
  assert.equal(said(G).filter(t => t === 'Ore found.').length, 1);
});
