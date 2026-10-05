import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze, createTestGame } from './helpers.js';
import { destroyEntity } from '../src/sim/entities.js';
import { objectiveRows, debriefTitle } from '../src/ui/debrief.js';

function mission(def) {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, { name: 'Test', pal: 'dusk', intel: '', foes: ['jackal'], ...def }, 4, false, 'kestrel', { terrainOpts: { flat: true } });
  for (const e of foes(G)) { freeze(e); Object.assign(e, { x: 900, z: -900 }); }
  return G;
}

test('the debrief ticks what got done and crosses what did not, secondaries flagged', () => {
  const G = mission({
    objectives: [{ type: 'destroy', targets: ['relay'], label: 'relay' }, { type: 'survive', seconds: 300, secondary: true }],
    entities: [{ kind: 'structure', id: 'r1', at: [0, 80], tags: ['relay'] }, { kind: 'structure', id: 'r2', at: [20, 90], tags: ['relay'] }],
  });
  for (const e of G.entities) destroyEntity(G, e, G.player);
  stepFor(G, 0.2);
  assert.equal(G.state, 'over');
  assert.equal(debriefTitle(G), 'MISSION COMPLETE');
  assert.deepEqual(objectiveRows(G), [
    { text: 'DESTROY RELAY 2/2', ok: true, secondary: false },
    { text: 'SURVIVE 5:00', ok: false, secondary: true },
  ]);
});

test('a failed objective reads MISSION FAILED, an unreached one is crossed', () => {
  const G = mission({
    objectives: [{ type: 'extract', at: 'lz', within: 1 }, { type: 'destroy', targets: ['tank'], label: 'TANK', after: 0 }],
    entities: [{ kind: 'nav', id: 'lz', at: [0, 900] }, { kind: 'structure', id: 't1', at: [90, 100], tags: ['tank'] }],
  });
  stepFor(G, 1.2);
  assert.equal(G.won, false);
  assert.equal(debriefTitle(G), 'MISSION FAILED');
  const rows = objectiveRows(G);
  assert.deepEqual(rows.map(r => [r.text, r.ok]), [['EXTRACT IN 0:01', false], ['DESTROY TANK 0/1', false]]);
});

test('losing the mech still reads MECH DESTROYED; plain missions list no rows', () => {
  const G = createTestGame();
  assert.deepEqual(objectiveRows(G), []);
  G.player.alive = false; G.won = false;
  assert.equal(debriefTitle(G), 'MECH DESTROYED');
});
