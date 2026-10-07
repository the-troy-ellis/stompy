import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { damage, makeWreck, DEATH_BEAT, DEATH_BUCKLE, DEATH_TOPPLE, WRECK_POPS, WRECK_BURN } from '../src/sim/combat.js';
import { explode, scorch, shedPart, SCORCH_MAX, SHOCK_LIFE, SHOCK_HEIGHT, DEBRIS_LIFE, DEBRIS_SINK } from '../src/sim/effects.js';
import { listParticles } from '../src/sim/particles.js';
import { effectLook, DITHER_KINDS, shapeOf, TUMBLE_BY_KIND } from '../src/mesh/effects.js';
import { KINDS } from '../src/sim/particles.js';

// Explosions and debris (docs/specs/07-atmosphere.md § Explosions; #163).
const kinds = G => new Set(listParticles(G).map(p => p.kind));

test('acceptance 5: a WARDEN blowing up makes a shockwave, plates that persist, a scorch and a secondary', () => {
  const G = createTestGame({ foes: ['warden', 'jackal'] });
  const e = foes(G)[0];
  freeze(foes(G)[1]);
  damage(G, e, [e.x, e.y + 5, e.z], 1000, G.player);
  stepFor(G, DEATH_BEAT + 0.05);
  assert.ok(kinds(G).has('shock'), 'a shockwave on the ground');
  const shock = listParticles(G).find(p => p.kind === 'shock');
  assert.ok(Math.abs(shock.p[1] - (G.ter.height(shock.p[0], shock.p[2]) + 0.3)) < 1e-3, 'lying on the ground');
  const plates = G.debris.filter(d => d.part === 'plate');
  assert.ok(plates.length >= 4, 'plates fly');
  assert.ok(G.scorches.length >= 1, 'a scorch under the blast');
  stepFor(G, DEATH_BUCKLE + DEATH_TOPPLE);
  assert.equal(G.wrecks.length, 1);
  const w = G.wrecks[0], booms = G.fx.calls('sfx.boom').length;
  assert.ok(G.scorches.some(s => Math.hypot(s.x - w.x, s.z - w.z) < 1 && s.r >= 5), 'a big scorch under the wreck');
  stepFor(G, WRECK_POPS + 0.1);
  assert.ok(G.fx.calls('sfx.boom').length >= booms + 2, 'at least two secondaries');
  assert.equal(w.pops.length, 0, 'every pop within its first seconds');
  stepFor(G, 10);
  assert.ok(plates.every(p => G.debris.includes(p)), 'the plates are still there after 14 s');
});

test('a wreck pops 2 to 4 times within 3 s, each with smoke; one with ammo also gets a big pop at 1-2 s', () => {
  const G = createTestGame({ foes: ['warden'] }), e = foes(G)[0];
  for (let i = 0; i < 40; i++) {
    const w = makeWreck(G, e, 0);
    assert.ok(w.pops.length >= 2 && w.pops.length <= 4);
    assert.ok(w.pops.every((t, k) => t > 0 && t <= WRECK_POPS && (k === 0 || t >= w.pops[k - 1])), 'in order, within 3 s');
  }
  assert.ok(e.weapons.some(w => w.def.ammo), 'the WARDEN carries ammunition');
  const armed = makeWreck(G, e, 0);
  assert.ok(armed.bigPop >= 1 && armed.bigPop <= 2);
  for (const w of e.weapons) if (w.def.ammo) w.ammo = 0;
  assert.equal(makeWreck(G, e, 0).bigPop, null, 'no ammo left, no big pop');
  // The big pop goes off when due: a big blast (a big shockwave) at the wreck.
  G.wrecks.push({ ...armed, x: e.x, y: e.y, z: e.z, pops: [], bigPop: 0.5 });
  e.alive = false; e.gone = true;
  G.parts.clear();
  stepFor(G, 0.55);
  const big = listParticles(G).filter(p => p.kind === 'shock');
  assert.ok(big.some(p => Math.abs(p.max - SHOCK_LIFE) < 1e-6 && p.size > 20), 'a big shockwave');
  assert.equal(G.wrecks.at(-1).bigPop, null);
});

