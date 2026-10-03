import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumpParams, duckLevel, DUCK_HOLD, DUCK_RELEASE } from '../src/audio/thump.js';

test('a heavier thump is lower, longer and louder, within the sub range', () => {
  const light = thumpParams(0.3), mid = thumpParams(0.8), heavy = thumpParams(1.2), silly = thumpParams(50);
  assert.ok(light.freq > mid.freq && mid.freq > heavy.freq);
  assert.ok(heavy.freq >= 45 && light.freq <= 60);
  assert.ok(light.decay < mid.decay && mid.decay <= heavy.decay && heavy.decay <= 0.4 && light.decay >= 0.15);
  assert.ok(light.level < mid.level && mid.level < heavy.level && heavy.level <= 1);
  assert.deepEqual(silly, thumpParams(1.5), 'clamped');
  assert.equal(thumpParams(0).level, 0);
});

test('ducking drops to one minus the fraction, never silences, and the timing matches the spec', () => {
  assert.equal(duckLevel(0.3), 0.7);
  assert.ok(Math.abs(duckLevel(0.8) - 0.2) < 1e-9);
  assert.ok(duckLevel(5) > 0);
  assert.equal(duckLevel(-1), 1);
  assert.equal(DUCK_HOLD, 0.25); assert.equal(DUCK_RELEASE, 0.4);
});
