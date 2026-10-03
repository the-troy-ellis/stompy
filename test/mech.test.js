import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes } from './helpers.js';

test('heat 100 shuts the reactor down and 45 brings it back, with the voice lines once each', () => {
  const G = createTestGame();
  const P = G.player;
  for (const e of foes(G)) e.alive = false;
  P.heat = 99.5;
  stepFor(G, 0.5, input({ held: { energy: true } }));
  assert.ok(P.shutdown, 'did not shut down');
  const down = G.fx.calls('say').filter(c => c.args[0] === 'Reactor shutdown.');
  assert.equal(down.length, 1);
  stepFor(G, 1, input({ held: { energy: true } }));   // held fire does nothing while down
  assert.ok(P.shutdown && P.heat < 100);
  stepFor(G, 5);
  assert.equal(P.shutdown, false);
  assert.ok(P.heat < 45);
  assert.equal(G.fx.calls('say').filter(c => c.args[0] === 'Reactor online.').length, 1);
});

test('losing a leg caps speed at 45%, both legs at a crawl', () => {
  const run = legs => {
    const G = createTestGame();
    for (const e of foes(G)) e.alive = false;
    Object.assign(G.player.hp, legs);
    stepFor(G, 8, input({ thrUp: true }));
    return G.player.speed / G.player.ch.speed;
  };
  assert.ok(Math.abs(run({}) - 1) < 0.02);
  assert.ok(Math.abs(run({ LL: 0 }) - 0.45) < 0.02);
  assert.ok(run({ LL: 0, RL: 0 }) < 0.05);
});

test('heat sinks at the chassis rate and faster while shut down', () => {
  const G = createTestGame();
  for (const e of foes(G)) e.alive = false;
  const P = G.player;
  P.heat = 60;
  stepFor(G, 1);
  assert.ok(Math.abs(P.heat - (60 - P.ch.sink)) < 0.5);
  P.heat = 90; P.shutdown = true;
  stepFor(G, 1);
  assert.ok(Math.abs(P.heat - 70) < 0.5);
});

test('jump jets lift the mech, burn fuel and heat, and landing jolts the cockpit', () => {
  const G = createTestGame();
  for (const e of foes(G)) e.alive = false;
  const P = G.player;
  stepFor(G, 1.5, input({ jets: true }));
  assert.ok(P.y > 3, `only ${P.y} m up`);
  assert.ok(P.air);
  assert.ok(P.fuel < 1);   // (jet heat is 10/s, exactly what a KESTREL sinks, so heat stays at 0)
  stepFor(G, 4);
  assert.equal(P.air, false);
  assert.ok(Math.abs(P.y) < 1e-6);
  assert.equal(G.fx.calls('sfx.land').length, 1);
});