test('a burning wreck smokes for 30 s and then stops', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal'] }), e = foes(G)[0];
  freeze(foes(G)[1]);
  G.wrecks.push({ ...makeWreck(G, e, 0), pops: [], bigPop: null });
  e.alive = false; e.gone = true;
  G.parts.clear();
  stepFor(G, 2);
  assert.ok(kinds(G).has('smoke'));
  stepFor(G, WRECK_BURN);
  G.parts.clear();
  stepFor(G, 2);
  assert.ok(!kinds(G).has('smoke'), 'burnt out');
});

test('a shockwave only under a blast near the ground; it lies flat, grows and dithers out in 0.4 s', () => {
  const G = createTestGame({ foes: ['jackal'] }), P = G.player, gy = G.ter.height(P.x + 30, P.z);
  G.parts.clear();
  explode(G, [P.x + 30, gy + 2, P.z], false);
  assert.equal(listParticles(G).filter(p => p.kind === 'shock').length, 1);
  G.parts.clear();
  explode(G, [P.x + 30, gy + SHOCK_HEIGHT + 5, P.z], false);
  assert.equal(listParticles(G).filter(p => p.kind === 'shock').length, 0, 'none for a blast high in the air');
  assert.ok(DITHER_KINDS.includes('shock'));
  assert.equal(shapeOf('shock'), 'ring');
  assert.equal(TUMBLE_BY_KIND[KINDS.indexOf('shock')], 0, 'it never tumbles');
  const life = SHOCK_LIFE, out = new Float32Array(7), Pz = { life: new Float32Array([life * 0.9, life * 0.1]), max: new Float32Array([life, life]), kind: new Uint8Array([KINDS.indexOf('shock'), KINDS.indexOf('shock')]), col: new Float32Array(6).fill(1), size: new Float32Array([10, 10]) };
  const early = effectLook(Pz, 0, [0, 0, 0], out)[0], late = effectLook(Pz, 1, [0, 0, 0], out)[0];
  assert.ok(late > early * 3, 'it grows');
  assert.ok(out[6] > 0.5, 'nearly dithered away at the end');
});

test('scorches: at most 64, the oldest goes; a blast where it is already black adds none', () => {
  const G = createTestGame({ foes: ['jackal'] });
  G.scorches.length = 0;
  const rev = G.scorchRev;
  scorch(G, 0, 0, 4);
  scorch(G, 1, 1, 2);
  assert.equal(G.scorches.length, 1, 'already black there');
  for (let i = 0; i < 80; i++) scorch(G, 100 + i * 20, 0, 3);
  assert.equal(G.scorches.length, SCORCH_MAX);
  assert.equal(G.scorches[0].x, 100 + 16 * 20, 'the oldest were dropped first');
  assert.ok(G.scorchRev > rev, 'the renderer hears about it');
  const yaws = G.scorches.map(s => s.yaw);
  assert.ok(yaws.every(y => y >= 0 && y < Math.PI * 2) && new Set(yaws).size > 10, 'turned this way and that');
});

test('a plate lies there 20 s, sinking into the ground over the last 2, then goes', () => {
  const G = createTestGame({ foes: ['jackal'] }), P = G.player;
  G.debris.length = 0;
  shedPart(G, P, 'plate', [P.x + 20, P.y + 3, P.z], [0, 0, 0]);
  const d = G.debris[0];
  stepFor(G, 5);
  assert.ok(d.landed);
  const lying = d.p[1];
  stepFor(G, DEBRIS_LIFE - DEBRIS_SINK - 5 - 0.1);
  assert.equal(d.p[1], lying, 'still in place before the sink');
  stepFor(G, DEBRIS_SINK * 0.9);
  assert.ok(d.p[1] < lying - 0.5 * d.scale, 'sinking');
  stepFor(G, 0.5);
  assert.ok(!G.debris.includes(d), 'gone at 20 s');
});
