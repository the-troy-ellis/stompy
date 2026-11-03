// Defend from above, walls and the TOWER (docs/specs/32-base-loop.md § Part
// 2): a raider with a wall slab across its way shoots the wall; a built tower
// turns and shoots raiders in range by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { footprintAt, placeSite } from '../src/sim/base.js';
import { spawnWave } from '../src/sim/waves.js';
import { raidTarget, wallInWay } from '../src/sim/raid.js';
import { TOWER } from '../src/data/construct.js';
import { shiftMech } from '../src/sim/walkView.js';
import { initFeet } from '../src/sim/gait.js';
import { freeze } from './helpers.js';

const DT = 1 / 60;
const game = () => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', crew: 'kestrel', base: 'silo' }), 4, false, 'kestrel', { terrainOpts: { flat: true } });
  for (const m of G.crew) shiftMech(m, 900 - m.x, 900 - m.z);   // nobody near: raiders go for buildings
  return G;
};
const run = (G, s) => { for (let i = 0; i < s / DT; i++) update(G, noInput(), DT); };
// A site put down and finished at once, as diggers and haulers would.
const up = (G, kind, x, z, yaw = 0) => {
  const f = footprintAt(G, x, z, yaw, kind);
  assert.equal(f.why, null, `${kind} fits at ${x}, ${z}`);
  const s = placeSite(G, f);
  s.ore = s.need; s.work = s.swings;
  run(G, 0.1);
  return s.parts;
};
const raider = (G, x, z) => { const [e] = spawnWave(G, ['jackal'], { from: 90, raid: true }); shiftMech(e, x - e.x, z - e.z); initFeet(G, e); return e; };

test('a wall slab across a raider\'s way, close, is what it shoots; one off to the side, or far, is not', () => {
  const G = game(), s = G.base.silo;
  const slabs = up(G, 'wall', s.x + 60, s.z, Math.PI / 2);   // across the line from the east
  const e = raider(G, s.x + 75, s.z);
  const t = raidTarget(G, e);
  assert.ok(slabs.includes(t), `the wall in the way: ${t?.tags}`);
  const far = raider(G, s.x + 200, s.z);
  assert.equal(wallInWay(G, far, s), null, 'more than RAID_WALL off: walk on');
  const side = raider(G, s.x + 75, s.z + 60);
  assert.ok(!slabs.includes(raidTarget(G, side)), 'not across its line');
});

test('a built tower turns and shoots a raider in range with a clear line; its hits are the tower\'s', () => {
  const G = game(), s = G.base.silo, [tower] = up(G, 'tower', s.x - 60, s.z);
  assert.ok(G.base.towers.includes(tower));
  const e = raider(G, tower.x - (TOWER.range - 30), tower.z);   // the far side from the silo: nothing of ours between
  freeze(e);
  const sum = () => Object.values(e.hp).reduce((a, b) => a + b, 0), hp = sum();
  let fired = false;
  for (let i = 0; i < 12 / DT; i++) { update(G, noInput(), DT); if (G.shots.some(sh => sh.owner === tower)) fired = true; }
  assert.ok(fired, 'it fired');
  assert.ok(sum() < hp || !e.alive, 'and hit');
  assert.ok(Math.abs(Math.sin(tower.yaw + tower.headYaw) + 1) < 0.1, `its head on the raider, to the west (${(tower.yaw + tower.headYaw).toFixed(2)})`);
});

test('a tower holds fire with something of ours in the way', () => {
  const G = game(), s = G.base.silo, [tower] = up(G, 'tower', s.x - 60, s.z);
  const e = raider(G, s.x + 30, s.z);   // the silo between
  freeze(e);
  const hp = JSON.stringify(e.hp), silo = s.hp;
  run(G, 6);
  assert.ok(!G.shots.some(sh => sh.owner === tower));
  assert.equal(JSON.stringify(e.hp), hp);
  assert.equal(s.hp, silo, 'and never hits the silo');
});

test('a tower still a site, or a raider out of range, gets no shots', () => {
  const G = game(), s = G.base.silo, f = footprintAt(G, s.x - 60, s.z, 0, 'tower'), site = placeSite(G, f), [tower] = site.parts;
  const e = raider(G, tower.x + 60, tower.z); freeze(e);
  run(G, 4);
  assert.ok(!G.shots.some(sh => sh.owner === tower), 'not built: no gun');
  const G2 = game(), s2 = G2.base.silo, [t2] = up(G2, 'tower', s2.x - 60, s2.z);
  const e2 = raider(G2, t2.x + TOWER.range + 60, t2.z); freeze(e2);
  run(G2, 4);
  assert.ok(!G2.shots.some(sh => sh.owner === t2), 'out of range');
});
