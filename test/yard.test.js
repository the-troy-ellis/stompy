// The yard (docs/specs/19-debug-menu.md § The yard): the DEBUG tab's place to
// try mining and construction. You in a digger, a second digger and a hauler
// parked by you, the silo and a mesa to dig; nobody comes, and it never ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { YARD_MISSION, missionFoes } from '../src/data/missions.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { check } from '../src/data/missionIO.js';
import { stepFor } from './helpers.js';

const game = () => {
  const G = createGame({ fx: recordFx(), seed: YARD_MISSION.seed });
  startMatch(G, YARD_MISSION, YARD_MISSION.seed, false, YARD_MISSION.pilot);
  return G;
};

test('you start in a digger, a digger and a hauler parked by you, the silo up', () => {
  const G = game();
  assert.equal(G.player.type, 'digger');
  assert.deepEqual(G.crew.map(m => m.type), ['digger', 'digger', 'hauler']);
  assert.ok(G.crew.slice(1).every(m => m.parked));
  assert.ok(G.base.silo.alive);
  assert.equal(G.base.ore, CONSTRUCT.startOre);
});

test('nobody comes, and it stays open', () => {
  assert.equal(missionFoes(YARD_MISSION).length, 0);
  const G = game();
  stepFor(G, 600);
  assert.equal(G.mechs.filter(m => m.team === 1).length, 0, 'no foes after ten minutes');
  assert.equal(G.state, 'play');
});

test('it checks clean', () => {
  assert.deepEqual(check(YARD_MISSION), []);
});
