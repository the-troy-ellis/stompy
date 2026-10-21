// Build and fight, the mission (docs/specs/20-build-and-fight.md § The
// mission): you start in the digger with a KESTREL, the silo and a mesa to
// dig; three raids, each bigger; the last one beaten with the silo up wins,
// the silo down loses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { destroy } from '../src/sim/combat.js';
import { damageEntity } from '../src/sim/entities.js';
import { BASE_MISSION, FP_MAPS } from '../src/data/missions.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { polar } from '../src/sim/placement.js';
import { check } from '../src/data/missionIO.js';
import { stepFor } from './helpers.js';

const game = () => {
  const G = createGame({ fx: recordFx(), seed: BASE_MISSION.seed });
  startMatch(G, BASE_MISSION, BASE_MISSION.seed, false, BASE_MISSION.pilot);
  return G;
};
const raiders = G => G.mechs.filter(m => m.team === 1);

test('you start in the digger, a KESTREL parked by you, the silo up with some ore in it', () => {
  const G = game();
  assert.equal(G.player.type, 'digger');
  assert.deepEqual(G.crew.map(m => m.type), ['digger', 'kestrel']);
  assert.ok(G.crew[1].parked);
  assert.ok(G.base.silo.alive);
  assert.equal(G.base.ore, CONSTRUCT.startOre);
  assert.equal(raiders(G).length, 0, 'nobody yet');
});

test('there is rock to dig in the mesa ahead, under its soft skin', () => {
  const G = game(), c = polar(BASE_MISSION.ground.landmarks[0].at);
  const y = G.ter.groundBelow(G.player.x, 50, G.player.z) + 10;
  assert.ok(G.ter.solid(c.x, y, c.z), 'the mesa stands there');
  const d = Math.hypot(c.x - G.player.x, c.z - G.player.z);
  assert.ok(d < 260, `near the start (${d.toFixed(0)} m)`);
});

test('three raids, each bigger, all called and sent at the base', () => {
  const w = BASE_MISSION.waves;
  assert.equal(w.length, 3);
  assert.ok(w.every(x => x.raid && typeof x.from === 'number'));
  assert.ok(w[0].foes.length < w[1].foes.length && w[1].foes.length <= w[2].foes.length);
  assert.ok(w[0].at < w[1].at && w[1].at < w[2].at);
});

test('beating the last raid with the silo up wins', () => {
  const G = game();
  for (let i = 0; i < 3; i++) {
    G.waves[i].due = G.time + 0.2; G.waves[i].warned = true;
    stepFor(G, 0.5);
    assert.equal(G.state, 'play', `raid ${i + 1} is on`);
    for (const e of raiders(G)) if (e.alive) destroy(G, e, G.player);
    stepFor(G, 0.5);
    if (i < 2) assert.equal(G.state, 'play', 'not while a raid is still to come');
  }
  stepFor(G, 0.5);
  assert.equal(G.state, 'over');
  assert.equal(G.won, true);
});

test('the silo falling loses it', () => {
  const G = game();
  stepFor(G, 0.2);
  damageEntity(G, G.base.silo, CONSTRUCT.siloHp * 2, null);
  stepFor(G, 0.3);
  assert.equal(G.state, 'over');
  assert.equal(G.won, false);
});

test('it checks clean, and Free Play\'s MAP offers it as BASE', () => {
  assert.deepEqual(check(BASE_MISSION), []);
  assert.ok(FP_MAPS.includes('base'));
});
