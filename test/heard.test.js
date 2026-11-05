// Tunnelling in, part 4 (docs/specs/37-tunnelling.md): foes near a digger at
// work underground hear it. EASY: nothing. NORMAL: aware, believing you're
// near where they heard you. HARD: that, and the nearest goes to the spot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { heard, underground } from '../src/sim/under.js';
import { UNDER } from '../src/data/construct.js';
import { stepFor } from './helpers.js';

const game = diff => {
  const G = createGame({ fx: recordFx(), seed: 8 });
  G.diff = diff;
  startMatch(G, { name: 'Heard', pal: 'dusk', intel: '', foes: [{ type: 'jackal', at: [0, 300] }, { type: 'jackal', at: [10, 330] }, { type: 'jackal', at: [180, 700] }] }, 8, false, 'digger', { terrainOpts: { flat: true } });
  const P = G.player, foes = G.mechs.filter(m => m.team !== 0);
  Object.assign(P, { x: foes[0].x + 60, z: foes[0].z });
  const top = G.ter.height(P.x, P.z);
  for (const dx of [-6, 0, 6]) for (const dz of [-6, 0, 6]) G.ter.carve([P.x + dx, top - 20, P.z + dz], 7);   // a cave, so it stays down
  P.y = G.ter.groundBelow(P.x, top - 16, P.z);
  P.vy = 0;
  for (const f of foes) { f.ai.aware = false; f.ai.belief = null; f.ai.seen = false; }
  return { G, P, foes };
};
const said = G => G.fx.calls('say').map(c => c.args[0]);

test('EASY: nobody hears', () => {
  const { G, P, foes } = game('easy');
  heard(G, P, [P.x, P.y, P.z]);
  assert.ok(foes.every(f => !f.ai.aware));
});

test('NORMAL: foes within UNDER.hear become aware, believing you\'re within UNDER.blur of the bite; one far off doesn\'t', () => {
  const { G, P, foes } = game('normal');
  const p = [P.x, P.y, P.z];
  heard(G, P, p);
  for (const f of foes.slice(0, 2)) {
    assert.ok(f.ai.aware, 'aware');
    assert.ok(Math.hypot(f.ai.belief.x - p[0], f.ai.belief.z - p[2]) <= UNDER.blur + 1e-6, 'near the bite');
  }
  assert.equal(foes[2].ai.aware, false, 'too far to hear');
  assert.ok(!said(G).includes('They heard you.'), 'only HARD says so');
});

test('on the surface, nobody hears a bite', () => {
  const { G, P, foes } = game('hard');
  P.y = G.ter.height(P.x, P.z);
  heard(G, P, [P.x, P.y, P.z]);
  assert.ok(foes.every(f => !f.ai.aware));
});

test('HARD: the nearest goes to the very spot, searching; the voice says so once a tunnel', () => {
  const { G, P, foes } = game('hard');
  const p = [P.x, P.y, P.z];
  assert.ok(underground(G, P), 'down in the cave');
  heard(G, P, p); heard(G, P, p);
  const near = foes[0];
  assert.deepEqual([near.ai.belief.x, near.ai.belief.z], [p[0], p[2]]);
  assert.equal(near.ai.state, 'search');
  assert.equal(said(G).filter(t => t === 'They heard you.').length, 1);
  const d0 = Math.hypot(near.x - p[0], near.z - p[2]);
  for (let i = 0; i < 40; i++) { heard(G, P, p); stepFor(G, 0.25); }
  const d1 = Math.hypot(near.x - p[0], near.z - p[2]);
  assert.ok(d1 < 15, `it came over and waits: ${d0.toFixed(0)} m, then ${d1.toFixed(0)} m`);
});

test('a digger\'s own bite underground is what they hear', async () => {
  const { bite } = await import('../src/sim/dig.js');
  const { G, P, foes } = game('normal');
  bite(G, P, [P.x + 4, P.y + 3, P.z], 6);
  assert.ok(foes[0].ai.aware);
});
