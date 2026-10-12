// The overhead camera (docs/specs/15-mission-editor.md § Tests): screen to
// ground and back at several zooms and turns, and the moves keep the ground
// under the finger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTopCamera, groundToScreen, screenToGround, panBy, zoomAt, rotateAbout, settle } from '../src/render/topCamera.js';
import { makeTerrain } from '../src/world/terrain.js';

const W = 800, H = 450;
const flat = () => 0, hills = makeTerrain(33).height;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

for (const [dist, yaw] of [[300, 0], [1400, 0.7], [2500, -2.2], [80, 3]]) {
  for (const [name, h] of [['flat', flat], ['hills', hills]]) {
    test(`screen to ground and back (${name}, ${dist} m, yaw ${yaw})`, () => {
      const c = settle(createTopCamera({ x: 120, z: -340, dist, yaw }), 1062, h);
      for (const [sx, sy] of [[W / 2, H / 2], [40, 30], [W - 10, H - 20], [W * 0.3, H * 0.8]]) {
        const g = screenToGround(c, sx, sy, W, H, h);
        assert.ok(g, `the ray at ${sx},${sy} hits the ground`);
        near(g.y, h(g.x, g.z), 0.05, 'it lands on the ground');
        const s = groundToScreen(c, g, W, H);
        near(s[0], sx, 0.5, 'x'); near(s[1], sy, 0.5, 'y');
      }
    });
  }
}

test('the focus is the middle of the screen, and bearing 0 is up it', () => {
  const c = createTopCamera({ dist: 1000 }), mid = groundToScreen(c, { x: 0, y: 0, z: 0 }, W, H);
  near(mid[0], W / 2, 1e-3, 'x'); near(mid[1], H / 2, 1e-3, 'y');
  const north = groundToScreen(c, { x: 0, y: 0, z: 200 }, W, H), east = groundToScreen(c, { x: -200, y: 0, z: 0 }, W, H);
  assert.ok(north[1] < H / 2, 'bearing 0 (+z) is up the screen');
  assert.ok(east[0] > W / 2, 'bearing 90 (-x) is to the right');
});

test('a drag keeps the ground under the finger', () => {
  for (const yaw of [0, 1, -2.5]) {
    const c = createTopCamera({ dist: 900, yaw }), from = [300, 200], to = [360, 260];
    const g = screenToGround(c, ...from, W, H, flat);
    panBy(c, to[0] - from[0], to[1] - from[1], H);
    const s = groundToScreen(c, g, W, H);
    near(s[0], to[0], 6, `x at yaw ${yaw}`); near(s[1], to[1], 6, `y at yaw ${yaw}`);
  }
});

test('zooming and turning keep the point under the pinch where it is', () => {
  const c = createTopCamera({ dist: 900, yaw: 0.4 }), at = [250, 150], g = screenToGround(c, ...at, W, H, flat);
  zoomAt(c, 0.5, g);
  let s = groundToScreen(c, g, W, H);
  near(s[0], at[0], 0.5, 'zoom x'); near(s[1], at[1], 0.5, 'zoom y');
  assert.equal(c.dist, 450);
  rotateAbout(c, 0.9, g);
  s = groundToScreen(c, g, W, H);
  near(s[0], at[0], 0.5, 'turn x'); near(s[1], at[1], 0.5, 'turn y');
  zoomAt(c, 1e-6); assert.equal(c.dist, 40, 'not nearer than 40 m');
  zoomAt(c, 1e6); assert.equal(c.dist, 3200, 'not further than 3200 m');
});

test('settle keeps the focus over the map and on the ground', () => {
  const c = settle(createTopCamera({ x: 5000, z: -5000 }), 1062, hills);
  assert.equal(c.x, 1062); assert.equal(c.z, -1062);
  assert.equal(c.y, hills(1062, -1062));
});
