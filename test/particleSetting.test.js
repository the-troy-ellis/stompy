import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { SETTINGS, readSetting, stepSetting, particleScales, PARTICLE_NAMES } from '../src/data/settings.js';
import { explode } from '../src/sim/effects.js';
import { listParticles } from '../src/sim/particles.js';
import { damage } from '../src/sim/combat.js';

// The PARTICLES setting (#165, spec 07 § Weather).
test('PARTICLES is a LOW / MED / HIGH dial; LOW has no weather particles; REDUCED MOTION takes a step off', () => {
  assert.deepEqual([0, 1, 2].map(v => SETTINGS.particles.fmt(v)), PARTICLE_NAMES);
  assert.equal(readSetting('particles', 7), 2); assert.equal(readSetting('particles', 'x'), 2);
  assert.equal(stepSetting('particles', 0, -1), 0); assert.equal(stepSetting('particles', 1, 1), 2);
  assert.deepEqual(particleScales(2), { weatherScale: 1, effectScale: 1 });
  assert.equal(particleScales(1).weatherScale, 0.6);
  assert.equal(particleScales(0).weatherScale, 0, 'LOW: no rain, snow or dust');
  assert.ok(particleScales(0).effectScale > 0, 'but explosions still show');
  assert.deepEqual(particleScales(2, true), particleScales(1));
  assert.deepEqual(particleScales(0, true), particleScales(0), 'LOW is the floor');
});

test('a lower setting makes fewer effect particles, evenly', () => {
  const count = scale => {
    const G = createTestGame();
    G.effectScale = scale; G.parts.clear();
    for (let i = 0; i < 20; i++) explode(G, [G.player.x + 40, G.player.y + 30, G.player.z], true);   // high up: no shockwave
    return listParticles(G).length;
  };
  const high = count(1), med = count(0.75), low = count(0.5);
  assert.ok(Math.abs(med / high - 0.75) < 0.02, `MED ${med} of ${high}`);
  assert.ok(Math.abs(low / high - 0.5) < 0.02, `LOW ${low} of ${high}`);
});

test('the fight plays out the same whatever the setting: the RNG runs the same', () => {
  const run = scale => {
    const G = createTestGame({ foes: ['jackal', 'jackal'], seed: 9 });
    G.effectScale = scale;
    const e = foes(G)[0];
    e.ai.aware = true; foes(G)[1].ai.aware = true;
    damage(G, e, [e.x, e.y + 5, e.z], 1000, G.player);
    stepFor(G, 6);
    return { next: G.rng.next(), mechs: G.mechs.map(m => [m.x, m.z, m.yaw, m.alive]) };
  };
  assert.deepEqual(run(0.5), run(1));
});
