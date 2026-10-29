// Blast-off jets (docs/specs/26-blast-off.md): hold JUMP on the ground to
// charge, let go to blast off, higher and further the fuller the charge, with
// the thunk and the ring; the jets are spent until they've refilled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes } from './helpers.js';
import { JETS } from '../src/data/systems.js';

const DT = 1 / 60;
const game = () => { const G = createTestGame(); for (const e of foes(G)) e.alive = false; return G; };
// Hold JUMP for `s` seconds, let go, and follow the flight to the ground: how high, how far, how long.
function blast(G, s, over = {}) {
  const P = G.player, x0 = P.x, z0 = P.z, y0 = P.y;
  stepFor(G, s, input({ jets: true, ...over }));
  let top = P.y, t = 0;
  stepFor(G, DT, input(over));
  while ((P.air || t < 0.1) && t < 8) { stepFor(G, DT, input(over)); top = Math.max(top, P.y); t += DT; }
  return { up: top - y0, along: Math.hypot(P.x - x0, P.z - z0), t };
}

test('the charge fills in 0.9 s, crouched on the ground', () => {
  const G = game(), P = G.player;
  stepFor(G, 0.45, input({ jets: true }));
  assert.ok(Math.abs(P.jet.charge - 0.5) < 0.03 && !P.air, `half way: ${P.jet.charge}`);
  stepFor(G, 0.5, input({ jets: true }));
  assert.equal(P.jet.charge, 1);
});

test('fuller charges blast higher; a tap is a hop', () => {
  const hop = blast(game(), 2 * DT), half = blast(game(), 0.45), full = blast(game(), 1);
  assert.ok(hop.up > 3 && hop.up < 8, `a hop: ${hop.up.toFixed(1)} m`);
  assert.ok(full.up > 22 && full.up < 28, `full: ${full.up.toFixed(1)} m`);
  assert.ok(hop.up < half.up && half.up < full.up);
});

test('blasting off at a run carries you along: about 40 m at full charge and throttle', () => {
  const G = game(), P = G.player;
  P.throttle = 1; stepFor(G, 2, input({ thrUp: true }));   // up to speed
  const r = blast(G, 1, { thrUp: true });
  assert.ok(r.along > 40, `along ${r.along.toFixed(1)} m in ${r.t.toFixed(1)} s`);
  const still = blast(game(), 1);
  assert.ok(still.along < 2, 'standing still: straight up');
});

test('the blast: the thunk and the heat; then no charging until the jets refill', () => {
  const G = game(), P = G.player;
  stepFor(G, 2 * DT, input({ jets: true }));
  stepFor(G, DT);   // let go: a hop
  assert.ok(P.air && P.heat >= JETS[1].heat[0] - 1, `hot: ${P.heat}`);
  assert.equal(G.fx.calls('sfx.blastoff').length, 1);
  let t = 0;
  while (P.air && t < 3) { stepFor(G, DT); t += DT; }
  assert.ok(t < 2, `a short hop: ${t.toFixed(2)} s`);
  assert.ok(P.fuel < 1, 'down again before the jets are ready');
  stepFor(G, 0.5, input({ jets: true }));
  assert.equal(P.jet.charge, 0, 'not ready: no charge');
  stepFor(G, JETS[1].recharge, input());
  assert.equal(P.fuel, 1, 'ready again');
  stepFor(G, 0.3, input({ jets: true }));
  assert.ok(P.jet.charge > 0);
});

test('a charge is lost, not blasted, when shut down or knocked into the air', () => {
  const G = game(), P = G.player;
  stepFor(G, 0.6, input({ jets: true }));
  P.shutdown = true;
  stepFor(G, DT, input({ jets: true }));
  assert.equal(P.jet.charge, 0);
  stepFor(G, DT, input());
  assert.ok(!P.air && G.fx.calls('sfx.blastoff').length === 0, 'no blast on letting go');
});

test('no jets fitted: holding JUMP does nothing', () => {
  const G = game(), P = G.player;
  P.jets = 0;
  const r = blast(G, 1);
  assert.ok(r.up < 0.5 && !P.jet?.charge);
});
