// Stealing (docs/specs/33-production.md § Stealing, part 4a): a building at a
// quarter or less is down and stops working; down and outside its owner's
// territory, enough haulers lift it and walk it off; set down inside yours,
// it's yours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { STEAL, CONSTRUCT } from '../src/data/construct.js';
import { footprintAt, placeSite, oreRoom, inLand } from '../src/sim/base.js';
import { canLift, addBuilding, liftNeed } from '../src/sim/steal.js';
import { isDown } from '../src/sim/down.js';
import { give } from '../src/sim/orders.js';
import { destroyEntity } from '../src/sim/entities.js';
import { queueMake } from '../src/sim/production.js';

const DT = 1 / 60;
// You in a kestrel on flat ground with the range's silo, and `haulers` parked haulers.
const game = (haulers = 2) => {
  const G = createGame({ fx: recordFx(), seed: 4 }), def = rangeDef({ ground: 'flat', crew: 'hauler', base: 'silo' });
  for (let i = 1; i < haulers; i++) def.crew.push({ type: 'hauler', at: [-80 + i * 10, 30], face: 0 });
  startMatch(G, def, 4, false, 'kestrel', { terrainOpts: { flat: true } });
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
// Your territory: the silo and two beacons; its middle.
const land = G => {
  const s = G.base.silo, a = up(G, 'beacon', s.x + 120, s.z), b = up(G, 'beacon', s.x + 60, s.z + 120);
  run(G, 0.3);
  return [(s.x + a.x + b.x) / 3, (s.z + a.z + b.z) / 3];
};
const haulers = G => G.crew.filter(m => m.type === 'hauler');

test('a building at a quarter or less is down and stops working; mended above it, it works again', () => {
  const G = game(1), s0 = G.base.silo;
  assert.ok(!isDown(s0));
  s0.hp = s0.max * STEAL.down;
  run(G, 0.1);
  assert.ok(isDown(s0));
  assert.equal(oreRoom(G), 0, 'a silo down holds nothing');
  assert.ok(said(G).includes('Building down.'));
  s0.hp = s0.max * 0.5;
  run(G, 0.1);
  assert.equal(oreRoom(G), CONSTRUCT.siloRoom);
});

test('a down shop presses nothing', () => {
  const G = game(1), s = G.base.silo, shop = up(G, 'shop', s.x + 50, s.z), line = up(G, 'line', s.x - 50, s.z + 20);
  G.base.ore = 200;
  shop.hp = shop.max * 0.2;
  queueMake(G, line, 'digger');
  run(G, 1);
  assert.equal(shop.press, null);
});

test('what can be lifted: down, not yours, and outside its owner\'s triangles', () => {
  const G = game(1), s = G.base.silo;
  const lost = addBuilding(G, 'shop', s.x - 200, s.z);
  assert.equal(lost.team, STEAL.neutral);
  assert.ok(canLift(G, lost), 'nobody\'s, down');
  lost.hp = lost.max * 0.5;
  assert.ok(!canLift(G, lost), 'not down');
  assert.ok(!canLift(G, G.base.silo), 'yours');
  // A foe's yard: a silo and two beacons, a shop down in the middle.
  const fx = s.x + 400, fz = s.z, foe = [addBuilding(G, 'silo', fx, fz, 0, 1, 1), addBuilding(G, 'beacon', fx + 120, fz, 0, 1, 1), addBuilding(G, 'beacon', fx + 60, fz + 120, 0, 1, 1)];
  const shop = addBuilding(G, 'shop', fx + 60, fz + 40, 0, 1, 0.2);
  assert.ok(!canLift(G, shop), 'inside its owner\'s territory');
  destroyEntity(G, foe[1], null);
  assert.ok(canLift(G, shop), 'its border broken');
});

test('enough haulers lift it, walk it home, and set down inside your territory it\'s yours', () => {
  const G = game(2), s = G.base.silo, [mx, mz] = land(G), shop = addBuilding(G, 'shop', s.x - 120, s.z - 60);
  assert.equal(liftNeed(shop), 2);
  assert.equal(give(G, haulers(G), { kind: 'carry', target: shop, to: { x: mx, z: mz, yaw: 0 } }), 2);
  assert.ok(said(G).includes('Lifting.'));
  run(G, 60, () => shop.carry?.lifted);
  assert.ok(shop.carry?.lifted, 'up on their tubs');
  run(G, 120, () => !shop.carry);
  assert.ok(!shop.carry && Math.hypot(shop.x - mx, shop.z - mz) < 1, 'set down where it was told');
  assert.ok(inLand(G, shop.x, shop.z));
  assert.equal(shop.team, 0);
  assert.ok(G.base.shops.includes(shop));
  assert.ok(said(G).includes('Taken. It\'s ours now.'));
  assert.ok(haulers(G).every(m => m.order?.kind === 'stay'));
});

test('one hauler can\'t lift what takes two; a hauler lost on the way drops it, unharmed', () => {
  const G = game(2), s = G.base.silo, shop = addBuilding(G, 'shop', s.x - 120, s.z - 60), [h1, h2] = haulers(G), hp = shop.hp;
  give(G, [h1], { kind: 'carry', target: shop, to: { x: s.x + 200, z: s.z, yaw: 0 } });
  run(G, 40);
  assert.ok(!shop.carry.lifted, 'too heavy');
  give(G, [h2], { kind: 'carry', target: shop, to: { x: s.x + 200, z: s.z, yaw: 0 } });
  run(G, 60, () => shop.carry?.lifted);
  assert.ok(shop.carry.lifted);
  run(G, 2);
  const at = [shop.x, shop.z];
  h2.alive = false;
  run(G, 1);
  assert.ok(!shop.carry?.lifted, 'dropped');
  assert.ok(Math.hypot(shop.x - at[0], shop.z - at[1]) < 10 && shop.hp === hp, 'where it was, no harm');
});

test('set down outside your territory, it stays nobody\'s', () => {
  const G = game(2), s = G.base.silo, shop = addBuilding(G, 'shop', s.x - 120, s.z - 60);
  give(G, haulers(G), { kind: 'carry', target: shop, to: { x: s.x - 160, z: s.z - 60, yaw: 0 } });
  run(G, 120, () => !shop.carry);
  assert.ok(!shop.carry);
  assert.equal(shop.team, STEAL.neutral);
});
