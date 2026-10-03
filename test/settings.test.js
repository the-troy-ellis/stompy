import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, SETTING_KEYS, readSetting, stepSetting } from '../src/data/settings.js';

test('every dial has a sane range with its default inside it, and prints', () => {
  for (const k of SETTING_KEYS) {
    const s = SETTINGS[k];
    assert.ok(s.min < s.max && s.def >= s.min && s.def <= s.max, k);
    assert.equal(typeof s.fmt(s.def), 'string');
  }
  assert.equal(SETTINGS.fov.fmt(62), '62\u00b0');
  assert.equal(SETTINGS.voiceVol.fmt(0.9), '90%');
});

test('reading a stored value clamps it and falls back to the default on junk', () => {
  assert.equal(readSetting('mouseSens', '1.4'), 1.4);
  assert.equal(readSetting('mouseSens', 99), SETTINGS.mouseSens.max);
  assert.equal(readSetting('fov', 'nope'), SETTINGS.fov.def);
  assert.equal(readSetting('voiceVol', undefined), SETTINGS.voiceVol.def);
});

test('one click moves one step, snaps, and stops at the ends', () => {
  let v = 1;
  for (let i = 0; i < 3; i++) v = stepSetting('mouseSens', v, 1);
  assert.equal(v, 1.3);
  assert.equal(stepSetting('mouseSens', 2.5, 1), 2.5);
  assert.equal(stepSetting('fov', 50, -1), 50);
  assert.equal(stepSetting('fov', 62, 1), 67);
  assert.equal(stepSetting('voiceVol', 0.1, -1), 0);
});
