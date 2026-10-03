import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEL } from '../src/data/feel.js';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';

test('a shut-down mech sags by the table within a second and stands back up after restart with a small overshoot', () => {
  const G = createTestGame({ foes: [] });
  const P = G.player;
  P.heat = 99.9;
  stepFor(G, 0.2, input({ held: { energy: true } }));
  assert.ok(P.shutdown, 'did not shut down');
  stepFor(G, 1);
  const want = FEEL.shutdown.sag * P.ch.scale;
  assert.ok(Math.abs(P.sag.x - want) < want * 0.1, `sag ${P.sag.x} vs ${want}`);
  // Cool to the restart threshold and come back up.
  P.heat = 46;
  let lowest = 1;
  for (let i = 0; i < 90; i++) { stepFor(G, 1 / 30); lowest = Math.min(lowest, P.sag.x); }
  assert.equal(P.shutdown, false);
  assert.ok(lowest < -0.01, `no overshoot (lowest ${lowest})`);
  assert.ok(Math.abs(P.sag.x) < 0.02, `did not settle: ${P.sag.x}`);
  assert.ok(G.fx.calls('thump').some(c => c.args[1] >= FEEL.shutdown.duck - 1e-9), 'shutdown did not duck the hum');
});

test('an enemy with its reactor down slumps too, scaled by its size', () => {
  const G = createTestGame({ foes: ['warden', 'jackal'] });
  const [w, j] = foes(G);
  freeze(w); freeze(j);
  stepFor(G, 1.2);
  assert.ok(w.sag.x > j.sag.x && j.sag.x > 0.2, `sags ${w.sag.x} ${j.sag.x}`);
  assert.ok(Math.abs(w.sag.x / j.sag.x - w.ch.scale / j.ch.scale) < 0.05);
});
