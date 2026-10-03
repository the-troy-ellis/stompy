import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { wrapA } from '../src/util/math.js';
import { canSee } from '../src/sim/ai/perception.js';
import { groupPass } from '../src/sim/ai/group.js';

const { hypot, atan2, abs } = Math;
const place = (G, m, x, z, yaw) => { Object.assign(m, { x, z, yaw }); initFeet(G, m); };
const wall = (G, lo, hi, h) => { const base = G.ter.height; G.ter = { ...G.ter, height: (x, z) => (x > lo && x < hi ? h : base(x, z)) }; };

test('enemies within 200 m of one another, by chain, form a group; the rest are their own', () => {
  const G = createTestGame({ foes: ['jackal', 'warden', 'jackal', 'warden'] });
  const [a, b, c, d] = foes(G);
  place(G, a, 0, 300, 0); place(G, b, 150, 300, 0); place(G, c, 300, 300, 0); place(G, d, 0, 800, 0);
  G.groupT = 0; groupPass(G, 1 / 60);
  assert.equal(a.ai.group.id, b.ai.group.id);
  assert.equal(b.ai.group.id, c.ai.group.id, 'c is 300 m from a but 150 m from b');
  assert.notEqual(a.ai.group.id, d.ai.group.id);
  assert.equal(a.ai.group.size, 3);
  assert.equal(d.ai.group.size, 1);
  assert.equal(d.ai.group.flank, false, 'alone, nobody flanks');
  const flankers = [a, b, c].filter(e => e.ai.group.flank);
  assert.equal(flankers.length, 1);
  assert.equal(flankers[0].ch.scale, 0.85, 'the lightest member flanks');
});

test('a group shares the freshest fix: a member that cannot see gets the contact at once', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal'] });
  const [a, b] = foes(G);
  a.ai.aware = false; b.ai.aware = false;
  wall(G, 100, 140, 60);
  place(G, a, 0, 200, Math.PI);
  place(G, b, 180, 200, 0);
  assert.equal(canSee(G, b, G.player), false);
  stepFor(G, 1.7);   // NORMAL's 0.8 s to react, then the next group pass; the shout would land at 1.8 s at the earliest
  assert.equal(a.ai.aware, true);
  assert.equal(b.ai.aware, true, 'the group should have told it');
  assert.ok(hypot(b.ai.belief.x, b.ai.belief.z) < 5, 'and where');
  assert.equal(b.ai.state, 'engage');
});

test('the lightest member of a group comes round the side; alone it comes straight on', () => {
  const heading = (G, e) => abs(wrapA(e.yaw - atan2(-e.x, -e.z)));
  const G = createTestGame({ seed: 9, foes: ['jackal', 'warden'] });
  const [j, w] = foes(G);
  G.player.hp.T = 1e9; G.player.max.T = 1e9;
  place(G, j, 0, 700, Math.PI); place(G, w, 120, 720, Math.PI);
  for (const e of [j, w]) e.ai.aware = true;
  stepFor(G, 4);
  assert.equal(j.ai.group.flank, true);
  assert.ok(heading(G, j) > 0.9, `the JACKAL should be heading off the bearing (${heading(G, j).toFixed(2)})`);
  assert.ok(heading(G, w) < 0.6, `the WARDEN should be heading in (${heading(G, w).toFixed(2)})`);
  const G2 = createTestGame({ seed: 9, foes: ['jackal'] });
  const lone = foes(G2)[0];
  G2.player.hp.T = 1e9; G2.player.max.T = 1e9;
  place(G2, lone, 0, 700, Math.PI); lone.ai.aware = true;
  stepFor(G2, 4);
  assert.equal(lone.ai.group.flank, false);
  assert.ok(heading(G2, lone) < 0.6, `a lone JACKAL should come straight on (${heading(G2, lone).toFixed(2)})`);
});
