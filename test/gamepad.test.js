import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPad, stick, firstPad, PAD, DEAD } from '../src/input/gamepad.js';
import { update } from '../src/sim/update.js';
import { createTestGame, input } from './helpers.js';

// A gamepad in the standard mapping (#227, spec 11 § Gamepad).
const pad = ({ axes = [0, 0, 0, 0], on = [], values = {} } = {}) => ({
  mapping: 'standard', connected: true, axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: on.includes(i), value: values[i] ?? (on.includes(i) ? 1 : 0) })),
});

test('a stick at rest, or resting a little off centre, is still', () => {
  assert.deepEqual(stick(0, 0), [0, 0]);
  assert.deepEqual(stick(DEAD * 0.9, 0), [0, 0]);
  const r = readPad(pad({ axes: [0.12, -0.1, 0.05, 0.15] }));
  assert.deepEqual(Object.values(r.axes).map(v => Math.abs(v)), [0, 0, 0, 0]);
  assert.equal(r.active, false);
});

test('just past the deadzone is just above zero; full tilt is one', () => {
  const [x] = stick(DEAD + 0.01, 0);
  assert.ok(x > 0 && x < 0.05);
  assert.ok(Math.abs(stick(1, 0)[0] - 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...stick(0.9, 0.9)) - 1) < 1e-9, 'a corner is no faster than an edge');
});

test('the left stick is legs and throttle, the right is the torso (a curve for fine aim)', () => {
  const r = readPad(pad({ axes: [-1, 0, 1, 0] }));
  assert.equal(r.axes.turn, 1, 'left: legs turn left, like A');
  assert.equal(r.axes.twist, -1, 'right stick right: twist right');
  const u = readPad(pad({ axes: [0, -1, 0, 0.6] }));
  assert.equal(u.axes.thr, 1, 'up: throttle up, like W');
  assert.ok(u.axes.pitch < 0 && u.axes.pitch > -0.5, 'down a bit: pitch down, gently');
  assert.equal(r.active, true);
});

test('triggers and bumpers hold the weapon groups; A jumps; B centres', () => {
  const r = readPad(pad({ on: [PAD.RB, PAD.LB, PAD.A, PAD.B], values: { [PAD.RT]: 0.8, [PAD.LT]: 0.2 } }));
  assert.deepEqual(r.hold, { energy: true, missile: false, ballistic: true, fusion: true, jets: true, centre: true }, 'a trigger counts past a third of its pull');
});

test('a press is the frame the button went down, not every frame it is held', () => {
  const first = readPad(pad({ on: [PAD.LT, PAD.X, PAD.RS, PAD.START] }));
  assert.equal(first.pressed.missile, true);
  assert.equal(first.pressed.target, true);
  assert.equal(first.pressed.punch, true);
  assert.equal(first.pressed.start, true);
  const held = readPad(pad({ on: [PAD.LT, PAD.X, PAD.RS, PAD.START] }), first.held);
  assert.deepEqual([held.pressed.missile, held.pressed.target, held.pressed.punch, held.pressed.start], [false, false, false, false]);
  assert.equal(held.hold.missile, true, 'still held: the missiles fly while LT is down');
});

test('the standard-mapped pad is the one used; empty slots are skipped', () => {
  const other = { ...pad(), mapping: '' }, std = pad();
  assert.equal(firstPad([null, other, std]), std);
  assert.equal(firstPad([null, other]), other);
  assert.equal(firstPad([null, null]), null);
  assert.equal(firstPad(undefined), null);
});

test('the sim takes the stick on the throttle as W and S at that share', () => {
  const G = createTestGame();
  G.player.throttle = 0;
  update(G, input({ thr: 0.5 }), 0.5);
  assert.ok(Math.abs(G.player.throttle - 0.225) < 1e-9, 'half tilt for half a second: 0.5 x 0.9 x 0.5');
  for (let i = 0; i < 20; i++) update(G, input({ thr: 1 }), 0.1);
  assert.equal(G.player.throttle, 1, 'capped at full');
  for (let i = 0; i < 40; i++) update(G, input({ thr: -1 }), 0.1);
  assert.equal(G.player.throttle, -0.35, 'and at full reverse');
  update(G, input({ thr: 0 }), 0.5);
  assert.equal(G.player.throttle, -0.35, 'let go: it stays where it was set');
});
