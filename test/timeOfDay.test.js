import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALS, palAt, blendPal } from '../src/data/palettes.js';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { missionDef } from '../src/data/missions.js';
import { stepFor, freeze, input } from './helpers.js';

const close = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

test('every biome has night and dawn; day and dusk are its own light', () => {
  for (const k of Object.keys(PALS)) {
    const day = palAt(k, 'day'), dusk = palAt(k, 'dusk'), night = palAt(k, 'night'), dawn = palAt(k, 'dawn'), plain = palAt(k);
    assert.deepEqual(day, dusk); assert.deepEqual(day, plain);
    assert.deepEqual(day.shade, [1, 1, 1]);
    assert.ok(night.shade.every(v => v > 0.2 && v < 0.7), `${k}: night dims, never to black`);
    assert.ok(lum(night.zen) < lum(day.zen) && lum(night.hor) < lum(day.hor), `${k}: a darker sky`);
    assert.ok(night.fog[1] < day.fog[1], `${k}: you see less far at night`);
    assert.ok(dawn.shade.every(v => v > 0.7 && v <= 1));
    for (const p of [night, dawn]) { assert.ok(Math.abs(Math.hypot(...p.light) - 1) < 1e-6); assert.equal(p.low, PALS[k].low, 'the ground colours are the biome\'s'); }
  }
});

test('palAt hands out copies: a ramp mutating one never touches the table', () => {
  const a = palAt('dusk', 'night');
  a.zen[0] = 99; a.shade[1] = 99;
  assert.notEqual(PALS.dusk.night.zen[0], 99); assert.notEqual(palAt('dusk', 'night').shade[1], 99);
});

test('blendPal moves sky, fog, light and shade from one time to the other', () => {
  const a = palAt('ice'), b = palAt('ice', 'night'), out = palAt('ice');
  blendPal(a, b, 0, out); assert.ok(close(out.zen, a.zen) && close(out.shade, a.shade) && close(out.fog, a.fog) && close(out.light, a.light));
  blendPal(a, b, 1, out); assert.ok(close(out.zen, b.zen) && close(out.shade, b.shade) && close(out.fog, b.fog) && close(out.light, b.light));
  blendPal(a, b, 0.5, out);
  assert.ok(Math.abs(out.fog[1] - (a.fog[1] + b.fog[1]) / 2) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...out.light) - 1) < 1e-6, 'the light stays a direction');
});

test('a mission picks its time; mission 4 turns from dusk to night over four minutes', () => {
  const play = n => { const G = createGame({ fx: recordFx(), seed: 1 }), d = missionDef(n); startMatch(G, d, d.seed, false, 'kestrel'); for (const k in G.player.hp) G.player.hp[k] = 1e6; return G; };
  const night8 = play(7);
  assert.ok(close(night8.pal.shade, PALS.ice.night.shade), 'mission 8 is at night');
  assert.equal(night8.palRamp, null);
  const G = play(3);
  assert.ok(close(G.pal.shade, [1, 1, 1]) && close(G.pal.zen, PALS.dusk.zen), 'it starts at dusk');
  const park = () => { for (const m of G.mechs) if (m.team) freeze(m); return input(); };
  stepFor(G, 120, park, 1 / 20);
  const mid = G.pal.shade[0];
  assert.ok(mid < 1 && mid > PALS.dusk.night.shade[0], `halfway: ${mid}`);
  stepFor(G, 130, park, 1 / 20);
  assert.ok(close(G.pal.shade, PALS.dusk.night.shade, 1e-4) && close(G.pal.zen, PALS.dusk.night.zen, 1e-4), 'night by four minutes, and it stays');
  assert.notEqual(PALS.dusk.zen[0], G.pal.zen[0], 'the table is untouched');
});
