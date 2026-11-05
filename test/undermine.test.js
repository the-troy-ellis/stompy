// Tunnelling in, part 3 (docs/specs/37-tunnelling.md): a structure whose
// footprint loses its ground falls into the hole, is hurt by how far it
// fell, and topples if that brings it down; one still held up stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { dig, bite } from '../src/sim/dig.js';
import { undermine } from '../src/sim/under.js';
import { UNDER } from '../src/data/construct.js';
import { addEntity } from '../src/sim/entities.js';

const game = () => {
  const G = createGame({ fx: recordFx(), seed: 6 });
  startMatch(G, { name: 'Under', pal: 'dusk', intel: '', foes: [], base: { silo: [0, 120] } }, 6, false, 'digger', { terrainOpts: { flat: true } });
  return G;
};
const said = G => G.fx.calls('say').map(c => c.args[0]);
// Ground out from under a structure: carved under its whole footprint, d m deep.
const hollow = (G, e, d) => { for (let y = e.y - d; y < e.y; y += 3) for (const [u, v] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) G.ter.carve([e.x + u * e.radius * 0.7, y, e.z + v * e.radius * 0.7], 4); };

test('the ground gone from under its footprint: it falls to the hole\'s floor and loses 40% plus 5% a metre', () => {
  const G = game(), s = G.base.silo, y0 = s.y, max = s.max;
  hollow(G, s, 6);
  undermine(G, s.x, s.z, 20);
  const drop = y0 - s.y;
  assert.ok(drop > 3, `it dropped ${drop.toFixed(1)} m`);
  assert.ok(Math.abs(s.hp - max * (1 - UNDER.dropHp - UNDER.perM * drop)) < 1, `hp ${s.hp.toFixed(0)} of ${max}`);
  assert.ok(s.alive && !s.fall, 'still standing: it doesn\'t topple');
});

test('a fall that brings it down topples it toward the side that went, and the digger hears "It fell over."', () => {
  const G = game(), s = G.base.silo, P = G.player;
  s.hp = s.max * 0.5;
  for (let y = s.y - 10; y < s.y; y += 3) for (const u of [0, 1]) for (const v of [-1, 0, 1]) G.ter.carve([s.x + u * s.radius * 0.7, y, s.z + v * s.radius * 0.7], 4);   // the +x side and the middle
  G.digBy = P; undermine(G, s.x, s.z, 20, P); G.digBy = null;
  assert.equal(s.alive, false);
  assert.ok(s.fall, 'it topples');
  assert.ok(Math.sin(s.fall.yaw) > 0.5, `toward +x (yaw ${s.fall.yaw.toFixed(2)})`);
  assert.ok(said(G).includes('It fell over.'));
});

test('a hole under its middle alone, or one corner, doesn\'t sink it', () => {
  const G = game(), s = G.base.silo, y0 = s.y, hp = s.hp;
  G.ter.carve([s.x, s.y - 3, s.z], 3);
  G.ter.carve([s.x + s.radius * 0.7, s.y - 3, s.z + s.radius * 0.7], 3);
  undermine(G, s.x, s.z, 20);
  assert.equal(s.y, y0);
  assert.equal(s.hp, hp);
});

test('scenery that can\'t be hurt drops but doesn\'t break; a dig in single player undermines on its own', () => {
  const G = game(), s = G.base.silo;
  const rock = addEntity(G, { kind: 'structure', mesh: 'silo', x: s.x + 60, z: s.z, radius: 4, height: 6, hp: Infinity, team: -1, tags: [] });
  rock.y = G.ter.height(rock.x, rock.z);
  const y0 = rock.y;
  hollow(G, rock, 6);
  undermine(G, rock.x, rock.z, 20);
  assert.ok(rock.y < y0 - 2 && rock.alive && rock.hp === Infinity);
  const y1 = s.y;
  for (let y = s.y - 4; y < s.y + 2; y += 3) for (const [u, v] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) dig(G, [s.x + u * s.radius * 0.7, y, s.z + v * s.radius * 0.7], 5);
  assert.ok(s.y < y1 - 2 && s.hp < s.max, 'digs alone did it');
});

test('a digger\'s bite under a building is credited to it', () => {
  const G = game(), s = G.base.silo, P = G.player;
  hollow(G, s, 4);
  s.hp = 1;
  Object.assign(P, { x: s.x + s.radius + 5, z: s.z });
  bite(G, P, [s.x, s.y - 1, s.z], 6);
  assert.equal(s.alive, false);
  assert.equal(s.killedBy, P);
});
