import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/state.js';
import { update, noInput } from '../src/sim/update.js';
import { recordFx } from '../src/sim/fx.js';
import { startWalkView, shiftMech, WALK_WRAP } from '../src/sim/walkView.js';

const { hypot } = Math;

function walk(chassis = 'kestrel', secs = 4, setup = () => {}) {
  const G = createGame({ fx: recordFx(), seed: 1 });
  G.mode = 'sp';
  startWalkView(G, chassis);
  setup(G);
  for (let f = 0; f < secs * 60; f++) { G.clock += 1000 / 60; update(G, noInput(), 1 / 60); }
  return G;
}

test('walk viewer: one mech, yours, on flat ground, walking at the picked speed', () => {
  const G = walk('kestrel', 4);
  assert.equal(G.kind, 'walk');
  assert.equal(G.mechs.length, 1);
  assert.ok(G.ter.flat);
  assert.ok(Math.abs(G.player.throttle - 0.6) < 1e-9, `throttle ${G.player.throttle}`);
  assert.ok(G.player.speed > 1, `speed ${G.player.speed}`);
});

test('walk viewer: STOP eases the throttle to nothing at the keys\' rate, and the mech stands', () => {
  const G = walk('kestrel', 3);
  G.walk.go = false;
  G.clock += 1000 / 60; update(G, noInput(), 1 / 60);
  assert.ok(G.player.throttle > 0.5, 'not at once');
  for (let f = 0; f < 4 * 60; f++) { G.clock += 1000 / 60; update(G, noInput(), 1 / 60); }
  assert.equal(G.player.throttle, 0);
  assert.ok(Math.abs(G.player.speed) < 0.3, `speed ${G.player.speed}`);
});

test('walk viewer: STRAIGHT comes back to the middle with its feet; CIRCLE stays near it', () => {
  const G = walk('jackal', 30, G => { G.walk.thr = 1; });   // a runner at full tilt goes past the wrap in 30 s
  assert.ok(hypot(G.player.x, G.player.z) <= WALK_WRAP + 1);
  for (const f of G.player.feet) assert.ok(hypot(f.pos[0] - G.player.x, f.pos[2] - G.player.z) < 12, 'feet came along');
  const C = walk('kestrel', 20, G => { G.walk.path = 'circle'; });
  assert.ok(hypot(C.player.x, C.player.z) < 80, `${C.player.x}, ${C.player.z}`);
});

test('shiftMech moves the mech and its feet, and nothing else', () => {
  const m = { x: 1, z: 2, feet: [{ pos: [1, 0, 2], from: [0, 0, 0] }, { pos: [3, 1, 4], from: null }] };
  shiftMech(m, 10, -5);
  assert.deepEqual([m.x, m.z], [11, -3]);
  assert.deepEqual(m.feet[0].pos, [11, 0, -3]);
  assert.deepEqual(m.feet[0].from, [10, 0, -5]);
  assert.deepEqual(m.feet[1].pos, [13, 1, -1]);
});
