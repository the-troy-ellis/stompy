// Production (docs/specs/33-production.md part 2): a machine shop presses the
// parts an assembly line wants, from the pool's ore; haulers carry them; the
// line puts the mech together bay by bay, and it walks off and joins the crew.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { CONSTRUCT, LINE, PARTS, RECIPES } from '../src/data/construct.js';
import { footprintAt, placeSite } from '../src/sim/base.js';
import { queueMake, nextPart, lineWants, bayPart, thingsAt, unqueue } from '../src/sim/production.js';

const DT = 1 / 60;
const game = (crew = ['hauler']) => {
  const G = createGame({ fx: recordFx(), seed: 4 }), def = rangeDef({ ground: 'flat', crew: crew[0], base: 'silo' });
  for (const type of crew.slice(1)) def.crew.push({ type, at: [-90, 30], face: 0 });
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
// A shop and a line beside the silo, with ore in the pool.
const yard = (G) => {
  const s = G.base.silo, shop = up(G, 'shop', s.x + 50, s.z), line = up(G, 'line', s.x - 50, s.z + 20), plant = up(G, 'plant', s.x + 50, s.z + 50);
  G.base.ore = 200; G.base.iso = 30;
  return { shop, line, plant };
};

test('a line wants each mech\'s parts in its bays\' order: legs, body, a core, arms', () => {
  assert.deepEqual([0, 1, 2, 3].map(i => bayPart('digger', i)), ['legs.heavy', 'body.heavy', 'core', 'bucket']);
  const line = { bays: new Array(LINE.bays).fill(null), queue: ['hauler'] };
  assert.deepEqual(lineWants(line), [RECIPES.hauler[0], RECIPES.hauler[1], 'core', RECIPES.hauler[2]]);
});

test('the queue takes what a line makes, up to LINE.wait; a mech can come back out', () => {
  const G = game(), { line } = yard(G);
  assert.equal(queueMake(G, line, 'warden'), false, 'not a line mech');
  for (let i = 0; i < LINE.wait; i++) assert.ok(queueMake(G, line, 'digger'));
  assert.equal(queueMake(G, line, 'digger'), false, 'full');
  unqueue(line, 0);
  assert.equal(line.queue.length, LINE.wait - 1);
});

test('the shop presses what the line wants, paying the pool, onto its pile', () => {
  const G = game(['kestrel']), { shop, line } = yard(G);
  run(G, 2);
  assert.equal(shop.press, null, 'nothing wanted: idle');
  queueMake(G, line, 'digger');
  run(G, 0.1);
  assert.equal(nextPart(G), 'body.heavy', 'the legs are being pressed; next, the body');
  assert.equal(shop.press?.part, 'legs.heavy');
  assert.equal(G.base.ore, 200 - PARTS['legs.heavy'].ore);
  run(G, LINE.press);
  assert.deepEqual(thingsAt(G, shop).map(t => t.part), ['legs.heavy']);
});

test('haulers carry the parts; the line puts a digger together bay by bay, and it joins the crew and digs', () => {
  const G = game(['hauler']), { line } = yard(G), crew = G.crew.length;
  queueMake(G, line, 'digger');
  const shell = () => line.bays.find(Boolean)?.shell;
  run(G, 60, () => shell()?.show >= 1);
  assert.equal(shell()?.show, 1, 'the legs are in');
  assert.ok(G.crew.find(m => m.type === 'hauler').job, 'the hauler is at it');
  run(G, 120, () => G.crew.length > crew);
  assert.equal(G.crew.length, crew + 1, 'it walked off the line');
  const d = G.crew.at(-1);
  assert.equal(d.type, 'digger');
  assert.ok(d.parked && G.mechs.includes(d));
  assert.ok(said(G).includes('New digger.'));
  assert.ok(line.bays.every(b => !b) && !line.queue.length);
  assert.equal(G.base.things.length, 0, 'every part used');
});

test('a bay waits for its part and says which', () => {
  const G = game(['kestrel']), { line } = yard(G);
  queueMake(G, line, 'digger');
  run(G, 30);   // the shop presses, but no hauler carries
  const j = line.bays[0];
  assert.ok(j && !j.has, 'waiting in the first bay');
  assert.equal(bayPart(j.kind, 0), 'legs.heavy');
});

test('the crew\'s cap stops the line', () => {
  const G = game(['hauler']), { line } = yard(G);
  while (G.crew.length < CONSTRUCT.crewMax) G.crew.push({ ...G.crew[0], alive: true });
  queueMake(G, line, 'digger');
  run(G, 1);
  assert.ok(!line.bays[0] && line.crewFull, 'CREW FULL');
});

test('digging an isotope seam brings isotopes and heat on top of the ore; a silo takes them into their own pool', async () => {
  const { isoAt } = await import('../src/world/seams.js'), { bite } = await import('../src/sim/dig.js'), { padOf, isoRoom } = await import('../src/sim/base.js'), { shiftMech } = await import('../src/sim/walkView.js');
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', crew: 'kestrel', base: 'silo' }), 4, false, 'digger', { terrainOpts: { flat: true } });
  const P = G.player, seed = G.ter.seed, h = G.ter.height(P.x, P.z);
  let spot = null;
  for (let x = -300; x < 300 && !spot; x += 4) for (let z = -300; z < 300 && !spot; z += 4) for (let y = h - 4; y > h - 40 && !spot; y -= 4) if (isoAt(seed, x, y, z)) spot = [x, y, z];
  assert.ok(spot, 'an isotope seam on this map');
  const heat = P.heat;
  for (let i = 0; i < 6 && !(P.iso > 0); i++) bite(G, P, [spot[0], spot[1] + i, spot[2]]);
  assert.ok(P.iso > 0, `isotopes: ${P.iso}`);
  assert.ok(P.heat > heat, 'it warms the digger');
  assert.equal(isoRoom(G), CONSTRUCT.isoRoom);
  const [px, pz] = padOf(G.base.silo), iso = P.iso;
  shiftMech(P, px - P.x, pz - P.z);
  run(G, 0.1);
  assert.equal(G.base.iso, iso);
  assert.equal(P.iso, 0);
});

test('the plant makes a core from the pool\'s isotopes only when a line wants one', () => {
  const G = game(['kestrel']), { plant, line } = yard(G);
  run(G, 2);
  assert.equal(plant.brew, null, 'nothing wanted');
  queueMake(G, line, 'digger');
  run(G, 0.1);
  assert.ok(plant.brew, 'a line will want a core');
  assert.equal(G.base.iso, 30 - PARTS.core.iso);
  run(G, LINE.core);
  assert.deepEqual(thingsAt(G, plant).map(t => t.part), ['core']);
  assert.equal(nextPart(G, true), null, 'one is enough for one mech');
});

test('a mech\'s wreck leaves its core on the ground for a hauler', async () => {
  const { destroy } = await import('../src/sim/combat.js');
  const G = game(['kestrel']), k = G.crew.find(m => m.type === 'kestrel');
  destroy(G, k, null);
  run(G, 6);
  const c = G.base.things.find(t => t.part === 'core');
  assert.ok(c && !c.at && Math.hypot(c.x - k.x, c.z - k.z) < 5, 'a loose core where it fell');
});
