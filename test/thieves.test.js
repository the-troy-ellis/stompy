// Foes stealing (docs/specs/33-production.md § What foes do, part 4b): foe
// haulers come with raids by difficulty (EASY never, NORMAL every third, HARD
// every one), take an exposed building of yours that's down off the map, and
// on NORMAL drop it and run when hit; on HARD a raid knocks exposed buildings
// down for them first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { STEAL } from '../src/data/construct.js';
import { footprintAt, placeSite } from '../src/sim/base.js';
import { spawnWave } from '../src/sim/waves.js';
import { raidTarget } from '../src/sim/raid.js';

const DT = 1 / 60;
const game = (diff = 'normal') => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', crew: 'kestrel', base: 'silo' }), 4, false, 'kestrel', { terrainOpts: { flat: true } });
  G.diff = diff;
  return G;
};
const run = (G, s, until = () => false) => { for (let i = 0; i < s / DT && !until(); i++) update(G, noInput(), DT); };
const said = G => G.fx.calls('say').map(c => c.args[0]);
const up = (G, kind, x, z) => {
  const f = footprintAt(G, x, z, 0, kind);
  assert.equal(f.why, null, `${kind} fits`);
  const s = placeSite(G, f);
  s.ore = s.need; s.work = s.swings;
  run(G, 0.1);
  return s.parts[0];
};
const thieves = G => G.mechs.filter(m => m.ai?.thief);
const raid = (G, foes = []) => spawnWave(G, foes, { from: 90, raid: true });

test('EASY never sends thieves; NORMAL two with every third raid, and says so; HARD with every one', () => {
  const easy = game('easy');
  for (let i = 0; i < 3; i++) raid(easy);
  assert.equal(thieves(easy).length, 0);
  const normal = game('normal');
  raid(normal); raid(normal);
  assert.equal(thieves(normal).length, 0, 'not the first two');
  raid(normal);
  assert.equal(thieves(normal).length, 2, 'the third');
  assert.ok(said(normal).includes('Haulers with that raid.'));
  const hard = game('hard');
  raid(hard);
  assert.ok(thieves(hard).length >= 2, 'the first');
  assert.ok(!said(hard).includes('Haulers with that raid.'), 'no warning on HARD');
});

test('thieves take an exposed building of yours that\'s down off the map: lost', () => {
  const G = game('hard'), s = G.base.silo, shop = up(G, 'shop', s.x + 60, s.z);
  shop.hp = shop.max * STEAL.down;
  run(G, 0.5);
  assert.ok(shop.exposed, 'no territory: exposed');
  raid(G);
  run(G, 400, () => !shop.alive);
  assert.ok(!shop.alive && !shop.wreck, 'gone, no wreck');
  assert.ok(!G.base.shops.includes(shop));
  assert.ok(said(G).includes('Machine shop lost.'));
  run(G, 120, () => thieves(G).every(m => !m.alive));
  assert.ok(thieves(G).every(m => !m.alive && m.gone), 'and away');
});

test('a building inside your territory is left alone', () => {
  const G = game('hard'), s = G.base.silo, a = up(G, 'beacon', s.x + 120, s.z), b = up(G, 'beacon', s.x + 60, s.z + 120);
  const shop = up(G, 'shop', (s.x + a.x + b.x) / 3, (s.z + a.z + b.z) / 3);
  shop.hp = shop.max * STEAL.down;
  run(G, 0.5);
  assert.ok(!shop.exposed);
  raid(G);
  run(G, 60);
  assert.ok(shop.alive && !shop.carry, 'not theirs to take');
});

test('on NORMAL, hit while at it, they drop it and run; on HARD they keep at it', () => {
  for (const [diff, keeps] of [['normal', false], ['hard', true]]) {
    const G = game(diff), s = G.base.silo, shop = up(G, 'shop', s.x + 60, s.z);
    shop.hp = shop.max * STEAL.down;
    run(G, 0.5);
    if (diff === 'normal') { raid(G); raid(G); }
    raid(G);
    run(G, 200, () => shop.carry?.lifted);
    assert.ok(shop.carry?.lifted, `${diff}: lifted`);
    thieves(G)[0].ai.hitAt = G.time;
    run(G, 1);
    assert.equal(!!shop.carry?.lifted, keeps, `${diff}: ${keeps ? 'still carrying' : 'dropped'}`);
    if (!keeps) assert.ok(thieves(G).every(m => m.ai.flee), 'and off they go');
  }
});

test('on HARD a raider goes for an exposed building first, and leaves it once it\'s down', () => {
  const G = game('hard'), s = G.base.silo, shop = up(G, 'shop', s.x - 150, s.z);
  run(G, 0.5);
  const [r] = raid(G, ['jackal']);
  assert.equal(raidTarget(G, r), s.exposed ? (Math.hypot(s.x - r.x, s.z - r.z) < Math.hypot(shop.x - r.x, shop.z - r.z) ? s : shop) : shop);
  for (const b of [s, shop]) b.hp = b.max * STEAL.down;
  assert.ok(raidTarget(G, r) !== shop && raidTarget(G, r) !== s, 'not one that\'s down');
});
