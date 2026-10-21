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
  assert.ok(plain.ter.solid(0, -13, 0) && !big.ter.solid(0, -13, 0), `${BIG_DIG.scale}x the radius, and rock digs like soft ground`);
  assert.notEqual(plain.ter.hash(), big.ter.hash());
});

// Shots from the test range's start at an arch leg 220 m out: each digs where
// it meets the rock, as a shell does, so a hole has to keep getting deeper.
function shootLeg(G, type, max) {
  const a = polar([0, 220]), from = [0, 6, 0];
  let n = 0;
  while (n < max && !G.falls.length) {
    const to = [a.x - 44, [6, 10, 14][n % 3], a.z], d = to.map((v, i) => v - from[i]), L = Math.hypot(...d), dir = d.map(v => v / L);
    const t = G.ter.ray(from, dir, L + 60);
    if (t == null) break;
    dig(G, from.map((v, i) => v + dir[i] * t), digOf(type)); n++;
  }
  return n;
}
const archGame = () => {
  const G = createTestGame();
  for (const e of foes(G)) { e.x = 900; e.z = 900; }
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks: [{ kind: 'arch', at: [0, 220] }] } });
  return G;
};

test('BIG DIGS: a few AUTOCANNON or BIG BONKER hits on an arch\'s leg bring the crown down', () => {
  for (const [type, most] of [['ac', 6], ['gauss', 4]]) {
    const G = archGame();
    G.cheats = { digs: true };
    const n = shootLeg(G, type, 20);
    assert.ok(G.falls.length >= 1 && n <= most, `${type}: it broke after ${n} hits (at most ${most})`);
    stepFor(G, 4);
    const c = polar([0, 220]);
    assert.ok(!G.ter.solid(c.x, 40, c.z), `${type}: the crown is down`);
  }
});

test('without BIG DIGS, the AUTOCANNON only marks an arch (small guns barely mark rock)', () => {
  const G = archGame();
  shootLeg(G, 'ac', 30);
  assert.equal(G.falls.length, 0);
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
