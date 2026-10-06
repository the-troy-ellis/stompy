import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze, createTestGame } from './helpers.js';
import { destroyEntity } from '../src/sim/entities.js';
import { objectiveRows, debriefTitle, missionTitle, missionSpoken, verdict, verdictKey } from '../src/ui/debrief.js';
import { destroy } from '../src/sim/combat.js';
import { NAMES } from '../src/data/names.js';

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

test('a mission still on its placeholder name is not announced twice', () => {
  assert.equal(missionTitle(2, 'MISSION 2'), 'MISSION 2');
  assert.equal(missionTitle(2, 'Tower Trouble'), 'MISSION 2: TOWER TROUBLE');
  assert.equal(missionTitle(13, 'Contract 13'), 'CONTRACT 13', 'a contract is not also a mission');
  assert.equal(missionSpoken(13, 'Contract 13'), 'Contract 13.');
  assert.equal(missionSpoken(2, 'MISSION 2'), 'Mission 2.');
  assert.equal(missionSpoken(2, 'Tower Trouble'), 'Mission 2. Tower Trouble.');
});

// The verdict word (spec 04 § Debrief verdicts).
const fight = () => { const G = createTestGame({ foes: ['jackal'] }); return [G, foes(G)[0]]; };
const finish = G => stepFor(G, 0.2);

test('a win reads STOMPED., UNTOUCHED. without a scratch, PUNCHED. when a fist ended it', () => {
  let [G, e] = fight();
  G.stats.taken = 12; destroy(G, e, G.player); finish(G);
  assert.equal(G.won, true);
  assert.equal(verdictKey(G), 'won'); assert.equal(verdict(G), NAMES.verdicts.won);
  [G, e] = fight();
  destroy(G, e, G.player); finish(G);
  assert.equal(verdictKey(G), 'untouched');
  [G, e] = fight();
  G.stats.taken = 3; e.lastHitMelee = 'punch'; destroy(G, e, G.player); finish(G);
  assert.equal(verdictKey(G), 'punched');
  [G, e] = fight();
  G.stats.taken = 3; e.lastHitMelee = 'stomp'; destroy(G, e, G.player); finish(G);
  assert.equal(verdictKey(G), 'won', 'a stomp is just stomping');
});

test('a loss reads SQUASHED., FLATTENED. under a foot, AWKWARD. when both of you overheated', () => {
  let [G, e] = fight();
  destroy(G, G.player, e);
  assert.equal(G.won, false); assert.equal(verdictKey(G), 'lost');
  [G, e] = fight();
  G.player.lastHitMelee = 'stomp'; destroy(G, G.player, e);
  assert.equal(verdictKey(G), 'flattened');
  [G, e] = fight();
  G.player.shutdown = true; e.shutdown = true; G.player.lastHitMelee = 'stomp'; destroy(G, G.player, e);
  assert.equal(verdictKey(G), 'awkward', 'awkward beats flattened');
  [G, e] = fight();
  G.player.shutdown = true; destroy(G, G.player, e);
  assert.equal(verdictKey(G), 'lost', 'cooked alone is just a loss');
});

test('a failed objective with the mech still standing is SQUASHED.; a new match forgets the last one', () => {
  const G = mission({ objectives: [{ type: 'extract', at: 'lz', within: 1 }], entities: [{ kind: 'nav', id: 'lz', at: [0, 900] }] });
  stepFor(G, 1.2);
  assert.equal(verdictKey(G), 'lost');
  const [H, e] = fight();
  H.player.lastHitMelee = 'stomp'; destroy(H, H.player, e);
  startMatch(H, { name: 'Again', pal: 'dusk', foes: ['jackal'], intel: '' }, 2, false, 'kestrel');
  assert.equal(H.death, null); assert.equal(H.lastKill, null);
});

test('every verdict is one word and a full stop', () => {
  for (const [k, v] of Object.entries(NAMES.verdicts)) assert.match(v, /^[A-Z]+\.$/, k);
});
