import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER, WEATHER_KINDS, RADAR_RANGE, makeWeather, fogOf, radarOf } from '../src/data/weather.js';
import { palAt } from '../src/data/palettes.js';
import { sightOf } from '../src/sim/ai/perception.js';
import { DIFF } from '../src/data/ai.js';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { createTestGame } from './helpers.js';
import { spawn, stepParticles, listParticles } from '../src/sim/particles.js';
import { missionDef, fpWeather } from '../src/data/missions.js';

const game = (weather, pal = 'ice') => { const G = createGame({ fx: recordFx(), seed: 1 }); startMatch(G, { name: 'W', pal, foes: [], intel: '', weather }, 9, false, 'kestrel', { terrainOpts: { flat: true } }); return G; };

test('the spec 07 table: fog and radar factors per kind; clear changes nothing', () => {
  assert.deepEqual(WEATHER_KINDS, ['clear', 'rain', 'snow', 'dust', 'fog']);
  const want = { clear: [1, 1], rain: [0.7, 0.9], snow: [0.5, 0.8], dust: [0.35, 0.5], fog: [0.3, 0.6] };
  for (const [k, [f, r]] of Object.entries(want)) {
    const G = game(k), base = palAt('ice').fog, fog = fogOf(G);
    assert.ok(Math.abs(fog[0] - base[0] * f) < 1e-9 && Math.abs(fog[1] - base[1] * f) < 1e-9, `${k} fog`);
    assert.equal(radarOf(G), r, `${k} radar`);
  }
  assert.equal(game(undefined).weather.kind, 'clear', 'no weather is clear');
  assert.equal(game('hail').weather.kind, 'clear', 'an unknown kind is clear');
  assert.equal(Math.hypot(...game('clear').weather.wind), 0, 'clear is calm');
  assert.equal(RADAR_RANGE, 800);
});

test('intensity scales the factors; the wind is fixed by the seed', () => {
  const half = { pal: palAt('ice'), weather: makeWeather('fog', 3, 0.5) };
  assert.ok(Math.abs(radarOf(half) - 0.8) < 1e-9);
  assert.ok(Math.abs(fogOf(half)[1] - palAt('ice').fog[1] * 0.65) < 1e-9);
  const a = makeWeather('dust', 42), b = makeWeather('dust', 42), c = makeWeather('dust', 43);
  assert.deepEqual(a.wind, b.wind); assert.notDeepEqual(a.wind, c.wind);
  assert.ok(Math.abs(Math.hypot(...a.wind) - WEATHER.dust.wind) < 1e-9);
});

test('the AI sees as far as the radar reaches: fog cuts it to 60%', () => {
  const G = createTestGame({ foes: [] });
  G.diff = 'normal'; G.pal = palAt('ice');
  G.weather = makeWeather('clear'); assert.equal(sightOf(G, G.player), DIFF.normal.sight);
  G.weather = makeWeather('fog'); assert.ok(Math.abs(sightOf(G, G.player) - DIFF.normal.sight * 0.6) < 1e-9);
});

test('wind carries smoke (and so missile trails); debris and calm air do not drift', () => {
  const run = (weather, kind) => { const G = game(weather); spawn(G, [0, 5, 0], [0, 0, 0], 5, 1, [0.5, 0.5, 0.5], kind); for (let i = 0; i < 60; i++) stepParticles(G, 1 / 30); const p = listParticles(G)[0]; return [p.p[0], p.p[2], G.weather.wind]; };
  const [x, z, w] = run('dust', 'smoke');
  assert.ok((x * w[0] + z * w[1]) / Math.hypot(...w) > 3, 'downwind');
  const [cx, cz] = run('clear', 'smoke');
  assert.ok(Math.hypot(cx, cz) < 1e-9, 'still air: it rises straight');
  const [dx, dz] = run('dust', 'debris');
  assert.ok(Math.hypot(dx, dz) < 1e-9, 'debris is too heavy to blow');
});

test('missions carry their weather; Free Play RANDOM picks one that suits the map', () => {
  for (const [n, k] of [[4, 'fog'], [6, 'snow'], [9, 'dust']]) {
    const G = createGame({ fx: recordFx(), seed: 1 }), d = missionDef(n);
    startMatch(G, d, d.seed, false, 'kestrel');
    assert.equal(G.weather.kind, k, d.key);
  }
  let i = 0; const seq = [0.9, 0.1, 0.9, 0.7, 0.3, 0.6, 0.2], rand = () => seq[i++ % seq.length];
  for (let t = 0; t < 20; t++) for (const biome of ['dusk', 'ice', 'volcanic']) {
    const k = fpWeather('random', biome, rand);
    assert.ok(WEATHER[k].biomes.includes(biome), `${k} in ${biome}`);
  }
  assert.equal(fpWeather('rain', 'ice', rand), 'rain', 'a chosen kind is the player\'s call');
});

test('snow whitens the sky and falls as the snow shape; fog and dust grey the zenith', async () => {
  const { readFileSync } = await import('node:fs');
  const { shapeOf } = await import('../src/mesh/effects.js');
  assert.ok(WEATHER.snow.whiten > 0);
  assert.ok(WEATHER.fog.haze > 0 && WEATHER.dust.haze > 0);
  const scene = readFileSync('src/render/scene.js', 'utf8');
  assert.match(scene, new RegExp(`snow: \\{ shape: '${shapeOf('snow')}'`), 'snow drawn as the snow effect shape');
  assert.match(scene, new RegExp(`rain: \\{ shape: '${shapeOf('rain')}'`));
});
