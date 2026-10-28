// The device layer's browser fallbacks, and the shell's calls when a fake
// window.Capacitor is there (docs/specs/24-apps-and-unlock.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlatform } from '../src/platform/index.js';

test('with no window (node, a worker) every call is a safe no-op', () => {
  const p = createPlatform(undefined);
  assert.equal(p.isApp, false);
  assert.equal(p.os, 'web');
  assert.equal(p.hidden(), false);
  p.haptic(30);   // nothing to buzz, and no throw
});

test('in a browser: not an app, and haptics are navigator.vibrate', () => {
  const buzzes = [];
  const p = createPlatform({ document: { hidden: true }, navigator: { vibrate: ms => buzzes.push(ms) } });
  assert.equal(p.isApp, false);
  assert.equal(p.hidden(), true);
  p.haptic(40);
  assert.deepEqual(buzzes, [40]);
});

test('a browser without vibration, or one that throws, stays quiet', () => {
  createPlatform({ navigator: {} }).haptic(40);
  createPlatform({ navigator: { vibrate() { throw new Error('blocked'); } } }).haptic(40);
});

test('in the shell: isApp and the os come from window.Capacitor', () => {
  const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }, navigator: {}, document: {} };
  const p = createPlatform(win);
  assert.equal(p.isApp, true);
  assert.equal(p.os, 'android');
});

test("Capacitor's web build (not native) counts as the browser", () => {
  const p = createPlatform({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } });
  assert.equal(p.isApp, false);
  assert.equal(p.os, 'web');
});
