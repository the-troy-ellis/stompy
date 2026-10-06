import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Particles, spawn, stepParticles, listParticles, PARTICLE_CAP } from '../src/sim/particles.js';
import { createTestGame, stepFor } from './helpers.js';

const game = (cap = 8) => ({ parts: new Particles(cap), rng: { next: () => 0.5 }, ter: { height: () => 0 } });
const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('spawning copies what it is given; the pool counts with length', () => {
  const G = game(), p = [1, 2, 3], v = [0, 1, 0], col = [1, 0.5, 0];
  spawn(G, p, v, 2, 0.5, col, 'smoke');
  p[0] = 99; col[0] = 0;
  const [q] = listParticles(G);
  assert.equal(G.parts.length, 1);
  assert.deepEqual(q.p, [1, 2, 3]); near(q.col[0], 1); assert.equal(q.kind, 'smoke'); assert.equal(q.max, 2);
});

test('a step ages, drags smoke, drops by gravity, bounces debris off the ground and spins', () => {
  const G = game();
  spawn(G, [0, 5, 0], [2, 0, 0], 1, 1, [1, 1, 1], 'smoke');
  spawn(G, [0, 0.05, 0], [0, -10, 0], 1, 1, [1, 1, 1], 'debris', 20);
  stepParticles(G, 0.1);
  const [smoke, debris] = listParticles(G);
  near(smoke.life, 0.9); near(smoke.v[0], 2 * (1 - 0.06)); near(smoke.p[0], 2 * 0.94 * 0.1);
  near(debris.p[1], 0, 1e-6); near(debris.v[1], -(-10 - 2) * 0.35);
  near(smoke.spin - Math.PI, 0.3);   // spawned at 0.5 * TAU, +3/s
});

test('expired particles drop out and the rest keep their own data', () => {
  const G = game();
  spawn(G, [1, 0, 0], [0, 0, 0], 0.05, 1, [1, 0, 0], 'fire');
  spawn(G, [2, 0, 0], [0, 0, 0], 5, 1, [0, 1, 0], 'smoke');
  spawn(G, [3, 0, 0], [0, 0, 0], 0.05, 1, [0, 0, 1], 'fire');
  spawn(G, [4, 0, 0], [0, 0, 0], 5, 1, [1, 1, 0], 'debris');
  stepParticles(G, 0.1);
  const left = listParticles(G).map(q => [q.kind, q.p[0], q.col[1]]).sort((a, b) => a[1] - b[1]);
  assert.deepEqual(left, [['smoke', 2, 1], ['debris', 4, 1]]);
});

test('a full pool overwrites instead of growing', () => {
  const G = game(3);
  for (let i = 0; i < 5; i++) spawn(G, [i, 0, 0], [0, 0, 0], 9, 1, [1, 1, 1], 'smoke');
  assert.equal(G.parts.length, 3);
  assert.deepEqual(listParticles(G).map(q => q.p[0]).sort(), [2, 3, 4], 'the two oldest went');
  assert.equal(new Particles().cap, PARTICLE_CAP);
});

test('a real match fills and empties the pool, and a new match clears it', () => {
  const G = createTestGame({ foes: ['jackal'] });
  for (let i = 0; i < 50; i++) spawn(G, [0, 1, 0], [0, 1, 0], 0.2, 1, [1, 1, 1], 'fire');
  assert.equal(G.parts.length, 50);
  stepFor(G, 0.5);
  assert.equal(listParticles(G).filter(q => q.kind === 'fire' && q.max === 0.2).length, 0, 'gone once their life runs out');
});
