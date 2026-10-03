import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { damage } from '../src/sim/combat.js';
import { DEBRIS_LIFE } from '../src/sim/effects.js';
import { geoOf } from '../src/data/geo.js';
import { VOICE } from '../src/data/voice.js';

const armPoint = (m, side) => [m.x + side * 2.5 * m.ch.scale, m.y + (geoOf(m).legTop + 1) * m.ch.scale, m.z];

test('a destroyed arm falls off as one piece that lands, lies still, and is gone after its life', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 80, yaw: 0, twist: 0 }); freeze(e);   // facing +z: +x is its left
  damage(G, e, armPoint(e, 1), e.hp.LA, G.player);               // exactly the arm, no overflow into the torso
  assert.equal(e.hp.LA, 0);
  const limbs = G.debris.filter(d => d.part !== 'plate');   // the hit itself knocks plates loose too
  assert.equal(limbs.length, 1);
  assert.equal(limbs[0].part, 'arm');
  stepFor(G, 3);
  const d = limbs[0];
  assert.ok(d.landed, 'still in the air');
  assert.ok(Math.abs(d.p[1] - 0.4 * e.ch.scale) < 1e-6, `rests at ${d.p[1]}`);
  stepFor(G, DEBRIS_LIFE);
  assert.equal(G.debris.filter(d => d.part !== 'plate').length, 0);
});

test('a lost leg sheds thigh, shin and foot, the mech limps with a dip and a lean, and keeps walking', () => {
  const G = createTestGame({ foes: [] });
  const P = G.player;
  // A whole-mech baseline first: the lowest bob while walking on two legs.
  let two = 0;
  for (let i = 0; i < 120; i++) { stepFor(G, 1 / 60, input({ thrUp: true })); two = Math.min(two, P.bob); }
  damage(G, P, [P.x + 1, P.y + 1, P.z], P.hp.LL, null);
  assert.equal(P.hp.LL, 0);
  assert.deepEqual(G.debris.filter(d => d.part !== 'plate').map(d => d.part), ['uleg', 'lleg', 'foot']);
  let one = 0, lean = 0;
  for (let i = 0; i < 240; i++) { stepFor(G, 1 / 60, input({ thrUp: true })); one = Math.min(one, P.bob); lean = P.lean; }
  assert.ok(one < two - 0.1, `no limp dip (${one} vs ${two})`);
  assert.ok(lean > 0.1, `no lean (${lean})`);
  assert.ok(P.speed > 0 && P.speed < P.ch.speed * 0.5);
  assert.ok(P.feet[0].lifted === false);
  assert.ok(G.fx.calls('say').some(c => c.args[0] === 'Left leg destroyed.' || VOICE.legLost.includes(c.args[0])));
});

test('with both legs gone the mech sits down, cannot move, still turns and fires, and the voice says so', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 150, yaw: Math.PI }); freeze(e);
  stepFor(G, 1);
  damage(G, P, [P.x + 1, P.y + 1, P.z], P.hp.LL, e);
  damage(G, P, [P.x - 1, P.y + 1, P.z], P.hp.RL, e);
  assert.equal(P.hp.LL + P.hp.RL, 0);
  assert.ok(P.alive);
  assert.ok(G.fx.calls('say').some(c => VOICE.legsLost.includes(c.args[0])));
  const z0 = P.z;
  stepFor(G, 2, input({ thrUp: true, twist: 1 }));
  assert.ok(Math.abs(P.z - z0) < 0.05, `moved ${P.z - z0}`);
  assert.ok(P.bob < -3, `hull not down (${P.bob})`);
  assert.ok(P.twist > 0.5, 'torso cannot turn');
  const shots = G.shots.length;
  stepFor(G, 1 / 60, input({ held: { ballistic: true } }));
  assert.ok(G.shots.length > shots, 'cannot fire');
});
