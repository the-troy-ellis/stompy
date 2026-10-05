import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildEffectShapes, EFFECT_SHAPES, SHAPE_OF, shapeOf, effectLook } from '../src/mesh/effects.js';
import { mix3 } from '../src/util/math.js';
import { Particles, spawn } from '../src/sim/particles.js';

test('one small solid per effect kind, every kind mapped to a shape that exists', () => {
  const shapes = buildEffectShapes();
  for (const k of EFFECT_SHAPES) {
    const tris = shapes[k].d.length / 27;
    assert.ok(tris >= 4 && tris <= 16, `${k}: ${tris} triangles`);
  }
  for (const [kind, shape] of Object.entries(SHAPE_OF)) assert.ok(shapes[shape], `${kind} -> ${shape}`);
  assert.equal(shapeOf('smoke'), 'cube'); assert.equal(shapeOf('fire'), 'tetra'); assert.equal(shapeOf('debris'), 'chunk');
  assert.equal(shapeOf('something new'), 'cube', 'an unknown kind still draws');
});

test('effectLook keeps the old rules: fire shrinks and reddens, flame swells, smoke fades to the horizon', () => {
  const hor = [0.8, 0.5, 0.3], out = new Float32Array(6);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);   // the pool stores float32
  const check = (p, size, col, emis, heat) => {
    const P = new Particles(4), G = { parts: P, rng: { next: () => 0 } };
    spawn(G, [0, 0, 0], [0, 0, 0], p.max, p.size, p.col, p.kind);
    P.life[0] = p.life;
    const r = effectLook(P, 0, hor, out);
    assert.equal(r, out, 'writes into the given object, allocates nothing');
    near(r[0], size); near(r[1], col[0]); near(r[2], col[1]); near(r[3], col[2]); near(r[4], emis); near(r[5], heat);
  };
  const col = [1, 0.8, 0.2];
  check({ kind: 'fire', life: 0.5, max: 1, size: 2, col }, 2 * (0.4 + 0.5 * 0.8), mix3([0.4, 0.1, 0.05], col, 0.5), 1, 0.5);
  check({ kind: 'flame', life: 0.25, max: 1, size: 2, col }, 2 * (0.5 + 0.75 * 3), mix3([0.55, 0.12, 0.04], col, 0.25), 1, 0.25);
  check({ kind: 'smoke', life: 0.5, max: 2, size: 3, col }, 3 * (1.6 - 0.25 * 0.8), mix3(hor, col, 0.25), 0.6, 0.15);
  check({ kind: 'debris', life: 1, max: 2, size: 0.5, col: [0.2, 0.2, 0.2] }, 0.5, [0.2, 0.2, 0.2], 0, 0.3);
});

test('the look stays polygons: no textures and no blending anywhere in the renderer', () => {
  for (const f of readdirSync('src/render')) {
    const src = readFileSync(`src/render/${f}`, 'utf8');
    assert.ok(!/texImage2D|createTexture/.test(src), `${f} uses a texture`);
    assert.ok(!/gl\.BLEND|blendFunc/.test(src), `${f} blends`);
  }
});
