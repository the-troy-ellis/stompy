import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, input } from './helpers.js';
import { spawnWave, revealing } from '../src/sim/waves.js';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { missionDef } from '../src/data/missions.js';

const { hypot } = Math;
// The player's felt footfalls (nearStep: a haptic pulse with no duck) from more than 40 m away.
const far = G => G.fx.calls('thump').filter(c => c.args[1] === 0 && c.args[2] > 0 && c.args[3] && hypot(c.args[3][0] - G.player.x, c.args[3][2] - G.player.z) > 40);   // only the one mech on the map

// A PURPLE PUNCHER making an entrance from 300 m ahead.
function entrance(reveal = 8) {
  const G = createTestGame({ foes: [] });
  for (const k in G.player.hp) G.player.hp[k] = 1e6;
  G.entities.push({ kind: 'nav', id: 'ridge', x: 0, z: 300, y: 0, tags: [], alive: true, trigger: 40 });
  const [m] = spawnWave(G, ['puncher'], { from: 'ridge', reveal });
  return [G, m];
}

test('an entrance walks straight in, guns quiet, for its reveal time; then it fights as usual', () => {
  const [G, m] = entrance(8);
  assert.ok(revealing(G, m));
  const d0 = hypot(m.x - G.player.x, m.z - G.player.z), shots0 = G.shots.length;
  stepFor(G, 7.5);
  assert.ok(revealing(G, m));
  assert.ok(hypot(m.x - G.player.x, m.z - G.player.z) < d0 - 30, 'it came closer');
  assert.equal(G.shots.length, shots0, 'not a shot while it walks in');
  assert.ok(G.mechs.filter(e => e.team).every(e => !e.beams?.some?.(b => b.on)), 'no beams either');
  stepFor(G, 1);
  assert.ok(!revealing(G, m), 'the show is over');
  assert.ok(m.ai.aware);
});

test('its footfalls are heard and felt from hundreds of metres while it walks in, and only then', () => {
  const [G, m] = entrance(8);
  stepFor(G, 6);
  assert.ok(hypot(m.x - G.player.x, m.z - G.player.z) > 100, 'still far off');
  assert.ok(far(G).length >= 3, `felt ${far(G).length} steps`);
  assert.ok(G.fx.calls('sfx.step').filter(c => c.args[0] === m).length >= 3, 'and heard');

  const [H] = entrance(0);
  stepFor(H, 6);
  assert.equal(far(H).length, 0, 'an ordinary wave is not felt from there');
});

test('m10: at two minutes the PURPLE PUNCHER enters off the ridge, walking', () => {
  const G = createGame({ fx: recordFx(), seed: 1 });
  const def = missionDef(9);
  startMatch(G, def, def.seed, false, 'kestrel'); G.kind = 'campaign';
  for (const k in G.player.hp) G.player.hp[k] = 1e6;
  stepFor(G, 120.5, () => { for (const e of foes(G)) if (e.type !== 'puncher') { e.alive = false; } return input(); }, 1 / 20);
  const p = G.mechs.find(e => e.type === 'puncher');
  assert.ok(p, 'it came');
  const ridge = G.entities.find(e => e.id === 'ridge');
  assert.ok(hypot(p.x - ridge.x, p.z - ridge.z) < 40, 'off the ridge');
  assert.ok(revealing(G, p));
});
