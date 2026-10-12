// Gestures from raw pointer events (src/input/pointer.js): one finger taps,
// long-presses and drags; two fingers pan, pinch and twist; the right button
// pans; nothing is both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestures, GESTURE } from '../src/input/pointer.js';

function rig() {
  const log = [], h = {};
  for (const k of ['tap', 'longPress', 'longEnd', 'dragStart', 'drag', 'dragEnd', 'dragCancel', 'pan', 'pinch', 'twist']) h[k] = (...a) => log.push([k, ...a.map(v => Math.round(v * 1000) / 1000)]);
  return { g: createGestures(h), log, kinds: () => log.map(e => e[0]) };
}
const P = (id, x, y, t = 0, button = 0) => ({ id, x, y, t, button });

test('a short still press is a tap', () => {
  const { g, log } = rig();
  g.down(P(1, 100, 100)); g.move(P(1, 103, 102)); g.up(P(1, 103, 102, 120));
  assert.deepEqual(log, [['tap', 103, 102]]);
});

test('a press held still is a long press, and lifting ends it', () => {
  const { g, kinds } = rig();
  g.down(P(1, 50, 50, 0)); g.tick(GESTURE.long - 1); assert.deepEqual(kinds(), []);
  g.tick(GESTURE.long); g.move(P(1, 80, 80)); g.up(P(1, 80, 80));
  assert.deepEqual(kinds(), ['longPress', 'longEnd']);
});

test('one finger moved past the slop is a drag from where it started', () => {
  const { g, log } = rig();
  g.down(P(1, 10, 10)); g.move(P(1, 30, 10)); g.move(P(1, 40, 20)); g.tick(1000); g.up(P(1, 40, 20));
  assert.deepEqual(log, [['dragStart', 10, 10], ['drag', 30, 10, 10, 10], ['drag', 40, 20, 10, 10], ['dragEnd', 40, 20, 10, 10]]);
});

test('a second finger cancels the drag and becomes pan, pinch and twist', () => {
  const { g, log, kinds } = rig();
  g.down(P(1, 100, 100)); g.move(P(1, 130, 100));
  g.down(P(2, 200, 100));
  assert.deepEqual(kinds(), ['dragStart', 'drag', 'dragCancel']);
  log.length = 0;
  g.move(P(2, 210, 100));   // apart along x: pan right by 5, a pinch nearer
  assert.deepEqual(log.map(e => e[0]), ['pan', 'pinch']);
  assert.deepEqual(log[0], ['pan', 5, 0]);
  assert.ok(log[1][1] < 1, 'fingers apart zoom in');
  log.length = 0;
  g.move(P(2, 130, 180));   // swung round finger 1: a twist
  assert.ok(kinds().includes('twist'));
  log.length = 0;
  g.up(P(1, 130, 100)); g.move(P(2, 300, 300)); g.up(P(2, 300, 300));
  assert.deepEqual(log, [], 'the finger left behind is not a drag or a tap');
  g.down(P(3, 5, 5)); g.up(P(3, 5, 5));
  assert.deepEqual(kinds(), ['tap'], 'and the next touch is fresh');
});

test('the right button pans, and the wheel pinches', () => {
  const { g, log } = rig();
  g.down(P(1, 10, 10, 0, 2)); g.move(P(1, 25, 5)); g.up(P(1, 25, 5, 0, 2));
  assert.deepEqual(log, [['pan', 15, -5]]);
  log.length = 0;
  g.wheel(100, 40, 50); g.wheel(-100, 40, 50);
  assert.ok(log[0][1] > 1 && log[1][1] < 1 && log[0][2] === 40);
});

test('a cancelled pointer ends what it was doing', () => {
  const { g, kinds } = rig();
  g.down(P(1, 0, 0)); g.move(P(1, 50, 0)); g.cancel(P(1, 50, 0));
  g.down(P(2, 0, 0)); g.up(P(2, 0, 0));
  assert.deepEqual(kinds(), ['dragStart', 'drag', 'dragCancel', 'tap']);
});
