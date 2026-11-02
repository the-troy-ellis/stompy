// No garbage in the sim's hot loops (docs/specs/34-big-fights.md part 4):
// what changed to make less garbage gives the same numbers as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M, keepIf } from '../src/util/math.js';
import { torsoFrame, eyeOf, muzzle } from '../src/sim/geom.js';
import { geoOf } from '../src/data/geo.js';
import { createTestGame, foes } from './helpers.js';

test('keepIf drops what it is told to, in place and in order', () => {
  const a = [1, 2, 3, 4, 5, 6], same = a;
  assert.equal(keepIf(a, n => n % 2 === 0), same);
  assert.deepEqual(a, [2, 4, 6]);
  assert.deepEqual(keepIf([], () => true), []);
  assert.deepEqual(keepIf([1, 2], () => false), []);
});

test('the eye and the muzzles are the same to the bit as from torsoFrame', () => {
  const G = createTestGame({ seed: 3, foes: ['jackal', 'warden', 'kestrel'] });
  for (const m of [G.player, ...foes(G)]) {
    Object.assign(m, { yaw: 1.234, twist: -0.567, bob: 0.0123, torsoDrop: 0.045 });
    const tf = torsoFrame(m);
    assert.deepEqual(eyeOf(m), M.apply(tf, geoOf(m).eye));
    for (const w of m.weapons) {
      const g = geoOf(m), want = w.mount === 'T'
        ? M.apply(tf, w.def.kind === 'missile' ? [w.side % 2 ? -1.25 : 1.25, g.rackY, 0.6] : [-0.9, g.acY, 1.6])
        : M.apply(tf, [(w.mount === 'LA' ? 1 : -1) * g.armX, g.armY - 1.2, 2.4]);
      assert.deepEqual(muzzle(m, w), want, `${m.type} ${w.def.name ?? w.mount}`);
    }
  }
});
