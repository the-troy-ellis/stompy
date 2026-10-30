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
  const ore = bite(G, P, [40, y, 40], 3);   // small enough to stay in the band: rock corners are 4 m down
  assert.equal(ore, 0);
  assert.ok(P.dirt >= CONSTRUCT.dirtPerCorner, `dirt ${P.dirt}`);
  for (let i = 0; i < 40; i++) bite(G, P, [40 + i * 8, y, 80]);
  assert.equal(P.dirt, CONSTRUCT.dirtMax, 'the bucket holds so much');
});

test('DUMP tips a mound ahead, and mounds stack', () => {
  const G = digger(), P = G.player, [x, z] = ahead(G), h0 = G.ter.height(x, z);
  P.dirt = CONSTRUCT.dirtMax;
  assert.equal(dump(G, P), true);
  const h1 = G.ter.height(x, z);
  assert.ok(h1 > h0 + CONSTRUCT.dumpH * 0.6, `a pile: ${h0.toFixed(1)} -> ${h1.toFixed(1)}`);
  assert.equal(P.dirt, CONSTRUCT.dirtMax - CONSTRUCT.dumpCost);
  dump(G, P);
  assert.ok(G.ter.height(x, z) > h1 + CONSTRUCT.dumpH * 0.6, 'on top of the last');
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

test('the FUSION button is DUMP for a digger: one mound a press, however long it is held', () => {
  const G = digger(), P = G.player;
  P.dirt = CONSTRUCT.dirtMax;
  stepFor(G, 0.5, input({ held: { fusion: true } }));
  assert.equal(P.dirt, CONSTRUCT.dirtMax - CONSTRUCT.dumpCost, 'one while held');
  update(G, input({}), 1 / 60);
  update(G, input({ held: { fusion: true } }), 1 / 60);
  assert.equal(P.dirt, CONSTRUCT.dirtMax - 2 * CONSTRUCT.dumpCost, 'again on the next press');
});

test('a pile is about one bite\'s hole of ground, and rock bites give dirt too', async () => {
  // On the 4 m ground: the dirt is counted on it, and a fine patch's round
  // bites (docs/specs/27-fine-dig.md) settle back into it.
  const G = digger(), P = G.player, ter = G.ter.coarse;
  const vol = (cx, cz, half, y0, y1) => { let v = 0; for (let x = cx - half; x <= cx + half; x += 1) for (let z = cz - half; z <= cz + half; z += 1) for (let y = y0; y <= y1; y += 1) if (ter.solid(x, y, z)) v++; return v; };
  const h = ter.height(60, 60), b0 = vol(60, 60, 12, h - 16, h + 6);
  bite(G, P, [60, h - CONSTRUCT.bucket * 0.5, 60]);
  const hole = b0 - vol(60, 60, 12, h - 16, h + 6), dirt = P.dirt;
  const [x, z] = ahead(G), hp = ter.height(x, z), p0 = vol(x, z, 12, hp - 4, hp + 12);
  P.dirt = CONSTRUCT.dumpCost;
  dump(G, P);
  const pile = vol(x, z, 12, hp - 4, hp + 12) - p0;
  assert.ok(pile > hole * 0.8 * (CONSTRUCT.dumpCost / dirt) && pile < hole * 2.5 * (CONSTRUCT.dumpCost / dirt), `hole ${hole} m³ for ${dirt} dirt, pile ${pile} m³ for ${CONSTRUCT.dumpCost}`);
  // Deep under the soft band: rock, and it still fills the bucket.
  P.dirt = 0;
  bite(G, P, [100, h - 30, 100]);
  assert.ok(P.dirt > 0, 'rock gives dirt');
});
