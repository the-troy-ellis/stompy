// A digger you leave keeps digging (docs/specs/21-mining.md § Diggers on
// their own): back to where it last dug, bites until the hopper is full,
// walks the ore to the silo, and goes back. Never dug: it stands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { shiftMech } from '../src/sim/walkView.js';
import { MINER } from '../src/sim/miner.js';

const DT = 1 / 60;
// You in a digger with a KESTREL to swap to; the mesa ahead, a silo or not.
const game = (ground = 'mesa', base = 'silo') => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground, crew: 'kestrel', base }), 4, false, 'digger', ground === 'flat' ? { terrainOpts: { flat: true } } : {});
  return G;
};
const frame = (G, over = {}) => update(G, { ...noInput(), ...over }, DT);
const run = (G, s, until = () => false) => { for (let i = 0; i < s / DT && !until(); i++) frame(G); };
// Stand 9 m off the mesa's foot, face it, and take a few bites, as a player would.
function digAtMesa(G) {
  const D = G.player;
  let z = 0;
  while (G.ter.height(0, z) < G.ter.height(0, 0) + 4) z++;
  shiftMech(D, -D.x, z - 9 - D.z);
  D.pitch = 0;
  for (let i = 0; i < 240; i++) frame(G, { held: { ...noInput().held, energy: true } });
  return D;
}

test('a digger that has never dug stands where you leave it', () => {
  const G = game('flat'), D = G.player, x = D.x, z = D.z;
  frame(G, { swap: true });
  run(G, 10);
  assert.ok(D.parked && D.site == null && D.job == null);
  assert.ok(Math.hypot(D.x - x, D.z - z) < 0.5, 'it stayed put');
});

test('a digger you leave at its dig fills up, walks the ore to the silo, and goes back', () => {
  const G = game(), D = digAtMesa(G), site = D.site;
  assert.ok(site, 'its bites marked the spot');
  frame(G, { swap: true });
  assert.ok(D.parked && G.player !== D);
  run(G, 5);
  assert.equal(D.job, 'DIGGING');
  const ore0 = G.base.ore;
  run(G, 400, () => D.job === 'HAULING');
  assert.equal(D.job, 'HAULING', 'full: off to the silo');
  assert.equal(D.ore, CONSTRUCT.hopper);
  run(G, 90, () => D.ore === 0);
  assert.equal(G.base.ore, ore0 + CONSTRUCT.hopper, 'a full hopper into the silo');
  run(G, 1);
  assert.equal(D.job, 'DIGGING', 'and back to the dig');
  const d0 = Math.hypot(D.x - D.site.x, D.z - D.site.z);
  run(G, 20);
  assert.ok(Math.hypot(D.x - D.site.x, D.z - D.site.z) < d0 - 20, 'walking back');
});

test('a full digger with no silo stands; one you drive is yours', () => {
  const G = game('mesa', 'none'), D = digAtMesa(G);
  D.ore = CONSTRUCT.hopper;
  frame(G, { swap: true });
  const x = D.x, z = D.z;
  run(G, 5);
  assert.equal(D.job, null);
  assert.ok(Math.hypot(D.x - x, D.z - z) < 0.5);
  D.ore = 0;
  frame(G, { swap: true });   // back in it
  assert.equal(G.player, D);
  run(G, 5);
  assert.ok(!D.melee && D.throttle === 0, 'no swings, no walking: you drive');
});

test('left with nothing more to dig, it gives the site up, and never digs the floor under it', () => {
  const G = game('flat'), D = G.player, h0 = G.ter.height(D.x, D.z);
  D.pitch = -0.3;   // the floor ahead: a pit
  for (let i = 0; i < 120; i++) frame(G, { held: { ...noInput().held, energy: true } });
  assert.ok(D.site);
  frame(G, { swap: true });
  run(G, 120, () => !D.site);
  assert.equal(D.site, null, 'it stopped');
  assert.equal(D.job, null);
  assert.ok(G.ter.height(D.x, D.z) > h0 - CONSTRUCT.bucket * 2, 'not down a hole of its own');
  assert.ok(MINER.moves > 0);
});
