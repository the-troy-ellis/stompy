// Far foes think less often (docs/specs/34-big-fights.md part 3): a foe out
// of any fight decides every 4th frame with the time it missed; in a fight,
// every frame. Its feet still step every frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, foes, DT } from './helpers.js';
import { update, noInput } from '../src/sim/update.js';
import { initFeet } from '../src/sim/gait.js';
import { FAR_THINK } from '../src/data/ai.js';

// How many of `n` frames `e` decided on (owed goes back to 0 when it does).
const decides = (G, e, n) => { let k = 0; for (let i = 0; i < n; i++) { update(G, noInput(), DT); if (!e.ai.owed) k++; } return k; };
const far = (seed = 5) => {
  const G = createTestGame({ seed, foes: ['jackal'] }), e = foes(G)[0];
  Object.assign(e, { x: 700, z: 700 }); initFeet(G, e); e.ai.aware = false;   // out of sight and far from you
  return { G, e };
};

test('a foe far from any fight decides every 4th frame, and walks on in between', () => {
  const { G, e } = far();
  update(G, noInput(), DT);
  const xs = [];
  let k = 0;
  for (let i = 0; i < 40; i++) { update(G, noInput(), DT); if (!e.ai.owed) k++; xs.push([e.x, e.z]); }
  assert.equal(k, 40 / FAR_THINK.every);
  assert.ok(e.ai.owed <= DT * (FAR_THINK.every - 1) + 1e-9, 'never owes more than the frames it skipped');
  const still = xs.slice(1).filter((p, i) => p[0] === xs[i][0] && p[1] === xs[i][1]).length;
  assert.ok(still < 5, `it walks every frame (${still} still)`);
});

test('within reach of a foe of its own, or hit lately, or seeing its prey, it decides every frame', () => {
  const near = createTestGame({ seed: 5, foes: ['jackal'] }), e = foes(near)[0];
  Object.assign(e, { x: 0, z: FAR_THINK.range - 50 }); initFeet(near, e); e.ai.aware = false;
  assert.equal(decides(near, e, 20), 20, 'near you');
  const { G: hit, e: h } = far(6);
  h.ai.hitAt = hit.time;
  assert.equal(decides(hit, h, 20), 20, 'hit');
  const { G: seen, e: s } = far(7);
  update(seen, noInput(), DT);
  s.ai.seen = true; s.ai.lookT = 1e9;   // it saw you, and won't look again in this test
  assert.equal(decides(seen, s, 20), 20, 'seeing its prey');
});

test('a patrol far off goes about as far either way', () => {
  const a = far(9), b = far(9);
  const every = FAR_THINK.every;
  FAR_THINK.every = 1;
  for (let i = 0; i < 600; i++) update(a.G, noInput(), DT);
  FAR_THINK.every = every;
  for (let i = 0; i < 600; i++) update(b.G, noInput(), DT);
  const d = Math.hypot(a.e.x - b.e.x, a.e.z - b.e.z), walked = Math.hypot(a.e.x - 700, a.e.z - 700);
  assert.ok(walked > 20, `it patrols (${walked.toFixed(0)} m)`);
  assert.ok(d < walked * 0.25 + 5, `${d.toFixed(1)} m apart after ${walked.toFixed(0)} m`);
});
