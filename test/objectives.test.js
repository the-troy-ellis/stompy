import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze, DT } from './helpers.js';
import { damage } from '../src/sim/combat.js';
import { destroyEntity } from '../src/sim/entities.js';
import { polar, flatZones } from '../src/sim/objectives.js';
import { makeTerrain } from '../src/world/terrain.js';

const { hypot } = Math;
// A match from a hand-written mission definition (flat ground unless asked).
function mission(def, { flat = true, seed = 3 } = {}) {
  const G = createGame({ fx: recordFx(), seed });
  startMatch(G, { name: 'Test', pal: 'dusk', intel: '', foes: ['jackal'], ...def }, seed, false, 'kestrel', { terrainOpts: { flat } });
  G.kind = 'campaign';
  for (const e of foes(G)) freeze(e);
  return G;
}
const RELAYS = {
  entities: [0, 120, 240].map((b, i) => ({ kind: 'structure', id: `relay${i}`, at: [b, 300], tags: ['relay'], hp: 30, label: 'RELAY' })),
  objectives: [{ type: 'destroy', targets: ['relay'], label: 'RELAY' }, { type: 'eliminate', secondary: true }],
};

test('placement is polar from the start: bearing 0 straight ahead, 90 to the right (east on the compass)', () => {
  const a = polar([0, 100]), b = polar([90, 100]), c = polar([180, 50]);
  assert.ok(Math.abs(a.x) < 1e-9 && Math.abs(a.z - 100) < 1e-9);
  assert.ok(Math.abs(b.x + 100) < 1e-9 && Math.abs(b.z) < 1e-9, 'east is -x (the mech\'s right)');
  assert.ok(Math.abs(c.z + 50) < 1e-9);
  const G = mission(RELAYS);
  const r1 = G.entities.find(e => e.id === 'relay1'), want = polar([120, 300]);
  assert.ok(hypot(r1.x - want.x, r1.z - want.z) < 1e-9);
});

test('a mission\'s flat zones are level pads in the hills, and the height still matches the mesh grid', () => {
  const zones = flatZones({ flat: [[45, 600, 40]] }), [x, z, r] = zones[0];
  const ter = makeTerrain(11, { zones }), plain = makeTerrain(11);
  const hs = [0, 0.5, 0.9].flatMap(f => [[f * r, 0], [0, f * r], [-f * r * 0.7, f * r * 0.7]]).map(([dx, dz]) => ter.height(x + dx, z + dz));
  assert.ok(Math.max(...hs) - Math.min(...hs) < 0.05, `pad spread ${(Math.max(...hs) - Math.min(...hs)).toFixed(3)} m`);
  assert.equal(ter.height(-600, -600), plain.height(-600, -600), 'far from the pad nothing changes');
  assert.ok(ter.hs.length === plain.hs.length, 'the same grid the mesh is built from');
});

test('no objectives means ELIMINATE, as missions always were: the last kill wins it', () => {
  const G = mission({ foes: ['jackal', 'jackal'] });
  assert.deepEqual(G.objectives.map(o => o.def.type), ['eliminate']);
  const [a, b] = foes(G);
  damage(G, a, [a.x, a.y + 5, a.z], 999, G.player);
  stepFor(G, DT);
  assert.equal(G.state, 'play');
  assert.equal(G.objectives[0].left, 1);
  damage(G, b, [b.x, b.y + 5, b.z], 999, G.player);
  stepFor(G, DT);
  assert.equal(G.state, 'over');
  assert.equal(G.won, true);
});

test('DESTROY: knocking down every tagged structure wins, with the secondary ELIMINATE left undone', () => {
  const G = mission(RELAYS);
  const [d, el] = G.objectives;
  assert.equal(d.targets.length, 3);
  destroyEntity(G, G.entities[0], G.player); destroyEntity(G, G.entities[1], G.player);
  stepFor(G, DT);
  assert.equal(G.state, 'play');
  assert.equal(d.done, 2);
  destroyEntity(G, G.entities[2], G.player);
  stepFor(G, DT);
  assert.equal(d.state, 'done');
  assert.equal(el.state, 'active', 'the enemy is still out there');
  assert.equal(G.state, 'over');
  assert.equal(G.won, true, 'a secondary never holds up the win');
  assert.ok(G.fx.calls('say').length >= 0);
});

test('the player dying loses it, whatever the objectives say; the arena has none of this', () => {
  const G = mission(RELAYS);
  damage(G, G.player, [G.player.x, G.player.y + 5, G.player.z], 9999, foes(G)[0]);
  for (const e of G.entities) destroyEntity(G, e, null);
  stepFor(G, DT);
  assert.equal(G.state, 'over');
  assert.equal(G.won, false);
  const M = mission(RELAYS);
  M.mode = 'mp';
  for (const e of M.entities) destroyEntity(M, e, null);
  stepFor(M, DT);
  assert.equal(M.state, 'play', 'objectives do not run in the arena');
});
