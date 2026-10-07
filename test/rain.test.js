import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strikeAt, flashOf, LIGHTNING, WEATHER } from '../src/data/weather.js';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor } from './helpers.js';
import { makeWeatherBox, stepWeatherBox, BOX } from '../src/render/weatherBox.js';
import { shapeOf } from '../src/mesh/effects.js';

const game = (weather, seed = 7) => { const G = createGame({ fx: recordFx(), seed: 1 }); startMatch(G, { name: 'R', pal: 'dusk', foes: [], intel: '', weather }, seed, false, 'kestrel', { terrainOpts: { flat: true } }); return G; };

test('the lightning schedule is a pure function of the seed: every 8-20 s, the same on every screen', () => {
  const a = Array.from({ length: 30 }, (_, k) => strikeAt(12345, k)), b = Array.from({ length: 30 }, (_, k) => strikeAt(12345, k));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a[0], strikeAt(12346, 0), 'another seed, another storm');
  for (let k = 0; k < a.length; k++) {
    const gap = a[k].at - (k ? a[k - 1].at : 0);
    assert.ok(gap >= LIGHTNING.every[0] && gap <= LIGHTNING.every[1], `gap ${gap}`);
    assert.ok(a[k].dist >= 0 && a[k].dist < 1);
  }
});

test('in rain a strike flashes for 120 ms and its thunder rolls 0.5-3 s later; other weather has none', () => {
  const G = game('rain'), s = strikeAt(G.weather.seed, 0);
  stepFor(G, s.at + 0.03);
  assert.ok(flashOf(G) > 0.5, 'the flash');
  const thunderAt = s.at + LIGHTNING.thunder[0] + (LIGHTNING.thunder[1] - LIGHTNING.thunder[0]) * s.dist;
  assert.equal(G.fx.calls('sfx.thunder').length, 0, 'light first, sound after');
  stepFor(G, 0.2);
  assert.equal(flashOf(G), 0, 'over in 120 ms');
  stepFor(G, thunderAt - G.time + 0.05);
  const t = G.fx.calls('sfx.thunder');
  assert.equal(t.length, 1); assert.equal(t[0].args[0], s.dist, 'a far strike rumbles quieter');
  const D = game('dust');
  stepFor(D, 40, undefined, 1 / 20);
  assert.equal(D.fx.calls('sfx.thunder').length, 0); assert.equal(flashOf(D), 0);
  assert.ok(WEATHER.rain.dim < 1, 'rain darkens the light');
});

test('the rain box keeps its drops round the camera, falling, and brings them back ahead as you walk', () => {
  const B = makeWeatherBox(500), eye = [0, 10, 0], vel = [3, -22, 0];
  stepWeatherBox(B, eye, 400, vel, 0);
  assert.equal(B.n, 400);
  const inBox = () => { for (let i = 0; i < B.n; i++) { const x = B.pos[i * 3] - eye[0], y = B.pos[i * 3 + 1] - eye[1], z = B.pos[i * 3 + 2] - eye[2]; if (Math.abs(x) > BOX.half + 1e-6 || Math.abs(z) > BOX.half + 1e-6 || y < -BOX.down - 1e-6 || y > BOX.up + 1e-6) return false; } return true; };
  for (let f = 0; f < 120; f++) { eye[2] += 0.3; stepWeatherBox(B, eye, 400, vel, 1 / 30); }
  assert.ok(inBox(), 'after 4 s of walking, every drop is still in the box');
  const y0 = B.pos[1]; stepWeatherBox(B, eye, 400, vel, 0.01);
  assert.ok(B.pos[1] < y0 || B.pos[1] > y0 + 20, 'it falls (or wrapped to the top)');
  stepWeatherBox(B, eye, 100, vel, 0.01);
  assert.equal(B.n, 100, 'fewer when the setting asks for fewer');
});

test('rain is drawn as thin streaks, not the sparks\' slivers', () => {
  assert.equal(shapeOf('rain'), 'streak');
  assert.equal(shapeOf('spark'), 'sliver');
});
