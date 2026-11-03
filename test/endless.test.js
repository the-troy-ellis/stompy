// ENDLESS (docs/specs/32-base-loop.md § Part 2): raids every ENDLESS.every,
// each a little bigger, called and shown like any raid; it runs until the
// silo falls, and the end says how long, how many mechs and how many raids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { ENDLESS_MISSION } from '../src/data/missions.js';
import { ENDLESS } from '../src/data/construct.js';
import { endlessWave, raidsDue } from '../src/sim/objectives.js';
import { destroyEntity } from '../src/sim/entities.js';
import { check } from '../src/data/missionIO.js';
import { endlessLine } from '../src/ui/screens.js';

const DT = 1 / 20;   // a coarse step: these are minutes of game
const game = () => {
  const G = createGame({ fx: recordFx(), seed: 8 });
  startMatch(G, ENDLESS_MISSION, ENDLESS_MISSION.seed, false, ENDLESS_MISSION.pilot);
  G.cheats = { god: true }; G.mode = 'sp';
  return G;
};
const run = (G, s, keep = false) => { for (let i = 0; i < s / DT && G.state === 'play'; i++) { if (keep) G.base.silo.hp = G.base.silo.max; update(G, noInput(), DT); } };   // keep: the silo mended each step, as if someone defended it
const said = G => G.fx.calls('say').map(c => c.args[0]);

test('the mission is a valid one', () => {
  assert.deepEqual(check(ENDLESS_MISSION).errors ?? [], []);
});

test('raids grow: the first is called RAID_WARN before ENDLESS.first, and never past ENDLESS.most', () => {
  const G = createGame({ fx: recordFx(), seed: 2 });
  const sizes = [1, 2, 3, 6, 10, 20, 40].map(n => endlessWave(G, n, 0).foes.length);
  assert.deepEqual(sizes, sizes.slice().sort((a, b) => a - b), 'never smaller');
  assert.equal(sizes[0], ENDLESS.base);
  assert.equal(sizes.at(-1), ENDLESS.most);
  const g = game();
  run(g, ENDLESS.first - 21);
  assert.ok(!said(g).some(l => l.startsWith('Raid')), 'not yet');
  run(g, 2);
  assert.ok(said(g).some(l => l.startsWith('Raid')), 'called');
  assert.equal(raidsDue(g).length, 1);
});

test('it keeps going while the silo stands, and ends when it falls, with the numbers', () => {
  const G = game();
  run(G, ENDLESS.first + ENDLESS.every * 2 + 5, true);
  assert.equal(G.state, 'play', 'no end while the silo stands');
  const o = G.objectives.find(x => x.def.type === 'endless');
  assert.equal(o.n, 3, 'three raids so far');
  destroyEntity(G, G.base.silo, null);
  run(G, 1);
  assert.equal(G.state, 'over'); assert.equal(G.won, false);
  G.base.made = 7;
  assert.match(endlessLine(G), /^YOU LASTED \d+:\d\d\. SEVEN MECHS MADE\. THREE RAIDS\.$/);
});
