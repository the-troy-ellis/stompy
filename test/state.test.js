import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch, newMech } from '../src/sim/state.js';
import { missionDef } from '../src/data/missions.js';
import { nullFx } from '../src/sim/fx.js';

test('foes given as keys go on the 520-760 m ring, the first unaware when gentle; the same seed places them identically', () => {
  const def = { name: 'Ring', pal: 'dusk', foes: ['jackal', 'jackal'], intel: '' };
  const build = () => { const G = createGame({ fx: nullFx }); startMatch(G, def, 7, true, 'kestrel'); return G; };
  const a = build(), b = build();
  const foes = a.mechs.filter(m => m.team !== 0);
  assert.equal(foes.length, 2);
  for (const e of foes) { const d = Math.hypot(e.x, e.z); assert.ok(d >= 520 && d <= 760, `${d}`); assert.equal(e.type, 'jackal'); }
  assert.equal(foes[0].ai.aware, false);
  assert.deepEqual(a.mechs.map(m => [m.x, m.z, m.yaw]), b.mechs.map(m => [m.x, m.z, m.yaw]));
  assert.equal(a.state, 'play');
  assert.deepEqual(a.stats, { shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0 });
});

test('a foe spec places, points, wakes and restyles: mission 1 has a sleeper and a JACKAL that walks in', () => {
  const G = createGame({ fx: nullFx });
  startMatch(G, { name: 'Spec', pal: 'dusk', intel: '', foes: [{ type: 'warden', at: [90, 300], face: 270, aware: true }] }, 3, false, 'kestrel');
  const w = G.mechs.find(m => m.team !== 0);
  assert.ok(Math.abs(w.x + 300) < 1e-6 && Math.abs(w.z) < 1e-6, 'bearing 90 is to the right: -x');
  assert.ok(Math.abs(Math.sin(w.yaw) - 1) < 1e-6, 'facing bearing 270 points it back at the start (+x)');
  assert.equal(w.ai.aware, true);
  const M = createGame({ fx: nullFx });
  startMatch(M, missionDef(0), missionDef(0).seed, true, 'kestrel');
  const [sleeper, brawler] = M.mechs.filter(m => m.team !== 0);
  assert.equal(sleeper.ai.aware, false);
  assert.ok(brawler.ai.plan?.brawler, 'the second one closes to punching range');
});

test('newMech copies hit points and arms the chassis weapon list', () => {
  const G = createGame({ fx: nullFx });
  startMatch(G, missionDef(0), 1, false, 'warden');
  const m = newMech(G, 'jackal', 1, 10, 20, 0.5);
  assert.equal(m.weapons.length, 3);
  assert.deepEqual(m.hp, m.max);
  m.hp.T = 1;
  assert.notEqual(m.max.T, 1);
  assert.equal(m.feet.length, 2);
  assert.equal(G.player.feet.length, 4);
});
