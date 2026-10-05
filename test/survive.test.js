import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze, input, DT } from './helpers.js';
import { damage } from '../src/sim/combat.js';
import { spawnWave, waveFoes, WAVE_WARN } from '../src/sim/waves.js';

const { hypot } = Math;
function mission(def, diff = 'normal') {
  const G = createGame({ fx: recordFx(), seed: 4 });
  G.diff = diff;
  startMatch(G, { name: 'Test', pal: 'dusk', intel: '', foes: ['jackal'], ...def }, 4, false, 'kestrel', { terrainOpts: { flat: true } });
  for (const e of foes(G)) freeze(e);
  G.player.hp.T = 1e9; G.player.max.T = 1e9;   // the test is about the clock, not survival skills
  return G;
}
const HOLD = { objectives: [{ type: 'survive', seconds: 30, waves: [{ at: 0, foes: ['jackal'] }, { at: 10, foes: ['jackal', 'jackal'], from: 90 }, { at: 20, foes: ['warden'], from: 'nav_ridge' }] }],
  entities: [{ kind: 'nav', id: 'nav_ridge', at: [180, 400] }] };
const said = (G, line) => G.fx.calls('say').filter(c => c.args[0] === line).length;

test('SURVIVE: done when the clock runs out, with the time left on the objective as it counts down', () => {
  const G = mission(HOLD);
  const o = G.objectives[0];
  stepFor(G, 12);
  assert.equal(G.state, 'play');
  assert.ok(Math.abs(o.left - 18) < 0.1, `left ${o.left}`);
  for (const e of foes(G)) freeze(e);
  stepFor(G, 18.5, () => { for (const e of foes(G)) freeze(e); return input(); });   // keep the waves parked: this is about the clock
  assert.equal(o.state, 'done');
  assert.equal(G.state, 'over');
  assert.equal(G.won, true);
});

test('waves arrive on the clock, awake, each called in three seconds ahead (not the one at the start)', () => {
  const G = mission(HOLD);
  const n0 = foes(G).length;
  stepFor(G, DT * 2);
  assert.equal(foes(G).length, n0 + 1, 'the first wave arrives at once');
  assert.ok(foes(G).at(-1).ai.aware, 'and it knows where you are');
  assert.equal(said(G, 'Reinforcements inbound.'), 0, 'no call for the first');
  stepFor(G, 10 - WAVE_WARN - 0.1);
  assert.equal(said(G, 'Reinforcements inbound.'), 0);
  stepFor(G, 0.2);
  assert.equal(said(G, 'Reinforcements inbound.'), 1, 'called three seconds out');
  assert.equal(foes(G).length, n0 + 1, 'but not here yet');
  stepFor(G, WAVE_WARN);
  assert.equal(foes(G).length, n0 + 3);
  const east = foes(G).slice(-2);
  for (const m of east) assert.ok(m.x < -300, `the bearing-90 wave comes from the east (x ${m.x.toFixed(0)})`);
  stepFor(G, 10);
  const w = foes(G).at(-1);
  assert.equal(w.type, 'warden');
  assert.ok(hypot(w.x - 0, w.z + 400) < 60, 'the nav-point wave walks in from that point');
});

test('difficulty changes a wave by one mech, never the mechs themselves; the player dying still loses', () => {
  assert.deepEqual(waveFoes({ diff: 'easy' }, ['jackal', 'warden']), ['jackal']);
  assert.deepEqual(waveFoes({ diff: 'easy' }, ['jackal']), ['jackal'], 'never below one');
  assert.deepEqual(waveFoes({ diff: 'normal' }, ['jackal', 'warden']), ['jackal', 'warden']);
  assert.deepEqual(waveFoes({ diff: 'hard' }, ['jackal', 'warden']), ['jackal', 'warden', 'warden']);
  const G = mission(HOLD, 'hard');
  const [m] = spawnWave(G, ['jackal']);
  assert.equal(m.hp.T, 30, 'stock armour on HARD');
  G.player.hp.T = 1; G.player.max.T = 72;
  damage(G, G.player, [G.player.x, G.player.y + 5, G.player.z], 9999, m);
  stepFor(G, DT);
  assert.equal(G.won, false);
});
