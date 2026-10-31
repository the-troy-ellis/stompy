// The builder (docs/specs/31-builder.md): BUILD held swings its crane, and
// each swing at a site in reach slams one piece in, at the pace a digger
// built at; never past the ore delivered; a run of pieces builds up to the
// last, which finishes the building. Facing nothing, it says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { footprintAt, placeSite } from '../src/sim/base.js';
import { shiftMech } from '../src/sim/walkView.js';
import { TOOL } from '../src/data/tools.js';
import { CHASSIS } from '../src/data/chassis.js';

const DT = 1 / 60;
const BUILD = { held: { ...noInput().held, energy: true } };
const frames = (G, n, inp = {}) => { for (let i = 0; i < n; i++) update(G, { ...noInput(), ...inp }, DT); };
// You in a builder on the range's flat, a site 30 m ahead, and you in its reach, facing it.
function atSite(kind = 'bay') {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', base: 'silo' }), 4, false, 'builder', { terrainOpts: { flat: true } });
  const P = G.player, s = placeSite(G, footprintAt(G, P.x, P.z + 30, 0, kind)), e = s.parts[0];
  shiftMech(P, 0, e.z - e.radius - 6 - P.z);
  Object.assign(P, { yaw: 0, twist: 0, pitch: 0 });
  return { G, P, s, e };
}

test('a builder: no guns, no punch, BUILD on its primary button', () => {
  const ch = CHASSIS.builder;
  assert.equal(ch.tool, 'build');
  assert.equal(ch.hardpoints.length, 0);
});

test('held, BUILD slams a piece in each swing, at the pace a digger built at', () => {
  const { G, s } = atSite();
  s.ore = s.need;
  frames(G, Math.round(TOOL.build.swing * 3.5 / DT), BUILD);
  assert.equal(s.work, 3, 'three swings, three pieces');
  assert.equal(G.fx.calls('sfx.slam').length, 3);
});

test('never past the ore in it: then NEEDS ORE; facing nothing, NOTHING TO BUILD', () => {
  const { G, P, s } = atSite();
  s.ore = 0;
  frames(G, Math.round(TOOL.build.swing * 2.5 / DT), BUILD);
  assert.equal(s.work, 0);
  assert.ok(G.msgs.some(m => m.text === 'NEEDS ORE'));
  P.yaw = Math.PI;   // turned away
  frames(G, Math.round(TOOL.build.swing * 2.5 / DT), BUILD);
  assert.ok(G.msgs.some(m => m.text === 'NOTHING TO BUILD'));
});

test('a run builds up, each piece lower; the last finishes the building with the big one', () => {
  const { G, s, e } = atSite();
  s.ore = s.need;
  frames(G, Math.round(TOOL.build.swing * (s.swings + 1) / DT), BUILD);
  const into = G.fx.calls('sfx.slam').map(c => c.args[1]);
  assert.equal(into.length, s.swings - 1, 'every piece but the last');
  for (let i = 1; i < into.length; i++) assert.ok(into[i] >= into[i - 1]);
  assert.equal(G.fx.calls('sfx.built').length, 1, 'the last');
  frames(G, 5);
  assert.equal(e.prog, 1);
  assert.equal(G.base.sites.length, 0);
});

test('no cockpit places a site: the builder\'s other buttons do nothing', () => {
  const { G } = atSite();
  const n = G.base.sites.length;
  frames(G, 30, { held: { ...noInput().held, missile: true, ballistic: true, fusion: true } });
  assert.equal(G.base.sites.length, n);
});
