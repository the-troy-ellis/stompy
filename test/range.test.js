// The DEBUG tab's test range (docs/specs/19-debug-menu.md § Test range): each
// ground builds what it says, the foes stand on the arc clear of the
// landmark, STANDING STILL foes stand still, and nothing ends the range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { polar } from '../src/sim/placement.js';
import { dig } from '../src/sim/dig.js';
import { destroy } from '../src/sim/combat.js';
import { RANGE_GROUNDS, rangeDef, rangeSpot, RANGE_MAX } from '../src/data/range.js';
import { stepFor } from './helpers.js';

const { hypot, abs } = Math;
const range = opts => {
  const G = createGame({ fx: recordFx(), seed: 5 });
  startMatch(G, rangeDef(opts), 5, false, 'kestrel', { terrainOpts: { flat: true } });
  G.kind = 'range';
  return G;
};

test('every ground builds, and you start on flat ground at the centre', () => {
  for (const { key } of RANGE_GROUNDS) {
    const G = range({ ground: key });
    assert.ok(abs(G.player.y) < 1 && hypot(G.player.x, G.player.z) < 1, `${key}: at the centre, on the flat`);
  }
});

test('the arch\'s crown, the tunnel\'s floor, the cave\'s mouth and the pillar\'s slab are where they should be', () => {
  const a = polar([0, 220]);
  assert.ok(range({ ground: 'arch' }).ter.solid(a.x, 40, a.z), 'the arch crown is up');
  const t = polar([0, 260]), T = range({ ground: 'tunnel' }).ter;
  assert.ok(T.solid(t.x, 60, t.z), 'the mesa is there');
  assert.ok(!T.solid(t.x, 8, t.z) && T.groundBelow(t.x, 8, t.z) < 4, 'with a tunnel through it, at the bottom');
  const c = polar([0, 245]), C = range({ ground: 'cave' }).ter;
  assert.ok(!C.solid(c.x, 6, c.z) && C.solid(c.x, 40, c.z), 'the cave goes back into the hill');
  const p = polar([0, 180]), P = range({ ground: 'pillar' });
  assert.ok(P.ter.solid(p.x, 20, p.z), 'the pillar');
  assert.ok(P.ter.solid(p.x + 24, 44, p.z + 24) && !P.ter.solid(p.x + 24, 20, p.z + 24), 'the slab hangs out over air');
  dig(P, [p.x, 2, p.z + 20], 5);
  assert.equal(P.falls.length, 0, 'whole, the pillar holds the slab (the torque rule)');
  const A = range({ ground: 'all' }).ter;
  for (const [b, d, y] of [[0, 300, 40], [72, 300, 100], [144, 300, 60], [216, 390, 30], [288, 300, 20]]) { const q = polar([b, d]); assert.ok(A.solid(q.x, y, q.z), `ALL OF THEM: something at ${b}°`); }
});

test('foes stand on the arc in front, clear of the landmark', () => {
  const types = Array(RANGE_MAX).fill('jackal'), G = range({ ground: 'arch', foes: types, mode: 'awake' }), foes = G.mechs.filter(m => m.team === 1);
  assert.equal(foes.length, RANGE_MAX);
  for (const [i, e] of foes.entries()) {
    const [b, d] = rangeSpot(i);
    assert.ok(abs(hypot(e.x, e.z) - d) < 1 && abs(b) >= 30 && abs(b) < 90, `foe ${i} at ${b}°, ${d} m: in front, off to the side`);
    assert.ok(e.ai.aware, 'AWAKE: already after you');
  }
  assert.equal(range({ ground: 'flat', foes: ['jackal'], mode: 'none' }).mechs.length, 1, 'NONE: just you');
});

test('STANDING STILL foes do not move in 10 s, and still die to shots', () => {
  const G = range({ ground: 'flat', foes: ['jackal', 'warden'], mode: 'still' }), foes = G.mechs.filter(m => m.team === 1);
  const at = foes.map(e => [e.x, e.z, e.yaw]);
  G.player.x = foes[0].x * 0.5; G.player.z = foes[0].z * 0.5;   // close, in plain sight
  stepFor(G, 10);
  foes.forEach((e, i) => assert.ok(hypot(e.x - at[i][0], e.z - at[i][1]) < 0.5 && !e.ai.aware && G.player.hp.T === G.player.max.T, `foe ${i} stood still and held fire`));
  destroy(G, foes[0], G.player);
  assert.ok(!foes[0].alive);
});

test('nothing ends a range: no objectives, and every foe dead is not a win', () => {
  const G = range({ ground: 'flat', foes: ['jackal'], mode: 'still' });
  for (const e of G.mechs.filter(m => m.team === 1)) destroy(G, e, G.player);
  stepFor(G, 5);
  assert.equal(G.state, 'play');
});
