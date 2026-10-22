import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input } from './helpers.js';
import { FEEL } from '../src/data/feel.js';
import { BODY } from '../src/data/walk.js';

test('weight: the body rocks back pulling away, pitches forward braking, and settles at a cruise', () => {
  const G = createTestGame({ foes: [] });
  const P = G.player;
  let back = 0;
  for (let i = 0; i < 60; i++) { stepFor(G, 1 / 60, input({ thrUp: true })); back = Math.min(back, P.tilt.p.x); }
  assert.ok(back < -0.03, `pulling away: leans back (${back.toFixed(3)})`);
  stepFor(G, 4, input({ thrUp: true }));
  assert.ok(Math.abs(P.tilt.p.x) < 0.01, `at a steady cruise it stands up (${P.tilt.p.x.toFixed(3)})`);
  let fwd = 0;
  for (let i = 0; i < 90; i++) { stepFor(G, 1 / 60, input({ stop: true })); fwd = Math.max(fwd, P.tilt.p.x); }
  assert.ok(fwd > 0.03, `braking: pitches forward (${fwd.toFixed(3)})`);
  assert.ok(Math.abs(P.tilt.p.x) <= FEEL.inertia.max * 1.6, 'and never far past the cap');
});

test('weight: a turn at speed rolls it outward, and a bigger mech swings slower', () => {
  const peak = (chassis, turn) => {
    const G = createTestGame({ chassis, foes: [] });
    const P = G.player;
    stepFor(G, 4, input({ thrUp: true }));
    const yaw0 = P.yaw;
    let r = 0;
    for (let i = 0; i < 120; i++) { stepFor(G, 1 / 60, input({ thrUp: true, turn })); if (Math.abs(P.tilt.r.x) > Math.abs(r)) r = P.tilt.r.x; }
    return { r, turned: P.yaw - yaw0, P };
  };
  const a = peak('kestrel', 1), b = peak('kestrel', -1);
  assert.ok(Math.abs(a.r) > 0.01 && Math.sign(a.r) === -Math.sign(b.r), `one way ${a.r.toFixed(3)}, the other ${b.r.toFixed(3)}`);
  // Yaw rising is a turn to its left (its left is +x); outward is its right: tilt.r > 0.
  for (const t of [a, b]) assert.equal(Math.sign(t.r), Math.sign(t.turned), 'it rolls out of the turn');
  const light = peak('jackal', 1), heavy = peak('warden', 1);
  assert.ok(heavy.P.tilt.r.k < light.P.tilt.r.k, 'the bigger mech has the softer spring');
});

test('weight: the body lurches ahead after a footfall and eases back; standing still, it does not (the old body)', () => {
  BODY.model = 'old';   // the pendulum body's lurch is its own (test/pendulumBody.test.js)
  try { oldLurch(); } finally { BODY.model = 'pendulum'; }
});
function oldLurch() {
  const G = createTestGame({ foes: [] });
  const P = G.player;
  stepFor(G, 1);
  assert.equal(P.surge || 0, 0);
  stepFor(G, 3, input({ thrUp: true }));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 120; i++) { stepFor(G, 1 / 60, input({ thrUp: true })); lo = Math.min(lo, P.surge); hi = Math.max(hi, P.surge); }
  assert.ok(hi > 0.2 && lo < hi * 0.5, `surge ${lo.toFixed(2)}..${hi.toFixed(2)}`);
}
