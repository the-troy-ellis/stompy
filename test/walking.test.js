import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { slopeFactor } from '../src/sim/mech.js';
import { travel } from '../src/sim/ai/behaviours.js';
import { WALK } from '../src/data/walk.js';

const ramp = (G, grade) => { const base = G.ter.height; G.ter = { ...G.ter, height: (x, z) => base(x, z) + z * grade }; };

test('a climb is slow and a descent a little quick; the flat is the flat', () => {
  const run = (grade, yaw) => {
    const G = createTestGame();
    for (const e of foes(G)) freeze(e);
    const P = G.player;
    ramp(G, grade); P.yaw = yaw; P.y = G.ter.height(P.x, P.z);
    stepFor(G, 6, input({ thrUp: true }));
    return P.speed;
  };
  const flat = run(0, 0), up = run(0.2, 0), down = run(0.2, Math.PI);
  assert.ok(Math.abs(flat - 15) < 0.5, `flat ${flat}`);
  assert.ok(up < flat * 0.6, `uphill ${up} vs flat ${flat}`);
  assert.ok(down > flat * 1.05 && down <= flat * WALK.slopeMax + 0.01, `downhill ${down} vs flat ${flat}`);
  const G = createTestGame(); ramp(G, 0.2);
  assert.ok(Math.abs(slopeFactor(G, G.player) - 0.5) < 1e-6, 'a 20% grade costs half');
  G.player.yaw = Math.PI;
  assert.ok(Math.abs(slopeFactor(G, G.player) - 1.15) < 1e-6);
});

test('a landing digs the feet in: the run comes off and the legs are held for a beat', () => {
  const G = createTestGame();
  for (const e of foes(G)) freeze(e);
  const P = G.player;
  stepFor(G, 4, input({ thrUp: true }));
  const cruise = P.speed;
  P.y += 7; P.air = true; P.vy = 0;   // dropped from seven metres, still at full throttle
  let before = 0, after = 0, held = 0;
  for (let i = 0; i < 180; i++) {
    const wasAir = P.air;
    stepFor(G, 1 / 60, input({ thrUp: true }));
    if (wasAir && !P.air) { before = cruise; after = P.speed; held = P.dig; }
  }
  assert.ok(after < before * 0.75, `landing took the speed from ${before.toFixed(1)} only to ${after.toFixed(1)}`);
  assert.ok(held > 0 && held <= WALK.digHold, `held ${held}`);
  assert.ok(P.speed > cruise * 0.9, `should be back up to speed (${P.speed.toFixed(1)} of ${cruise.toFixed(1)})`);
  assert.equal(P.dig, 0);
});

test('a crawler keeps its grip: a WARDEN climbs a 20% grade at its flat speed, a KESTREL does not', () => {
  const run = (chassis, grade, yaw) => {
    const G = createTestGame({ chassis });
    for (const e of foes(G)) freeze(e);
    const P = G.player;
    ramp(G, grade); P.yaw = yaw; P.y = G.ter.height(P.x, P.z);
    stepFor(G, 6, input({ thrUp: true }));
    return P.speed;
  };
  const flat = run('warden', 0, 0), up = run('warden', 0.2, 0), down = run('warden', 0.2, Math.PI);
  assert.ok(Math.abs(up - flat) < 0.05 && Math.abs(down - flat) < 0.05, `warden flat ${flat} up ${up} down ${down}`);
  assert.ok(run('kestrel', 0.2, 0) < run('kestrel', 0, 0) * 0.6, 'a walker still slows on the climb');
  const G = createTestGame({ chassis: 'warden' }); ramp(G, 0.2);
  assert.equal(slopeFactor(G, G.player), 1);
  G.player.yaw = Math.PI;
  assert.equal(slopeFactor(G, G.player), 1);
});

test('the AI weighs a climb for a walker and not for a crawler', () => {
  const G = createTestGame({ foes: ['kestrel', 'warden'] }); ramp(G, 0.2);
  const [walker, crawler] = foes(G);
  for (const e of [walker, crawler]) { e.x = 0; e.z = 0; }
  const up = [0, 100], level = [100, 0], down = [0, -100];
  assert.ok(Math.abs(travel(G, crawler, ...up) - 100) < 1e-6 && Math.abs(travel(G, crawler, ...down) - 100) < 1e-6, 'a crawler: metres are metres');
  assert.ok(Math.abs(travel(G, walker, ...level) - 100) < 1e-6);
  assert.ok(Math.abs(travel(G, walker, ...up) - 200) < 1e-6, 'a walker: 100 m up a 20% grade is 200 m of walking');
  assert.ok(travel(G, walker, ...down) < 100, 'and downhill a little less than 100');
});
