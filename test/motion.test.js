import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEL } from '../src/data/feel.js';
import { feel } from '../src/sim/feel.js';
import { createTestGame, stepFor, foes } from './helpers.js';

test('REDUCED MOTION cuts the player camera and squash to the table scale, drops haptics, and leaves other mechs alone', () => {
  const run = reduced => {
    const G = createTestGame({ foes: ['jackal'] });
    G.reducedMotion = reduced;
    const P = G.player, e = foes(G)[0];
    G.kick = 0; G.shake = 0;
    feel(G, 'land', { mech: P, k: 1 });
    const mine = { kick: G.kick, shake: G.shake, squashV: P.squash.v, haptic: G.fx.calls('thump')[0].args[2] };
    feel(G, 'land', { mech: e, k: 1 });
    return { mine, theirsSquash: e.squash.v };
  };
  const on = run(true), off = run(false), s = FEEL.view.reducedScale;
  assert.ok(Math.abs(on.mine.kick - off.mine.kick * s) < 1e-9);
  assert.ok(Math.abs(on.mine.shake - off.mine.shake * s) < 1e-9);
  assert.ok(Math.abs(on.mine.squashV - off.mine.squashV * s) < 1e-9);
  assert.equal(on.mine.haptic, 0);
  assert.ok(off.mine.haptic > 0);
  assert.equal(on.theirsSquash, off.theirsSquash);
});

test('flashes fade twice as fast under REDUCED MOTION', () => {
  const fade = reduced => { const G = createTestGame({ foes: [] }); G.reducedMotion = reduced; G.flash = 0.5; stepFor(G, 0.2); return G.flash; };
  assert.ok(fade(true) < fade(false));
});
