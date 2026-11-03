// Maps of any width and length (docs/specs/35-bigger-maps.md part 5): a
// match takes its mission's size, a canyon shapes the ground into a floor
// between walls, and the next match without one is back on today's map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { HX, HZ, BX, BZ, setMapSize, canyonMid, DEFAULT_SIZE } from '../src/world/terrain.js';
import { NX, NZ } from '../src/world/voxels.js';
import { CANYON, CANYON_START, canyonFoes, SIZES } from '../src/data/maps.js';

const canyonDef = () => ({ name: 'Canyon', pal: 'dusk', intel: '', size: CANYON.size, ground: { shape: CANYON.shape }, start: CANYON_START, foes: canyonFoes(['jackal', 'jackal', 'warden', 'jackal']) });

test('a canyon match is 960 m across and 3 km along, with today\'s cells', () => {
  const G = createGame({ fx: recordFx(), seed: 5 });
  startMatch(G, canyonDef(), 5, false, 'kestrel');
  assert.equal(2 * HX, 960); assert.equal(2 * HZ, 3024);
  assert.equal(NX, 240); assert.equal(NZ, 756);
  assert.ok(BX < HX && BZ < HZ);
  startMatch(G, { name: 'Plain', pal: 'dusk', intel: '', foes: ['jackal'] }, 5, false, 'kestrel');
  assert.deepEqual([2 * HX, 2 * HZ], DEFAULT_SIZE, 'no size: back to today\'s map');
  setMapSize(SIZES.M);
  assert.equal(2 * HX, 3504);
  setMapSize();
});

test('the canyon is a floor between walls, and everyone starts on the floor', () => {
  const G = createGame({ fx: recordFx(), seed: 9 }), def = canyonDef();
  startMatch(G, def, 9, false, 'kestrel');
  const c = CANYON.shape.canyon, h = G.ter.height;
  for (const z of [-1000, -400, 0, 600, 1100]) {
    const mid = canyonMid(c, 9, z), floor = h(mid, z), wall = Math.min(h(mid - 360, z), h(mid + 360, z));
    assert.ok(wall - floor > c.walls * 0.6, `at z ${z}: floor ${floor.toFixed(0)} m, walls ${wall.toFixed(0)} m`);
  }
  const onFloor = m => Math.abs(m.x - canyonMid(c, 9, m.z)) < 30;
  assert.ok(onFloor(G.player) && G.player.z < -900, `you start at the south end, on the floor (${G.player.x.toFixed(0)}, ${G.player.z.toFixed(0)})`);
  const foes = G.mechs.filter(m => m.team !== 0);
  assert.equal(foes.length, 4);
  assert.ok(foes.every(onFloor), 'the foes stand on the floor');
  assert.ok(Math.max(...foes.map(m => m.z)) - Math.min(...foes.map(m => m.z)) > 1000, 'spread up its length');
  setMapSize();
});

test('a fight in the canyon runs: mechs walk, the nav routes, nobody leaves the map', () => {
  const G = createGame({ fx: recordFx(), seed: 3 });
  startMatch(G, canyonDef(), 3, false, 'kestrel');
  for (const m of G.mechs) if (m.ai) m.ai.aware = true;
  const z0 = G.mechs.map(m => m.z);
  for (let i = 0; i < 600; i++) update(G, noInput(), 1 / 60);
  assert.ok(G.mechs.some((m, i) => Math.abs(m.z - z0[i]) > 5), 'someone moved');
  assert.ok(G.mechs.every(m => Math.abs(m.x) <= BX && Math.abs(m.z) <= BZ), 'all inside the bounds');
  setMapSize();
});
