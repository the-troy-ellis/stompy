import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSway, stepSway } from '../src/render/hud.js';
import { FEEL } from '../src/data/feel.js';

// A landing-sized kick: the camera drops by 1 at once and recovers at 5/s (update.js).
function trace(drop, secs = 1.5, dt = 1 / 60) {
  const s = makeSway(), out = [];
  for (let t = 0; t < secs; t += dt) out.push(stepSway(s, drop(t), dt));
  return out;
}
const kick = t => Math.max(0, 1 - 5 * t);

test('the cockpit and the HUD do not move as one: the cockpit snaps and rattles, the HUD floats behind', () => {
  const tr = trace(kick), c = tr.map(o => o.cockpit), h = tr.map(o => o.hud);
  const peak = a => a.indexOf(Math.max(...a));
  assert.ok(peak(c) < peak(h), `cockpit peaks first (${peak(c)} vs ${peak(h)} frames)`);
  assert.ok(c[3] > h[3] * 3, 'a few frames in, the cockpit has jolted and the HUD has barely started');
  assert.ok(Math.min(...c) < -0.05, 'the cockpit rattles past level');
  assert.ok(Math.min(...h) > -0.05 * Math.max(...h) - 1e-6, 'the HUD settles without bouncing much');
  assert.ok(Math.abs(c.at(-1)) < 0.05 && Math.abs(h.at(-1)) < 0.05, 'both settle');
});

test('the gains and springs come from FEEL.view, and a zero step holds still', () => {
  const s = makeSway();
  assert.deepEqual(stepSway(s, 1, 0), { cockpit: 0, hud: 0 });
  const V = { ...FEEL.view, cockpitGain: 0, hudGain: 10 };
  const o = stepSway(s, 1, 0.1, V);
  assert.equal(o.cockpit, 0);
  assert.ok(o.hud > 0);
});
