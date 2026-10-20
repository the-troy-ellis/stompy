// The DEBUG tab's cheats (docs/specs/19-debug-menu.md § Cheats): each does
// what it says in single player, and nothing in the arena or co-op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { cheat } from '../src/sim/cheats.js';
import { damage, fire, invincible } from '../src/sim/combat.js';
import { dig, digOf } from '../src/sim/dig.js';
import { makeGround } from '../src/world/voxels.js';
import { polar } from '../src/sim/placement.js';
import { CHEATS, BIG_DIG } from '../src/data/debug.js';

const ALL = Object.fromEntries(CHEATS.map(([k]) => [k, true]));

test('every cheat holds in single player and in neither the arena nor co-op', () => {
  const G = createTestGame();
  G.cheats = { ...ALL };
  for (const [k] of CHEATS) assert.equal(cheat(G, k), true, `${k} in single player`);
  for (const mode of ['mp', 'coop']) { G.mode = mode; for (const [k] of CHEATS) assert.equal(cheat(G, k), false, `${k} off in ${mode}`); }
  G.mode = 'sp'; G.cheats = {};
  for (const [k] of CHEATS) assert.equal(cheat(G, k), false, `${k} off when off`);
});

test('INVINCIBLE: your mech takes hits and no damage', () => {
  const G = createTestGame(), P = G.player;
  G.cheats = { god: true };
  assert.ok(invincible(G, P));
  const hp = P.hp.CT;
  damage(G, P, 'CT', 30, foes(G)[0]);
  assert.equal(P.hp.CT, hp);
});

test('NO HEAT: firing all day, you stay cold; ENDLESS AMMO: the count never drops', () => {
  const G = createTestGame(), P = G.player, ac = P.weapons.find(w => w.type === 'ac');
  G.cheats = { heat: true, ammo: true };
  const ammo = ac.ammo;
  for (let i = 0; i < 20; i++) { ac.cd = 0; fire(G, P, ac, [0, 2, 100]); stepFor(G, 0.05); }
  assert.equal(ac.ammo, ammo, 'ENDLESS AMMO');
  assert.equal(P.heat, 0, 'NO HEAT');
  assert.ok(!P.shutdown);
  G.cheats = {};
  ac.cd = 0; fire(G, P, ac, [0, 2, 100]);
  assert.equal(ac.ammo, ammo - 1, 'off: it counts again');
  G.cheats = { heat: true, ammo: true }; G.mode = 'mp';
  ac.cd = 0; fire(G, P, ac, [0, 2, 100]);
  assert.equal(ac.ammo, ammo - 2, 'in the arena: it counts');
});

test('BIG DIGS: a dig takes out more, through the rock band', () => {
  const plain = createTestGame(), big = createTestGame();
  big.cheats = { digs: true };
  dig(plain, [0, -8, 0], 3.5); dig(big, [0, -8, 0], 3.5);
  assert.ok(plain.ter.solid(0, -13, 0) && !big.ter.solid(0, -13, 0), `twice the radius (${BIG_DIG.scale}x), and rock digs like soft ground`);
  assert.notEqual(plain.ter.hash(), big.ter.hash());
});

test('BIG DIGS: a few BIG BONKER hits cut an arch\'s leg, and the crown falls', () => {
  const G = createTestGame();
  for (const e of foes(G)) { e.x = 900; e.z = 900; }
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks: [{ kind: 'arch', at: [0, 300] }] } });
  G.cheats = { digs: true };
  const a = polar([0, 300]);
  let shots = 0;
  for (const [dx, y] of [[46, 6], [46, 14], [46, 22], [40, 10], [52, 10], [40, 20]]) {   // up the leg, then either side of it
    if (G.falls.length) break;
    dig(G, [a.x + dx, y, a.z], digOf('gauss')); shots++;
  }
  assert.ok(G.falls.length >= 1, `it broke after ${shots} hits`);
  assert.ok(shots <= 6);
  stepFor(G, 4);
  assert.ok(!G.ter.solid(a.x, 40, a.z), 'the crown is down');
});

test('FOES FROZEN: foes stand still; switched off, they wake and come for you', () => {
  const G = createTestGame({ foes: ['jackal'] }), e = foes(G)[0];
  G.cheats = { freeze: true };
  e.ai.aware = true;
  const at = [e.x, e.z];
  stepFor(G, 5);
  assert.ok(Math.hypot(e.x - at[0], e.z - at[1]) < 0.5, 'frozen');
  G.cheats = {};
  e.ai.aware = false;
  stepFor(G, 3);
  assert.ok(e.ai.aware, 'awake once unfrozen');
  assert.ok(Math.hypot(e.x - at[0], e.z - at[1]) > 1, 'and moving');
});
