import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { blast, BLAST_R, HOLD_TO_GUIDE } from '../src/sim/missiles.js';
import { geoOf } from '../src/data/geo.js';
import { initFeet } from '../src/sim/gait.js';

test('blast damage falls off with distance from the body and never hurts the firer', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal', 'jackal'] });
  const [a, b, c] = foes(G), P = G.player;
  const R = geoOf(a).radius * a.ch.scale;
  Object.assign(a, { x: 200, z: 0 }); Object.assign(b, { x: 300, z: 0 }); Object.assign(c, { x: 400, z: 0 });
  for (const m of [a, b, c]) initFeet(G, m);
  const t0 = m => m.hp.T + m.hp.LA + m.hp.RA + m.hp.LL + m.hp.RL;
  const ha = t0(a), hb = t0(b), hc = t0(c), hp = t0(P);
  blast(G, [200 + R, 3, 0], 10, P, null);        // on a's skin: full splash
  blast(G, [300 + R + 5, 3, 0], 10, P, null);    // 5 m off b: half
  blast(G, [400 + R + 11, 3, 0], 10, P, null);   // out of range of c
  blast(G, [P.x, P.y + 3, P.z], 10, P, null);    // the firer's own position
  assert.ok(Math.abs(ha - t0(a) - 8) < 1e-6, `a took ${ha - t0(a)}`);
  assert.ok(Math.abs(hb - t0(b) - 4) < 1e-6, `b took ${hb - t0(b)}`);
  assert.equal(t0(c), hc);
  assert.equal(t0(P), hp);
  assert.equal(BLAST_R, 10);
});

test('a tap fires a volley of ten; a hold takes it over; release detonates it', () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 600 }); initFeet(G, e); freeze(e);
  stepFor(G, 1);   // weapons start with a staggered cooldown
  // Tap.
  stepFor(G, 1 / 60, input({ missileTap: true }));
  assert.equal(G.shots.filter(s => s.kind === 'missile' && s.owner === G.player).length, 10);
  assert.equal(G.guide, null);
  stepFor(G, 0.5);
  assert.equal(G.guide, null);
  // Hold past HOLD_TO_GUIDE: the next volley is yours to fly.
  const lrm = G.player.weapons.find(w => w.type === 'lrm'); lrm.cd = 0;
  stepFor(G, (HOLD_TO_GUIDE + 100) / 1000, input({ held: { missile: true } }));
  assert.ok(G.guide, 'guide did not start');
  assert.equal(G.guide.n, 10);
  assert.ok(G.fx.calls('sfx.beep').length >= 1);
  // Steering input turns the volley.
  const yaw0 = G.guide.yaw;
  stepFor(G, 0.5, input({ held: { missile: true }, twist: 1 }));
  assert.ok(G.guide.yaw > yaw0);
  // Let go: everything still flying detonates.
  stepFor(G, 1 / 60);
  assert.equal(G.guide, null);
  assert.equal(G.shots.filter(s => s.guided).length, 0);
});
