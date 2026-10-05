import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { stepFor, foes, freeze } from './helpers.js';
import { destroyEntity } from '../src/sim/entities.js';
import { turretRange } from '../src/sim/turrets.js';
import { TURRET, DIFF } from '../src/data/ai.js';
import { WEAPONS } from '../src/data/weapons.js';
import { wrapA } from '../src/util/math.js';

function battery(dist = 300, extra = {}) {
  const G = createGame({ fx: recordFx(), seed: 5 });
  startMatch(G, {
    name: 'Test', pal: 'dusk', intel: '', foes: ['jackal'],
    objectives: [{ type: 'destroy', targets: ['battery'], label: 'BATTERY' }],
    entities: [{ kind: 'turret', id: 'l1', at: [0, dist], tags: ['battery'], radius: 4, ...extra }],
  }, 5, false, 'kestrel', { terrainOpts: { flat: true } });
  for (const e of foes(G)) { freeze(e); Object.assign(e, { x: 900, z: -900 }); }
  return { G, T: G.entities.find(e => e.id === 'l1') };
}
const volleys = G => new Set(G.shots.filter(s => s.kind === 'missile').map(s => s.vid)).size;

test('a turret is a launcher-shaped, targetable structure with a weapon', () => {
  const { T } = battery();
  assert.equal(T.mesh, 'launcher');
  assert.equal(T.ch.name, 'LAUNCHER');
  assert.ok(T.targetable && T.team === 1);
  assert.ok(Number.isFinite(T.hp));
});

test('in range it turns its head on the player and fires an LRM volley through the missile path', () => {
  const { G, T } = battery(300);
  T.yaw = 0.3;   // the player is straight "behind" its nose: the head has to come round
  stepFor(G, 0.3);
  assert.equal(volleys(G), 0, 'not on the first frame: it waits its reaction time');
  stepFor(G, 3.5);
  const shots = G.shots.filter(s => s.owner === T);
  assert.equal(shots.length, WEAPONS.lrm.count, 'one full volley');
  assert.ok(shots.every(s => s.target === G.player && s.type === 'lrm'), 'homing on the player');
  assert.ok(Math.abs(wrapA(Math.atan2(G.player.x - T.x, G.player.z - T.z) - (T.yaw + T.headYaw))) < TURRET.aimTol + 0.02, 'head on target');
  assert.ok(G.fx.calls('sfx.missile').length >= 1, 'heard');
});

test('the volley hurts, its own missiles never hit the turret, and it refires on its cooldown', () => {
  const { G, T } = battery(300);
  const hp = T.hp;
  stepFor(G, 1.5);
  const first = G.volleySeq;
  stepFor(G, 4);
  assert.ok(G.stats.taken > 0, 'the player took the volley');
  assert.equal(T.hp, hp, 'none of it went into the launcher');
  stepFor(G, TURRET.cd - 3);
  assert.ok(G.volleySeq > first, 'a second volley after the cooldown');
});

test('out of range or destroyed, it holds fire; DESTROY counts it', () => {
  const far = battery(turretRange(createGame({ fx: recordFx(), seed: 1 }), {}) + 80);
  stepFor(far.G, 4);
  assert.equal(far.G.volleySeq, 0, 'out of range');
  const { G, T } = battery(300);
  destroyEntity(G, T, G.player);
  stepFor(G, 4);
  assert.equal(G.volleySeq, 0, 'a wreck does not shoot');
  assert.equal(G.won, true, 'the battery was the objective');
});

test('its range is the difficulty sight, never past the weapon', () => {
  const G = createGame({ fx: recordFx(), seed: 1 });
  for (const d of ['easy', 'normal', 'hard']) { G.diff = d; assert.equal(turretRange(G, {}), Math.min(DIFF[d].sight, WEAPONS.lrm.range)); }
});
