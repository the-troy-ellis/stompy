import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, SETTING_KEYS, SETTING_GROUPS, readSetting, stepSetting, hfov } from '../src/data/settings.js';

test('every dial has a sane range with its default inside it, and prints', () => {
  for (const k of SETTING_KEYS) {
    const s = SETTINGS[k];
    assert.ok(s.min < s.max && s.def >= s.min && s.def <= s.max, k);
    assert.equal(typeof s.fmt(s.def), 'string');
  }
  assert.equal(SETTINGS.fov.fmt(62), '94\u00b0', 'shown horizontally: 62 tall is 94 wide on 16:9');
  assert.equal(SETTINGS.fov.fmt(62, 2), '100\u00b0', 'and about 100 on a phone held sideways (spec 11)');
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

test('every dial belongs to a SETTINGS section, and the sections come in order (#230)', () => {
  assert.deepEqual(SETTING_GROUPS.map(g => g[1]), ['SOUND', 'CONTROLS', 'DISPLAY', 'GAME']);
  const keys = SETTING_GROUPS.map(g => g[0]);
  for (const k of SETTING_KEYS) assert.ok(keys.includes(SETTINGS[k].group), `${k} in a section`);
  assert.deepEqual(SETTING_KEYS.filter(k => SETTINGS[k].group === 'controls'), ['mouseSens', 'touchSens', 'padSens']);
});

test('VOICE RATE multiplies the voice from 0.7x to 1.5x, 1x by default (#230)', () => {
  assert.equal(SETTINGS.voiceRate.def, 1);
  assert.equal(SETTINGS.voiceRate.fmt(1.2), '1.2x');
  assert.equal(readSetting('voiceRate', 9), 1.5);
});

test('a vertical field of view as the horizontal one', () => {
  assert.equal(hfov(90, 1), 90);
  assert.equal(hfov(62, 16 / 9), 94);
  assert.ok(hfov(50, 2) < hfov(95, 2));
});
