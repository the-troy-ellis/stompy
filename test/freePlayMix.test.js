import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FP_MIXES, pickFoes } from '../src/data/missions.js';
import { CHASSIS, isUnlocked } from '../src/data/chassis.js';
import { makeRng } from '../src/sim/rng.js';

const count = list => list.reduce((a, k) => ({ ...a, [k]: (a[k] || 0) + 1 }), {});

test('four mixes, MIXED first (the old JACKAL / WARDEN blend), every chassis named exists', () => {
  assert.deepEqual(FP_MIXES.map(m => m.label), ['MIXED', 'LIGHT', 'HEAVY', 'EVERYTHING']);
  assert.deepEqual(FP_MIXES[0].w, { jackal: 0.65, warden: 0.35 });
  for (const m of FP_MIXES) for (const k of Object.keys(m.w)) assert.ok(CHASSIS[k], `${m.key}: ${k}`);
  assert.equal(Object.keys(FP_MIXES[3].w).length, Object.keys(CHASSIS).length, 'EVERYTHING is everything');
});

test('the draw follows the weights', () => {
  const r = makeRng(5), rand = () => r.next();
  const c = count(pickFoes(FP_MIXES[0], 4000, rand));
  assert.ok(Math.abs(c.jackal / 4000 - 0.65) < 0.03, `jackal ${c.jackal}`);
  const all = count(pickFoes(FP_MIXES[3], 6000, rand));
  for (const k of Object.keys(CHASSIS)) assert.ok(all[k] > 800, `${k} ${all[k]}`);
  assert.equal(pickFoes(FP_MIXES[1], 5, rand).length, 5);
});

test('only unlocked chassis turn up: a fresh save\'s HEAVY is all WARDENs, and nobody meets PURPLE PUNCHER early', () => {
  const r = makeRng(9), rand = () => r.next(), fresh = k => isUnlocked(k, 0);
  assert.deepEqual([...new Set(pickFoes(FP_MIXES[2], 50, rand, fresh))], ['warden']);
  const all = new Set(pickFoes(FP_MIXES[3], 300, rand, fresh));
  assert.ok(!all.has('puncher') && !all.has('light1') && !all.has('sniper1'));
  const late = new Set(pickFoes(FP_MIXES[3], 600, rand, k => isUnlocked(k, 11)));
  assert.ok(late.has('puncher'), 'after mission 11 it can show up');
});
