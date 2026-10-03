import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compassLabel } from '../src/render/hud.js';

test('the compass tape names the quarters and numbers the rest', () => {
  assert.equal(compassLabel(0), 'N');
  assert.equal(compassLabel(90), 'E');
  assert.equal(compassLabel(180), 'S');
  assert.equal(compassLabel(270), 'W');   // was 'app.scene.view.W' after the M0 rename
  assert.equal(compassLabel(30), '03');
  assert.equal(compassLabel(120), '12');
  assert.equal(compassLabel(330), '33');
});

test('the AI debug label reads state, profile, group and what it is doing', async () => {
  const { aiLabel } = await import('../src/render/hud.js');
  const e = { ch: { ai: { profile: 'harass' } }, ai: { state: 'engage', group: { id: 2, size: 3, flank: true }, cover: { x: 0, z: 0 } }, melee: null };
  assert.equal(aiLabel(e), 'ENGAGE harass G2* COVER');
  assert.equal(aiLabel({ ch: {}, ai: {} }), 'PATROL baseline');
  assert.equal(aiLabel({ ch: { ai: { profile: 'line' } }, ai: { state: 'search', group: { id: 1, size: 1, flank: false }, hot: true }, melee: { phase: 'windup' } }), 'SEARCH line SWING HOT');
});

test('the autocannon lead point is ahead of a walking target by its speed over the time of flight', async () => {
  const { leadPoint, center } = await import('../src/sim/geom.js');
  const t = { x: 0, y: 0, z: 340, yaw: Math.PI / 2, speed: 10, ch: { scale: 1 } };   // walking +x at 10 m/s, 340 m out
  const p = leadPoint([0, 4.2, 0], t, 340);
  assert.ok(Math.abs(p[0] - 10) < 0.2, `lead ${p[0]} m`);
  assert.ok(Math.abs(p[2] - 340) < 0.01);
  t.speed = 0;
  assert.deepEqual(leadPoint([0, 4.2, 0], t, 340), center(t));
});
