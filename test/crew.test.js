// The crew and SWAP (docs/specs/20-build-and-fight.md § Swapping mechs):
// you move between the mechs on your side; the one you leave stands parked,
// takes hits and can die; when the one you are in dies the next is yours,
// and when none is left the mission is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { destroy, damage } from '../src/sim/combat.js';
import { crewOf, nextCrew, swap, HANDOVER } from '../src/sim/crew.js';
import { rangeDef } from '../src/data/range.js';
import { CHASSIS } from '../src/data/chassis.js';
import { readPad, PAD } from '../src/input/gamepad.js';
import { stepFor } from './helpers.js';

const DT = 1 / 60;
const game = (crew = [{ type: 'digger', at: [90, 30] }, { type: 'kestrel', at: [-90, 30] }], foes = []) => {
  const G = createGame({ fx: recordFx(), seed: 3 });
  startMatch(G, { name: 'Crew', pal: 'dusk', foes, intel: '', objectives: [], crew }, 3, false, 'kestrel', { terrainOpts: { flat: true } });
  return G;
};
const frame = (G, over = {}) => update(G, { ...noInput(), ...over }, DT);

test('a match starts with you and the crew it lists, parked where they stand', () => {
  const G = game(), [you, dig, kes] = crewOf(G);
  assert.equal(you, G.player);
  assert.equal(dig.type, 'digger'); assert.equal(kes.type, 'kestrel');
  assert.ok(dig.parked && kes.parked && !you.parked);
  assert.ok(G.mechs.includes(dig) && dig.team === 0);
  const solo = game([]);
  assert.deepEqual(crewOf(solo), [solo.player], 'no crew: a crew of one');
});

test('SWAP goes round the crew in order; the one you left is parked', () => {
  const G = game(), [you, dig, kes] = crewOf(G);
  frame(G, { swap: true });
  assert.equal(G.player, dig);
  assert.ok(you.parked && !dig.parked);
  frame(G, { swap: true });
  assert.equal(G.player, kes);
  frame(G, { swap: true });
  assert.equal(G.player, you, 'and back round');
  assert.deepEqual(G.fx.calls('say').map(c => c.args[0]).slice(-3), [`${CHASSIS.digger.name}.`, 'KESTREL.', 'KESTREL.'], 'the voice says whose cockpit you are in');
});

test('a parked mech stands still, even with its throttle up, and still takes hits', () => {
  const G = game(), [you] = crewOf(G);
  you.throttle = 1;
  stepFor(G, 1);
  const moved = you.z;
  assert.ok(moved > 0.5, 'driven, it walks');
  frame(G, { swap: true });
  assert.equal(you.throttle, 0, 'parked: throttle off');
  stepFor(G, 2);   // it coasts to a stop
  const at = you.z;
  stepFor(G, 3);
  assert.ok(Math.abs(you.z - at) < 0.2, `parked, it stands (${(you.z - at).toFixed(2)} m)`);
  const hp = you.hp.T;
  damage(G, you, [you.x, you.y + 5, you.z], 10, null);
  assert.ok(you.hp.T < hp, 'and it can be hurt');
});

test('SWAP skips a dead crew mech', () => {
  const G = game(), [you, dig, kes] = crewOf(G);
  destroy(G, dig, null);
  assert.equal(nextCrew(G), kes);
  frame(G, { swap: true });
  assert.equal(G.player, kes);
  void you;
});

test('when the mech you are in dies, the next live one is yours after a beat; with none left, it is lost', () => {
  const G = game([{ type: 'digger', at: [90, 30] }]), [you, dig] = crewOf(G);
  destroy(G, you, null);
  assert.equal(G.state, 'play', 'not over: the digger is still up');
  stepFor(G, HANDOVER + 0.2);
  assert.equal(G.player, dig);
  destroy(G, dig, null);
  assert.equal(G.state, 'over');
  assert.equal(G.won, false);
});

test('without a crew, SWAP does nothing and a death is the end, as always', () => {
  const G = game([]), you = G.player;
  frame(G, { swap: true });
  assert.equal(G.player, you);
  assert.equal(swap(G), false);
  destroy(G, you, null);
  assert.equal(G.state, 'over');
});

test('foes go for the nearest of your crew, not only the mech you are in', () => {
  const G = game([{ type: 'digger', at: [0, 300] }], ['jackal']), e = G.mechs.find(m => m.team === 1), dig = crewOf(G)[1];
  Object.assign(e, { x: 0, z: 340 });
  e.ai.aware = true;
  stepFor(G, 0.2);
  assert.equal(e.ai.prey, dig);
});

test('the range can add a crew mech, and the pad\'s D-pad right is SWAP', () => {
  const def = rangeDef({ crew: 'digger' });
  assert.deepEqual(def.crew.map(c => c.type), ['digger']);
  assert.deepEqual(rangeDef({}).crew, []);
  const buttons = Array(17).fill(0).map(() => ({ pressed: false, value: 0 }));
  buttons[PAD.RIGHT] = { pressed: true, value: 1 };
  assert.equal(readPad({ buttons, axes: [0, 0, 0, 0] }).pressed.swap, true);
});
