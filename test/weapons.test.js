// Weapons from the base (docs/specs/33-production.md part 5): the weapon lab
// works out a weapon for this mission; the weapon shop makes guns that are
// worked out; a fighter (BARRY) comes off the line with a gun a hardpoint:
// its stock one if known, else a known one of its kind, else EMPTY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { LINE, KNOWN, PARTS } from '../src/data/construct.js';
import { footprintAt, placeSite } from '../src/sim/base.js';
import { gunsFor, knownOf, startStudy, studyable, queueMake, nextPart, thingsAt, bayParts } from '../src/sim/production.js';

const DT = 1 / 60;
const game = () => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat', crew: 'kestrel', base: 'silo' }), 4, false, 'digger', { terrainOpts: { flat: true } });
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

test('known at the start: KNOWN, unless the mission says; a gun a hardpoint, stock if known, else of its kind, else EMPTY', () => {
  const G = game();
  assert.deepEqual([...knownOf(G)], KNOWN);
  // BARRY: two energy (stock BIG ZAPPER), a ballistic (stock BIG BOOMER), a missile (stock ANGRY BEES).
  assert.deepEqual(gunsFor(G, 'kestrel'), ['laser', 'laser', 'mg', null], 'the ballistic one gets the RATATAT; no missile known');
  knownOf(G).add('lrm');
  assert.deepEqual(gunsFor(G, 'kestrel'), ['laser', 'laser', 'mg', 'lrm']);
  assert.deepEqual(bayParts(G, 'kestrel', LINE.bays - 1), ['arms.gun', 'gun.laser', 'gun.laser', 'gun.mg', 'gun.lrm']);
  assert.deepEqual(bayParts(G, 'digger', LINE.bays - 1), ['bucket'], 'a worker\'s last bay: its tool');
});

test('the lab works out a weapon in LINE.research s, this mission only', () => {
  const G = game(), s = G.base.silo, lab = up(G, 'lab', s.x + 60, s.z);
  assert.ok(!studyable(G).includes('laser') && studyable(G).includes('lrm') && !studyable(G).includes('fusion'));
  assert.ok(startStudy(G, lab, 'lrm'));
  assert.equal(startStudy(G, lab, 'ppc'), false, 'one at a time');
  run(G, LINE.research - 1);
  assert.ok(!knownOf(G).has('lrm'));
  run(G, 1.5);
  assert.ok(knownOf(G).has('lrm'));
  assert.ok(said(G).includes('ANGRY BEES. Works.'));
  assert.ok(!game().base.known?.has?.('lrm'), 'a new mission starts over');
});

test('the weapon shop makes the guns a fighter in the line wants, paid from the pool', () => {
  const G = game(), s = G.base.silo, line = up(G, 'line', s.x - 50, s.z + 20), arm = up(G, 'armory', s.x + 50, s.z);
  G.base.ore = 200;
  queueMake(G, line, 'kestrel');
  assert.equal(nextPart(G, 'gun'), 'gun.laser');
  run(G, 0.1);
  assert.equal(arm.press?.part, 'gun.laser');
  run(G, LINE.gun);
  assert.deepEqual(thingsAt(G, arm).map(t => t.part), ['gun.laser']);
  assert.ok(G.base.ore <= 200 - PARTS['gun.laser'].ore);
});

test('a BARRY off the line, its guns bolted on in the last bay, joins the crew', () => {
  const G = game(), s = G.base.silo, line = up(G, 'line', s.x - 50, s.z + 20), crew = G.crew.length;
  queueMake(G, line, 'kestrel');
  for (const part of ['legs.light', 'body.light', 'core', 'arms.gun', 'gun.laser', 'gun.laser', 'gun.mg']) G.base.things.push({ part, at: line, by: null, claim: null });
  run(G, 40, () => G.crew.length > crew);
  const b = G.crew.at(-1);
  assert.equal(b.type, 'kestrel');
  assert.deepEqual(b.weapons.map(w => w.type).filter(w => w !== 'fusion').sort(), ['laser', 'laser', 'mg'], 'its guns; the OOPS BUTTON every mech has');
  assert.ok(said(G).includes('New mech ready.'), 'a fighter: the factory\'s line');
  assert.equal(G.base.things.length, 0);
});
