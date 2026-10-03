import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEL } from '../src/data/feel.js';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { damage } from '../src/sim/combat.js';
import { feel, initFeel } from '../src/sim/feel.js';
import { initFeet } from '../src/sim/gait.js';

test('firing the autocannon nudges the mech back about 0.15 m and the push dies out', () => {
  const G = createTestGame({ foes: [] });
  const P = G.player;
  stepFor(G, 1);                                   // staggered start cooldowns
  const z0 = P.z;
  stepFor(G, 1 / 60, input({ held: { ballistic: true } }));
  assert.ok(Math.hypot(...P.push) > 0.3, `push ${P.push}`);
  assert.ok(P.flash && P.flash.big, 'no muzzle flash recorded');
  const f0 = G.frame;
  stepFor(G, 1.5);
  const back = z0 - P.z;
  assert.ok(back > 0.1 && back < 0.25, `stepped back ${back.toFixed(3)} m`);
  assert.ok(Math.hypot(...P.push) < 0.01, 'push did not decay');
  assert.ok(G.frame - P.flash.frame > 1, 'flash is a record of the frame it fired');
  assert.equal(P.flash.frame, f0);
  assert.equal(FEEL.fireAc.push, 0.4);
});

test('a missile volley recoils less than a shell', () => {
  const G = createTestGame({ foes: [] });
  stepFor(G, 1);
  stepFor(G, 1 / 60, input({ missileTap: true }));
  const p = Math.hypot(...G.player.push);
  assert.ok(p > 0 && p < FEEL.fireAc.push, `missile push ${p}`);
  assert.equal(G.player.flash.big, false);
});

test('a shell hit kicks the wobble; a beam hit does not (the renderer sways by melt instead)', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  initFeel(P);
  damage(G, P, [P.x, P.y + 5, P.z], 6, e, true);    // one frame of beam
  assert.equal(P.wob.p.v, 0);
  damage(G, P, [P.x, P.y + 5, P.z], 6, e, false);   // a shell
  assert.ok(P.wob.p.v > 0);
});

test('the clang names the section it rang', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  damage(G, P, [P.x + 2.5, P.y + 6, P.z], 3, e);     // left arm
  G.lastClang = -1;
  damage(G, P, [P.x, P.y + 1, P.z + 0.5], 3, e);     // a leg
  G.lastClang = -1;
  damage(G, P, [P.x, P.y + 6, P.z], 3, e);           // torso
  const secs = G.fx.calls('sfx.clang').map(c => c.args[0]);
  assert.deepEqual(secs, ['LA', secs[1], 'T']);
  assert.ok(secs[1] === 'LL' || secs[1] === 'RL');
});

test('knockback direction follows the event: pushing an enemy moves it that way', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 100 }); initFeet(G, e); freeze(e);
  const was = FEEL.hit.push;
  FEEL.hit.push = 10;
  try {
    feel(G, 'hit', { mech: e, k: 1, dir: [1, 0] });
    stepFor(G, 1);
    assert.ok(e.x > 1.5, `moved ${e.x}`);
  } finally { FEEL.hit.push = was; }
});
