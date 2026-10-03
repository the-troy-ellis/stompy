import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEL } from '../src/data/feel.js';
import { legSplay } from '../src/render/scene.js';
import { createTestGame, stepFor, input, foes } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';

const smoke = G => G.parts.filter(p => p.kind === 'smoke').length;

test('footfall dust follows the table: none at zero, more at a higher setting', () => {
  const was = FEEL.step.dust;
  try {
    const run = dust => { FEEL.step.dust = dust; const G = createTestGame({ foes: [] }); let peak = 0; for (let i = 0; i < 6; i++) { stepFor(G, 0.5, input({ thrUp: true })); peak = Math.max(peak, smoke(G)); } return peak; };
    assert.equal(run(0), 0);
    const one = run(1), two = run(2);
    assert.ok(one > 0, 'no dust at the default');
    assert.ok(two > one, `${two} vs ${one}`);
  } finally { FEEL.step.dust = was; }
});

test('a heavy mech walking past is felt through the ground; a light one is not', () => {
  const walkBy = type => {
    const G = createTestGame({ foes: [type] });
    const e = foes(G)[0];
    Object.assign(e, { x: 15, z: -20, yaw: 0, throttle: 1, team: 0 });   // friendly: no AI, just walks
    initFeet(G, e);
    let peak = 0;
    for (let i = 0; i < 60; i++) { stepFor(G, 0.05); peak = Math.max(peak, G.shake); }
    return peak;
  };
  assert.ok(walkBy('warden') > 0, 'a WARDEN 15 m away shook nothing');
  assert.equal(walkBy('jackal'), 0);
});

test('a hard landing throws a ring of dust; a soft one only a puff', () => {
  const drop = h => {
    const G = createTestGame({ foes: [] });
    const P = G.player;
    P.y = h; P.air = true;
    let peak = 0;
    for (let i = 0; i < 50; i++) { stepFor(G, 0.05); peak = Math.max(peak, smoke(G)); }   // dust fades within a second: count the peak
    return { n: peak, force: G.fx.calls('sfx.land')[0]?.args[0] };
  };
  const hard = drop(30), soft = drop(2.5);
  assert.ok(hard.force > 0.7 && soft.force < 0.7, `forces ${hard.force} ${soft.force}`);
  assert.ok(hard.n > soft.n + 4, `ring ${hard.n} vs puff ${soft.n}`);
  assert.ok(soft.n > 0);
});

test('knees splay with squash, capped at a fifth', () => {
  assert.equal(legSplay(0), 0);
  assert.ok(legSplay(0.1) > 0 && legSplay(0.1) < 0.2);
  assert.ok(Math.abs(legSplay(0.25) - 0.2) < 1e-9);
  assert.ok(Math.abs(legSplay(5) - 0.2) < 1e-9);
  assert.equal(legSplay(-1), 0);
});
