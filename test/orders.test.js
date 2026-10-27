// Orders from the command view (docs/specs/22-command-view.md § Giving
// orders): GO, STAY, DIG, FOLLOW and WORK, given headlessly through
// sim/orders.js `give`, carried out by parked crew mechs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { give, can, ORDER, SAY } from '../src/sim/orders.js';
import { commandUp } from '../src/sim/crew.js';
import { shiftMech } from '../src/sim/walkView.js';

const DT = 1 / 60;
// You in a KESTREL, up in the command view; a digger and a hauler parked. On the mesa range unless `flat`.
const game = (flat = false) => {
  const G = createGame({ fx: recordFx(), seed: 4 }), def = rangeDef({ ground: flat ? 'flat' : 'mesa', crew: 'digger', base: 'silo' });
  def.crew.push({ type: 'hauler', at: [-90, 30], face: 0 });
  startMatch(G, def, 4, false, 'kestrel', flat ? { terrainOpts: { flat: true } } : {});
  commandUp(G);
  return { G, you: G.player, d: G.crew.find(m => m.type === 'digger'), h: G.crew.find(m => m.type === 'hauler') };
};
const run = (G, s, until = () => false) => { for (let i = 0; i < s / DT && !until(); i++) update(G, noInput(), DT); };
const said = G => G.fx.calls('say').map(c => c.args[0]);

test('who can take what', () => {
  const { you, d, h } = game(true);
  for (const m of [you, d, h]) assert.ok(can(m, 'go') && can(m, 'stay'));
  assert.ok(can(d, 'dig') && !can(h, 'dig') && !can(you, 'dig'));
  assert.ok(can(h, 'follow') && !can(d, 'follow') && !can(you, 'follow'));
  assert.ok(can(d, 'work') && can(h, 'work') && !can(you, 'work'));
});

test('GO: it walks there, then stays; the voice answers once', () => {
  const { G, you, d } = game(true), x = d.x + 60, z = d.z + 40;
  assert.equal(give(G, [you, d], { kind: 'go', x, z }), 2);
  assert.deepEqual(said(G).filter(s => s === SAY.go), [SAY.go]);
  run(G, 1);
  assert.equal(d.job, 'GOING');
  run(G, 40, () => d.order?.kind === 'stay');
  assert.equal(d.order.kind, 'stay');
  assert.ok(Math.hypot(d.x - x, d.z - z) < ORDER.arrive + 1);
  run(G, 1);
  assert.equal(d.job, 'STAYING');
  const at = [d.x, d.z];
  run(G, 5);
  assert.ok(Math.hypot(d.x - at[0], d.z - at[1]) < 0.5, 'and stays');
});

test('STAY stops a digger at work; WORK sends it back to it', () => {
  const { G, d } = game(true);
  d.site = { x: d.x, y: d.y, z: d.z + 40, yaw: 0, pitch: 0, t: 0 };
  run(G, 2);
  assert.equal(d.job, 'DIGGING');
  give(G, [d], { kind: 'stay' });
  run(G, 3);
  assert.equal(d.job, 'STAYING');
  assert.ok(d.throttle === 0 && !d.melee);
  give(G, [d], { kind: 'work' });
  assert.equal(d.order, null);
  run(G, 1);
  assert.equal(d.job, 'DIGGING');
  assert.ok(said(G).includes(SAY.stay) && said(G).includes(SAY.work));
});

test('DIG at a mesa face: the digger walks up, faces it and digs there on its own', () => {
  const { G, d } = game();
  let z = 0;
  while (G.ter.height(0, z) < G.ter.height(0, 0) + 15) z++;   // the cliff, not the gentle rise before it
  shiftMech(d, -20 - d.x, z - 80 - d.z);
  assert.equal(give(G, [d], { kind: 'dig', x: 0, z: z + 10 }), 1);   // a tap on the rim
  run(G, 60, () => !d.order);
  assert.ok(!d.order && d.site, 'it took the spot as its site');
  assert.ok(d.y < G.ter.height(0, z) - 5, 'at the foot, not up on top');
  assert.ok(Math.hypot(d.x - 0, d.z - z) < ORDER.standOff * d.ch.scale + 8, 'up at the face');
  const { h } = { h: G.crew.find(m => m.type === 'hauler') }, ore = () => (d.ore || 0) + (h.ore || 0) + G.base.ore, ore0 = ore();
  run(G, 40);
  assert.ok(['DIGGING', 'HAULING'].includes(d.job), d.job);
  assert.ok(ore() > ore0, `it dug: ${ore0} -> ${ore()}`);
});

test('FOLLOW: a hauler waits behind that digger, not the nearer one, and lets go when it stops', () => {
  const { G, d, h } = game(true), you = G.player;
  d.site = { x: d.x, y: d.y, z: d.z, yaw: 0, pitch: 0, t: 0 };
  assert.equal(give(G, [h], { kind: 'follow', target: you }), 0, 'not a digger');
  assert.equal(give(G, [h], { kind: 'follow', target: d }), 1);
  run(G, 60, () => Math.hypot(h.x - d.x, h.z - d.z) < 20);
  assert.equal(h.job, 'FOLLOWING');
  assert.ok(Math.hypot(h.x - d.x, h.z - d.z) < 20);
  d.site = null; give(G, [d], { kind: 'stay' });
  run(G, 1);
  assert.equal(h.order, null, 'nothing to follow');
});

test('the mech you drive ignores its order until you leave it', () => {
  const { G, d } = game(true);
  give(G, [d], { kind: 'go', x: d.x + 80, z: d.z });
  G.command = null; G.player = d; d.parked = false;   // as DRIVE does
  const x = d.x;
  run(G, 3);
  assert.ok(Math.abs(d.x - x) < 0.5 && d.order.kind === 'go', 'kept, not obeyed');
});

test('BUILD: a digger told to build a site goes and builds it, even off its dig; not a non-site', async () => {
  const { footprintAt, placeSite } = await import('../src/sim/base.js');
  const { G, d, h, you } = game(true);
  d.site = { x: d.x, y: d.y, z: d.z + 40, yaw: 0, pitch: 0, t: 0 };
  Object.assign(h, { x: 900, z: 900 });   // out of it: no fetching
  const s = placeSite(G, footprintAt(G, d.x - 70, d.z - 50, 0, 'bay'));
  assert.equal(give(G, [d], { kind: 'build', target: G.base.silo }), 0, 'the silo is not a site');
  assert.equal(give(G, [you, d], { kind: 'build', target: s.parts[0] }), 1, 'diggers only');
  assert.ok(said(G).includes(SAY.build));
  s.ore = s.need;
  run(G, 90, () => !d.order);
  assert.equal(d.order, null, 'done: the order ends');
  assert.equal(s.parts[0].prog, 1);
});
