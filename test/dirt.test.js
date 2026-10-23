import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, input, stepFor } from './helpers.js';
import { bite, dump } from '../src/sim/dig.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { VS, Y0, SOFT } from '../src/world/voxels.js';
import { update } from '../src/sim/update.js';

// A digger on flat ground (the soft band is the top SOFT metres).
const digger = () => { const G = createTestGame({ chassis: 'digger', foes: [] }); G.player.dirt = 0; G.player.ore = 0; return G; };
const ahead = (G, d = CONSTRUCT.dumpAt) => { const P = G.player; return [P.x + Math.sin(P.yaw + P.twist) * d * P.ch.scale, P.z + Math.cos(P.yaw + P.twist) * d * P.ch.scale]; };

test('a bite into soft ground fills the bucket with dirt, and no ore', () => {
  const G = digger(), P = G.player, h = G.ter.height(40, 40);
  const y = Y0 + Math.ceil((h - SOFT + 0.5 - Y0) / VS) * VS;   // a corner in the soft band
  assert.ok(y < h && y >= h - SOFT, `corner at ${y}, ground ${h}`);
  const ore = bite(G, P, [40, y, 40]);
  assert.equal(ore, 0);
  assert.ok(P.dirt >= CONSTRUCT.dirtPerCorner, `dirt ${P.dirt}`);
  for (let i = 0; i < 20; i++) bite(G, P, [40 + i * 8, y, 80]);
  assert.equal(P.dirt, CONSTRUCT.dirtMax, 'the bucket holds so much');
});

test('DUMP tips a mound ahead, and mounds stack', () => {
  const G = digger(), P = G.player, [x, z] = ahead(G), h0 = G.ter.height(x, z);
  P.dirt = CONSTRUCT.dirtMax;
  assert.equal(dump(G, P), true);
  const h1 = G.ter.height(x, z);
  assert.ok(h1 > h0 + 2, `a mound: ${h0.toFixed(1)} -> ${h1.toFixed(1)}`);
  assert.equal(P.dirt, CONSTRUCT.dirtMax - CONSTRUCT.dumpCost);
  dump(G, P);
  assert.ok(G.ter.height(x, z) > h1 + 1, 'on top of the last');
  const [nx, nz] = ahead(G, 0);
  assert.ok(Math.abs(G.ter.height(nx, nz) - h0) < 0.5, 'not under the digger');
});

test('with too little dirt DUMP does nothing and says so', () => {
  const G = digger(), P = G.player, [x, z] = ahead(G), h0 = G.ter.height(x, z);
  P.dirt = CONSTRUCT.dumpCost - 1;
  assert.equal(dump(G, P), false);
  assert.equal(G.ter.height(x, z), h0);
  assert.ok(G.msgs.some(m => m.text === 'NO DIRT'));
});

test('the ENERGY button is DUMP for a digger: one mound a press, however long it is held', () => {
  const G = digger(), P = G.player;
  P.dirt = CONSTRUCT.dirtMax;
  stepFor(G, 0.5, input({ held: { energy: true } }));
  assert.equal(P.dirt, CONSTRUCT.dirtMax - CONSTRUCT.dumpCost, 'one while held');
  update(G, input({}), 1 / 60);
  update(G, input({ held: { energy: true } }), 1 / 60);
  assert.equal(P.dirt, CONSTRUCT.dirtMax - 2 * CONSTRUCT.dumpCost, 'again on the next press');
});
