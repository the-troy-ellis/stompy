import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { destroyEntity } from '../src/sim/entities.js';
import { polar, flatZones } from '../src/sim/placement.js';

function mission(def, flat = true) {
  const G = createGame({ fx: recordFx(), seed: 6 });
  startMatch(G, { name: 'Test', pal: 'dusk', intel: '', foes: ['jackal'], ...def }, 6, false, 'kestrel', { terrainOpts: { flat } });
  for (const e of foes(G)) { freeze(e); Object.assign(e, { x: 1500, z: 1500 }); }
  return G;
}
const teleport = (G, x, z) => { Object.assign(G.player, { x, z, y: G.ter.height(x, z) }); initFeet(G, G.player); };
const LZ = { entities: [{ kind: 'nav', id: 'nav_lz', at: [0, 900], pad: 50 }] };

test('EXTRACT: reaching the nav point\'s trigger radius completes it, with the distance counting down', () => {
  const G = mission({ ...LZ, objectives: [{ type: 'extract', at: 'nav_lz' }] });
  const o = G.objectives[0], lz = polar([0, 900]);
  stepFor(G, DT);
  assert.ok(Math.abs(o.dist - 900) < 1, `dist ${o.dist}`);
  assert.equal(o.left, undefined, 'no timer unless the mission asks for one');
  teleport(G, lz.x, lz.z - 45);
  stepFor(G, DT);
  assert.equal(G.state, 'play', '45 m out is not there yet');
  teleport(G, lz.x, lz.z - 30);
  stepFor(G, DT);
  assert.equal(o.state, 'done');
  assert.equal(G.won, true);
});

test('with `within`, missing the clock fails it, and the mission with it', () => {
  const G = mission({ ...LZ, objectives: [{ type: 'extract', at: 'nav_lz', within: 5 }] });
  stepFor(G, 3);
  assert.ok(Math.abs(G.objectives[0].left - 2) < 0.1);
  stepFor(G, 2.1);
  assert.equal(G.objectives[0].state, 'failed');
  assert.equal(G.state, 'over');
  assert.equal(G.won, false);
  assert.ok(G.fx.calls('say').some(c => c.args[0] === 'Mission failed.'));
});

test('`after` holds an objective until the one before is done; its clock starts then', () => {
  const G = mission({
    entities: [...LZ.entities, { kind: 'structure', id: 'tank', at: [90, 200], tags: ['tank'], hp: 10 }],
    objectives: [{ type: 'destroy', targets: ['tank'] }, { type: 'extract', at: 'nav_lz', within: 10, after: 0 }],
  });
  const [d, x] = G.objectives;
  stepFor(G, 15);
  assert.equal(x.state, 'waiting', 'no clock while it waits');
  assert.equal(G.state, 'play');
  destroyEntity(G, G.entities.find(e => e.id === 'tank'), G.player);
  stepFor(G, DT * 2);
  assert.equal(d.state, 'done');
  assert.equal(x.state, 'active');
  assert.ok(G.fx.calls('say').some(c => c.args[0] === 'Objective updated.'));
  assert.ok(x.left > 9.9, `its own clock (${x.left})`);
  const lz = polar([0, 900]);
  teleport(G, lz.x, lz.z);
  stepFor(G, DT);
  assert.equal(G.won, true);
});

test('an entity with `pad` gets a flat zone under it', () => {
  const z = flatZones(LZ);
  assert.equal(z.length, 1);
  const lz = polar([0, 900]);
  assert.ok(Math.abs(z[0][0] - lz.x) < 1e-9 && Math.abs(z[0][1] - lz.z) < 1e-9 && z[0][2] === 50);
  const G = mission(LZ, false);
  const hs = [[0, 0], [30, 0], [0, -40], [-35, 20]].map(([dx, dz]) => G.ter.height(lz.x + dx, lz.z + dz));
  assert.ok(Math.max(...hs) - Math.min(...hs) < 0.05, 'level under the pad');
});
