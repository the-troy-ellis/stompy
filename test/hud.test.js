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
