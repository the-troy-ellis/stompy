import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { damageEntity, destroyEntity } from '../src/sim/entities.js';
import { convoyTarget, CONVOY_SELF_DEFENCE } from '../src/sim/ai.js';
import { CONVOY_WARN_EVERY } from '../src/sim/objectives.js';

function mission(def, foeList = ['jackal']) {
  const G = createGame({ fx: recordFx(), seed: 8 });
  startMatch(G, { name: 'Test', pal: 'dusk', intel: '', foes: foeList, ...def }, 8, false, 'kestrel', { terrainOpts: { flat: true } });
  return G;
}
const park = G => { for (const e of foes(G)) { Object.assign(e, { x: 1000, z: -1000 }); initFeet(G, e); freeze(e); } };
// Four trucks in a column heading north to a nav point 400 m up the road; the player is well off to the side.
const ROAD = {
  entities: [
    ...[0, 1, 2, 3].map(i => ({ kind: 'vehicle', id: `t${i}`, tags: ['c1'], at: [180, 20 + i * 16], path: [[0, 400]], speed: 9, hp: 30 })),
    { kind: 'nav', id: 'nav_exit', at: [0, 400] },
  ],
  objectives: [{ type: 'escort', convoy: 'c1', to: 'nav_exit', minAlive: 2, label: 'CONVOY' }],
};
const said = (G, line) => G.fx.calls('say').filter(c => c.args[0] === line).length;
const sidestep = G => { Object.assign(G.player, { x: 200, z: 0 }); initFeet(G, G.player); };

test('ESCORT: done once minAlive trucks reach the nav point, with the lead\'s distance counting down', () => {
  const G = mission(ROAD); park(G); sidestep(G);
  const o = G.objectives[0];
  stepFor(G, 1);
  assert.equal(o.total, 4); assert.equal(o.alive, 4);
  const d0 = o.dist;
  stepFor(G, 10);
  assert.ok(o.dist < d0 - 60, `the convoy should be closing (${d0.toFixed(0)} -> ${o.dist.toFixed(0)})`);
  assert.equal(G.state, 'play');
  stepFor(G, 60);
  assert.ok(o.home >= 2, `${o.home} home`);
  assert.equal(o.state, 'done');
  assert.equal(G.won, true);
});

test('fewer than minAlive left fails it at once; being shot at is called out, not every frame', () => {
  const G = mission(ROAD); park(G); sidestep(G);
  const [a, b, c] = G.entities.filter(e => e.kind === 'vehicle');
  damageEntity(G, a, 1, foes(G)[0], [a.x, a.y + 1, a.z]);
  stepFor(G, DT);
  damageEntity(G, a, 1, foes(G)[0], [a.x, a.y + 1, a.z]);
  stepFor(G, DT);
  assert.equal(said(G, 'Convoy under fire.'), 1, 'once');
  stepFor(G, CONVOY_WARN_EVERY + 0.1);
  damageEntity(G, b, 1, foes(G)[0], [b.x, b.y + 1, b.z]);
  stepFor(G, DT);
  assert.equal(said(G, 'Convoy under fire.'), 2, 'and again after a while');
  destroyEntity(G, a, null); destroyEntity(G, b, null);
  stepFor(G, DT);
  assert.equal(G.state, 'play', 'two left is still enough');
  destroyEntity(G, c, null);
  stepFor(G, DT);
  assert.equal(G.objectives[0].state, 'failed');
  assert.equal(G.won, false);
  assert.equal(said(G, 'Convoy lost.'), 1);
});

test('with prefer: convoy the enemy goes for the trucks, unless the player is right on top of it', () => {
  const G = mission({ ...ROAD, prefer: 'convoy' }, ['warden']);
  const e = foes(G)[0];
  Object.assign(e, { x: -150, z: 250, yaw: Math.PI / 2 }); initFeet(G, e);
  e.ai.aware = true;
  Object.assign(G.player, { x: 700, z: 700 }); initFeet(G, G.player);
  const t = convoyTarget(G, e, G.player);
  assert.ok(t && t.kind === 'vehicle', 'a truck');
  Object.assign(G.player, { x: e.x + CONVOY_SELF_DEFENCE - 20, z: e.z }); initFeet(G, G.player);
  assert.equal(convoyTarget(G, e, G.player), null, 'the player is closer than that: deal with the player');
  assert.equal(convoyTarget({ ...G, def: { ...G.def, prefer: undefined } }, e, G.player), null, 'only when the mission says so');
  Object.assign(G.player, { x: 700, z: 700 }); initFeet(G, G.player);
  const hp0 = G.entities.filter(v => v.kind === 'vehicle').reduce((s, v) => s + v.hp, 0);
  stepFor(G, 12);
  const hp1 = G.entities.filter(v => v.kind === 'vehicle').reduce((s, v) => s + Math.max(0, v.hp), 0);
  assert.ok(hp1 < hp0, `the trucks should be taking fire (${hp0} -> ${hp1})`);
  assert.ok(said(G, 'Convoy under fire.') >= 1);
});
