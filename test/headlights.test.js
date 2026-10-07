import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PALS, palAt, darkness, NIGHT_SIGHT } from '../src/data/palettes.js';
import { sightOf, canSee } from '../src/sim/ai/perception.js';
import { DIFF } from '../src/data/ai.js';
import { stateMessage, PROTOCOL } from '../src/net/protocol.js';
import { createTestGame } from './helpers.js';
import { buildMechParts, lampSpots } from '../src/mesh/mechParts.js';
import { CHASSIS } from '../src/data/chassis.js';

test('darkness: nothing by day, dusk or dawn; nearly full at night in every biome', () => {
  for (const k of Object.keys(PALS)) {
    assert.equal(darkness(palAt(k, 'day')), 0); assert.equal(darkness(palAt(k, 'dawn')), 0, `${k} dawn`);
    assert.ok(darkness(palAt(k, 'night')) > 0.8, `${k} night: ${darkness(palAt(k, 'night'))}`);
  }
  assert.equal(darkness(undefined), 0);
});

test('at night the AI sees 250 m, or 600 m toward lights; never further than by day', () => {
  const G = createTestGame({ foes: [] }), P = G.player;
  G.diff = 'normal';
  G.pal = palAt('dusk');
  assert.equal(sightOf(G, P), DIFF.normal.sight, 'day: as ever');
  G.pal = { ...palAt('dusk', 'night'), shade: [0, 0, 0] };   // fully dark
  P.lights = true; assert.equal(sightOf(G, P), Math.min(DIFF.normal.sight, NIGHT_SIGHT.lit));
  P.lights = false; assert.equal(sightOf(G, P), NIGHT_SIGHT.dark);
  P.lights = true; P.shutdown = true; assert.equal(sightOf(G, P), NIGHT_SIGHT.dark, 'a dead reactor has no lights');
  P.shutdown = false; G.diff = 'easy';
  assert.equal(sightOf(G, P), Math.min(DIFF.easy.sight, NIGHT_SIGHT.lit), 'lights never see further than by day');
  G.diff = 'normal'; P.lights = false;
  const mid = { ...palAt('dusk'), shade: [0.65, 0.65, 0.65] };   // half dark, mid ramp
  G.pal = mid;
  const s = sightOf(G, P);
  assert.ok(s < DIFF.normal.sight && s > NIGHT_SIGHT.dark, `${s}`);
});

test('a JACKAL 400 m off sees a lit mech at night and loses a dark one', () => {
  const G = createTestGame({ foes: [] }), P = G.player;
  G.pal = { ...palAt('ice', 'night'), shade: [0, 0, 0] };
  const e = { ...G.player, x: 0, z: 400, y: 0, ch: P.ch, ai: {} };
  P.lights = true; assert.equal(canSee(G, e, P), true);
  P.lights = false; assert.equal(canSee(G, e, P), false);
});

test('the arena carries the lights: lt in the state message, PROTOCOL 7 or later', () => {
  const G = createTestGame({ foes: [] }), P = G.player;
  assert.ok(PROTOCOL >= 7);
  P.lights = true; assert.equal(stateMessage(P, 1).lt, 1);
  P.lights = false; assert.equal(stateMessage(P, 1).lt, 0);
});

test('every chassis has two headlamps on its torso front, one each side', () => {
  for (const [k, ch] of Object.entries(CHASSIS)) {
    const p = buildMechParts(ch), [a, b] = lampSpots(p);
    let zMax = -Infinity; for (let i = 2; i < p.torso.d.length; i += 9) zMax = Math.max(zMax, p.torso.d[i]);
    assert.ok(a[2] > zMax && b[2] > zMax && a[2] - zMax < 0.1, `${k}: on the front face`);
    assert.ok(a[0] > b[0] && Math.abs(a[1] - b[1]) < 1e-9, `${k}: a pair, level`);
  }
});

test('the headlights are one spot in the shared fragment shader, fed by every lit mech and terrain shader', () => {
  const gl = readFileSync('src/render/gl.js', 'utf8');
  assert.match(gl, /uniform float uSpotOn/);
  assert.equal((gl.match(/vWorld = wp\.xyz;/g) || []).length, 2, 'the per-part and the skinned shader both feed it');
  assert.match(gl, /vBase = base \* \(1\.0 - uEmis\)/, 'glowing things are not lit by it');
});
