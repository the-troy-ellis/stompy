// Build and fight, the digger (docs/specs/20-build-and-fight.md § The digger,
// § Ore is rock you dig): no guns, its punch is a bucket that bites the
// ground, rock fills the hopper with ore and soft ground gives none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze, input } from './helpers.js';
import { CHASSIS } from '../src/data/chassis.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { stockLoadout, validate, weaponList } from '../src/sim/loadout.js';
import { bite } from '../src/sim/dig.js';
import { meleePress } from '../src/sim/melee.js';
import { makeGround } from '../src/world/voxels.js';
import { polar } from '../src/sim/placement.js';
import { initFeet } from '../src/sim/gait.js';

const digger = () => { const G = createTestGame({ chassis: 'digger', foes: ['jackal'] }); for (const e of foes(G)) { freeze(e); e.x = 900; e.z = 900; } return G; };

test('the digger carries no guns and no fusion cannon, and its stock fit is fine', () => {
  const lo = stockLoadout('digger');
  assert.deepEqual(weaponList('digger', lo), []);
  assert.ok(validate('digger', lo).ok);
  const G = digger();
  assert.equal(G.player.weapons.length, 0);
  assert.ok(CHASSIS.digger.tool === 'dig' && !CHASSIS.digger.melee && CHASSIS.digger.hopper);
});

test('a bite in rock fills the hopper; a bite in soft ground gives nothing', () => {
  const G = digger(), P = G.player;
  assert.equal(bite(G, P, [0, 0, 0]), 0, 'the top 6 m is soft: no ore');
  assert.equal(P.ore || 0, 0);
  const got = bite(G, P, [40, -10, 0]);
  assert.ok(got > 0 && P.ore === got, `rock under the soft band: ${got} ore`);
  assert.ok(!G.ter.solid(40, -10, 0), 'and it dug');
});

test('the hopper fills up to its size, and a full hopper still digs', () => {
  const G = digger(), P = G.player;
  for (let i = 0; i < 40 && P.ore < CONSTRUCT.hopper; i++) bite(G, P, [i * 10 - 200, -14, 60]);
  assert.equal(P.ore, CONSTRUCT.hopper);
  const h = G.ter.hash();
  assert.equal(bite(G, P, [0, -14, -200]), 0, 'full: nothing more goes in');
  assert.notEqual(G.ter.hash(), h, 'but it still digs');
});

test('two bites give the same ground and the same ore in either order', () => {
  const a = digger(), b = digger();
  bite(a, a.player, [0, -12, 0]); bite(a, a.player, [5, -14, 3]);
  bite(b, b.player, [5, -14, 3]); bite(b, b.player, [0, -12, 0]);
  assert.equal(a.ter.hash(), b.ter.hash());
  assert.equal(a.player.ore, b.player.ore);
});

test('holding DIG bites the face of a mesa in front of it, and fills the hopper', () => {
  const G = digger(), P = G.player, c = polar([0, 300]);
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks: [{ kind: 'mesa', at: [0, 300], r: 66, top: 120, lip: 1 }] } });
  Object.assign(P, { x: c.x, z: c.z - 66 - 11, yaw: 0, twist: 0, pitch: 0.2 }); P.y = G.ter.groundBelow(P.x, 5, P.z); initFeet(G, P);
  const h = G.ter.hash();
  stepFor(G, 1.5, input({ held: { energy: true } }));
  assert.notEqual(G.ter.hash(), h, 'the wall has a bite out of it');
  assert.ok(P.ore > 0, `ore from the mesa's rock: ${P.ore}`);
});

test('a digger has no punch: a press does nothing, to a mech in reach or the ground', () => {
  const G = createTestGame({ chassis: 'digger', foes: ['jackal'] }), P = G.player, e = foes(G)[0];
  freeze(e);
  Object.assign(e, { x: 0, z: 10 }); e.y = 0; initFeet(G, e);
  Object.assign(P, { x: 0, z: 0, yaw: 0, twist: 0 });
  const h = G.ter.hash(), hp = e.hp.T, z = e.z;
  assert.equal(meleePress(G, P), false);
  stepFor(G, 1.5, input({ punch: true }));
  assert.ok(!P.melee && e.z === z && e.hp.T === hp, 'not touched');
  assert.equal(G.ter.hash(), h, 'no bite');
});

test('online a bite is a plain synced dig and gives no ore', () => {
  const G = digger(), P = G.player;
  G.mode = 'mp';
  assert.equal(bite(G, P, [40, -10, 0]), 0);
  assert.equal(G.pendingDigs.length, 1, 'sent to the relay like any dig');
});
