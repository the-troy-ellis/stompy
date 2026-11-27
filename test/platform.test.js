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

// Rumble (docs/specs/40-steam-deck.md): the feel table's haptic column in the
// controller, through the first pad with a vibration actuator.
import { rumbleOf } from '../src/platform/index.js';

test('rumbleOf: a footfall is a short weak tick, a blast-off brings in the strong motor', () => {
  const step = rumbleOf(10), blast = rumbleOf(110);
  assert.equal(step.strongMagnitude, 0, 'no strong motor for a step');
  assert.ok(step.weakMagnitude > 0 && step.weakMagnitude < 0.5);
  assert.equal(step.duration, 30, 'never shorter than a pad can play');
  assert.equal(blast.strongMagnitude, 1);
  assert.equal(blast.weakMagnitude, 1);
  assert.equal(blast.duration, 220, 'capped');
  for (const v of Object.values(blast)) assert.ok(v >= 0 && Number.isFinite(v));
});

test('rumble plays a dual-rumble effect on the first pad that has an actuator, and is quiet without one', () => {
  const played = [];
  const pad = { vibrationActuator: { playEffect: (type, fx) => { played.push([type, fx]); return Promise.resolve('complete'); } } };
  const p = createPlatform({ navigator: { getGamepads: () => [null, { id: 'no rumble' }, pad] } });
  assert.equal(p.rumble(40), true);
  assert.equal(played.length, 1);
  assert.equal(played[0][0], 'dual-rumble');
  assert.deepEqual(played[0][1], rumbleOf(40));
  assert.equal(createPlatform({ navigator: {} }).rumble(40), false);
  assert.equal(createPlatform({ navigator: { getGamepads() { throw new Error('no'); } } }).rumble(40), false);
  assert.equal(createPlatform(undefined).rumble(40), false);
});

// The Steam Deck app's update offer (docs/specs/40-steam-deck.md): through
// window.stompyShell when the shell is there, and nothing anywhere else.
test('onShellUpdate: the shell says ready once, and apply restarts it; no shell, no offer', () => {
  let ready = null, restarts = 0;
  const p = createPlatform({ stompyShell: { onUpdateReady: cb => { ready = cb; }, restart: () => { restarts++; } } });
  const offers = [];
  p.onShellUpdate(apply => offers.push(apply));
  assert.equal(offers.length, 0, 'nothing until the build is in place');
  ready();
  assert.equal(offers.length, 1);
  offers[0]();
  assert.equal(restarts, 1);
  createPlatform({ navigator: {} }).onShellUpdate(() => assert.fail('no shell, no offer'));
  createPlatform(undefined).onShellUpdate(() => assert.fail('no window, no offer'));
});
