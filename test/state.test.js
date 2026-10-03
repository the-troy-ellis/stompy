import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch, newMech } from '../src/sim/state.js';
import { missionDef } from '../src/data/missions.js';
import { nullFx } from '../src/sim/fx.js';

test('mission 0 places two JACKALs on the 520-760 m ring, one of them unaware; the same seed places them identically', () => {
  const build = () => { const G = createGame({ fx: nullFx }); startMatch(G, missionDef(0), 7, true, 'kestrel'); return G; };
  const a = build(), b = build();
  const foes = a.mechs.filter(m => m.team !== 0);
  assert.equal(foes.length, 2);
  for (const e of foes) { const d = Math.hypot(e.x, e.z); assert.ok(d >= 520 && d <= 760, `${d}`); assert.equal(e.type, 'jackal'); }
  assert.equal(foes[0].ai.aware, false);
  assert.deepEqual(a.mechs.map(m => [m.x, m.z, m.yaw]), b.mechs.map(m => [m.x, m.z, m.yaw]));
  assert.equal(a.state, 'play');
  assert.deepEqual(a.stats, { shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0 });
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
