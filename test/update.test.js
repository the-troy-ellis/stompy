import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes } from './helpers.js';
import { HPK } from '../src/data/chassis.js';
import { update, noInput } from '../src/sim/update.js';

const finite = m => ['x', 'y', 'z', 'yaw', 'twist', 'pitch', 'speed', 'heat', 'fuel'].every(k => Number.isFinite(m[k])) && HPK.every(k => Number.isFinite(m.hp[k]));

test('a mission runs 10 s with no NaN anywhere and the player walks forward under throttle', () => {
  const G = createTestGame({ foes: ['jackal', 'warden'] });
  stepFor(G, 10, input({ thrUp: true }));
  for (const m of G.mechs) assert.ok(finite(m), `${m.type} went non-finite`);
  assert.ok(G.player.z > 60, `player only reached z=${G.player.z.toFixed(1)}`);
  assert.ok(Math.abs(G.player.x) < 1e-6);
  assert.equal(G.frame, 600);
});

test('same seed and input give the same game', () => {
  const run = () => { const G = createTestGame({ seed: 9, foes: ['jackal', 'jackal'], flat: false }); stepFor(G, 8, input({ thrUp: true, turn: 0.3, held: { energy: true } })); return G; };
  const a = run(), b = run();
  const snap = G => G.mechs.map(m => [m.x, m.z, m.yaw, m.heat, m.alive, { ...m.hp }]).concat([G.stats]);
  assert.deepEqual(snap(a), snap(b));
});

test('enemies become aware and shoot back; the player takes damage over a minute of standing still', () => {
  const G = createTestGame({ seed: 3, foes: ['jackal', 'jackal'] });
  for (const e of foes(G)) e.ai.aware = true;
  stepFor(G, 60);
  assert.ok(G.stats.taken > 0, 'nobody shot the player');
  assert.ok(G.fx.calls('sfx.laser').length > 0, 'no laser sounds');
});

test('the match ends when the last enemy dies', async () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  e.hp.T = 1;
  G.mechs[0].heat = 0;
  // Direct damage path rather than aiming; the ELIMINATE objective ends it on the next frame.
  await import('../src/sim/combat.js').then(({ damage }) => {
    damage(G, e, [e.x, e.y + 5, e.z], 5, G.player);
    assert.equal(e.alive, false);
    stepFor(G, 1 / 60);
    assert.equal(G.state, 'over');
    assert.equal(G.won, true);
    assert.equal(G.stats.kills, 1);
    stepFor(G, 4);
    assert.equal(G.state, 'debrief');
  });
});

// Touch aim (input.js): a drag asks for a turn of the legs in radians; the
// sim pays it out at the chassis's own turn rate and says how much it used.
test('turnBy turns the legs no faster than the chassis can, and reports what it used', () => {
  const dt = 1 / 60;
  for (const type of ['kestrel', 'warden']) {
    const G = createTestGame({ chassis: type, foes: [] }), P = G.player, y0 = P.yaw;
    update(G, input({ turnBy: 1 }), dt);
    const step = P.ch.turn * dt;
    assert.ok(Math.abs(P.yaw - y0 - step) < 1e-9, `${type}: one frame of its turn rate`);
    assert.ok(Math.abs(G.turnByUsed - step) < 1e-9);
    update(G, input({ turnBy: -0.001 }), dt);
    assert.ok(Math.abs(G.turnByUsed + 0.001) < 1e-9, 'a small ask is paid in full');
  }
  const G = createTestGame({ foes: [] }), P = G.player;
  P.hp.LL = 0;
  update(G, input({ turnBy: 1 }), dt);
  assert.ok(Math.abs(G.turnByUsed - P.ch.turn * dt * 0.5) < 1e-9, 'half rate on one leg');
  P.shutdown = true; P.heat = 200;
  const y = P.yaw;
  update(G, input({ turnBy: 1 }), dt);
  assert.equal(P.yaw, y); assert.equal(G.turnByUsed, 0, 'a shut-down mech turns nowhere');
});

test('a double tap centres the torso all the way, however slow the frames, unless the pilot twists again', () => {
  for (const dt of [1 / 60, 0.05]) {   // 0.05: the cap a slow phone's frames hit
    const G = createTestGame(), P = G.player;
    P.twist = 1.2;
    update(G, { ...noInput(), centreTap: true }, dt);
    for (let i = 0; i < 60; i++) update(G, noInput(), dt);
    assert.equal(P.twist, 0, `dt ${dt}`);
    assert.ok(!P.centring, 'and then lets go');
  }
  const G = createTestGame(), P = G.player;
  P.twist = 1.2;
  update(G, { ...noInput(), centreTap: true }, 1 / 60);
  update(G, { ...noInput(), twist: -1 }, 1 / 60);
  const t = P.twist;
  for (let i = 0; i < 30; i++) update(G, noInput(), 1 / 60);
  assert.equal(P.twist, t, 'twisting takes the torso back');
});
