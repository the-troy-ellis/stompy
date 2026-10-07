import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProps, propFor, PROP_KEYS } from '../src/mesh/props.js';

const bounds = b => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < b.d.length; i += 9) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], b.d[i + j]); hi[j] = Math.max(hi[j], b.d[i + j]); }
  return { lo, hi };
};

test('the props #98 asks for exist, each with a wreck', () => {
  for (const k of ['relay', 'tank', 'truck', 'launcher', 'pad']) assert.ok(PROP_KEYS.includes(k), k);
  for (const k of ['relay', 'tank', 'truck', 'launcher']) assert.ok(PROP_KEYS.includes(`${k}Wreck`), `${k}Wreck`);
});

test('the scenery library #161 asks for exists', () => {
  for (const k of ['bunker', 'pipe', 'wall', 'mast', 'crates', 'deadTree', 'vent', 'spire']) assert.ok(PROP_KEYS.includes(k), k);
});

test('the lava vent has a glowing part, drawn as an extra mesh; nothing else glows', () => {
  assert.equal(propFor({ mesh: 'vent', alive: true, radius: 9, height: 6 }).glow, 'ventGlow');
  assert.equal(propFor({ mesh: 'bunker', alive: true, radius: 6, height: 5 }).glow, null);
  const glow = buildProps().ventGlow, lava = [1, 0.42, 0.08];
  for (let i = 6; i < glow.d.length; i += 9) assert.deepEqual([glow.d[i], glow.d[i + 1], glow.d[i + 2]].map(v => +v.toFixed(2)), lava);
});

test('every prop is under 120 triangles and fits its unit footprint', () => {
  for (const [k, b] of Object.entries(buildProps())) {
    const tris = b.d.length / 27;
    assert.ok(tris > 0 && tris <= 120, `${k}: ${tris} triangles`);
    const { lo, hi } = bounds(b);
    assert.ok(lo[1] > -0.1 && hi[1] <= 1.05, `${k} height ${lo[1]}..${hi[1]}`);
    assert.ok(Math.max(-lo[0], hi[0]) <= 1.05, `${k} width`);
    assert.ok(Math.max(-lo[2], hi[2]) <= 1.35, `${k} length`);
  }
});

test('propFor picks the intact mesh, the wreck, or the toppled mesh', () => {
  const e = { mesh: 'relay', alive: true, radius: 4, height: 20 };
  assert.deepEqual(propFor(e), { key: 'relay', head: null, glow: null, sy: 20, tint: 1 });
  assert.equal(propFor({ ...e, alive: false }).key, 'relayWreck');
  const toppled = propFor({ ...e, alive: false, fall: { yaw: 0, t: 1 } });
  assert.equal(toppled.key, 'relay');
  assert.ok(toppled.tint < 1);
});

test('the launcher has a turning head until it is wrecked; the pad scales with its radius', () => {
  const l = { mesh: 'launcher', alive: true, radius: 5, height: 6 };
  assert.equal(propFor(l).head, 'launcherHead');
  assert.equal(propFor({ ...l, alive: false }).head, null);
  assert.equal(propFor({ mesh: 'pad', alive: true, radius: 14, height: 0 }).sy, 14);
});

test('an entity without a known mesh falls back to boxes', () => {
  assert.equal(propFor({ mesh: null, alive: true }), null);
  assert.equal(propFor({ mesh: 'castle', alive: true }), null);
});
