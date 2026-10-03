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
