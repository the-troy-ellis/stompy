// The command view, the sim's side (docs/specs/22-command-view.md): going
// up parks the mech you were in and the world runs on; coming down puts you
// in the one you left, or the one you pick. Single player with a crew only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { canCommand, commandUp, commandDown } from '../src/sim/crew.js';
import { destroy } from '../src/sim/combat.js';
import { shiftMech } from '../src/sim/walkView.js';

const DT = 1 / 60;
const game = (crew = 'kestrel', pilot = 'digger', base = 'silo') => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'mesa', crew, base }), 4, false, pilot, {});
  return G;
};
const frame = (G, over = {}) => update(G, { ...noInput(), ...over }, DT);
const run = (G, s) => { for (let i = 0; i < s / DT; i++) frame(G); };

test('only with a crew, and only in single player', () => {
  assert.equal(canCommand(game()), true);
  const solo = game('none');
  assert.equal(canCommand(solo), false);
  assert.equal(commandUp(solo), false);
  const mp = game(); mp.mode = 'mp';
  assert.equal(canCommand(mp), false);
});

test('going up parks the mech you were in; coming down puts you back in it', () => {
  const G = game(), you = G.player;
  you.throttle = 1;
  assert.equal(commandUp(G), true);
  assert.ok(G.command && G.command.from === you && you.parked && you.throttle === 0);
  assert.equal(G.player, you, 'G.player stays the mech you left');
  assert.equal(commandUp(G), false, 'once');
  assert.equal(commandDown(G), true);
  assert.equal(G.command, null);
  assert.ok(G.player === you && !you.parked);
});

test('up there the world runs on and the cockpit takes no input', () => {
  const G = game(), you = G.player, t0 = G.time;
  commandUp(G);
  const x = you.x, z = you.z;
  run(G, 2);
  assert.ok(G.time > t0 + 1.9, 'time runs');
  frame(G, { thrUp: true, turn: 1, punch: true });
  assert.ok(Math.hypot(you.x - x, you.z - z) < 0.5 && !you.melee && you.throttle === 0, 'no driving from up here');
});

test('the mech you left does its job while you are up: a digger digs', () => {
  const G = game(), D = G.player;
  let z = 0;
  while (G.ter.height(0, z) < G.ter.height(0, 0) + 4) z++;
  shiftMech(D, -D.x, z - 9 - D.z);
  D.pitch = 0;
  for (let i = 0; i < 240; i++) frame(G, { punch: i % 80 === 0 });
  const ore = D.ore;
  commandUp(G);
  run(G, 30);
  assert.equal(D.job, 'DIGGING');
  assert.ok(D.ore > ore, `it dug: ${ore} -> ${D.ore}`);
});

test('DRIVE: down into another crew mech', () => {
  const G = game(), you = G.player, other = G.crew[1];
  commandUp(G);
  assert.equal(commandDown(G, other), true);
  assert.ok(G.player === other && !other.parked && you.parked);
  assert.ok(G.fx.calls('say').some(c => c.args[0] === `${other.ch.name}.`), 'says which');
});

test('the mech you left dies while you are up: nothing moves you; BACK finds a live one', () => {
  const G = game(), you = G.player, other = G.crew[1];
  commandUp(G);
  destroy(G, you, null);
  run(G, 4);
  assert.ok(G.command, 'still up: no handover');
  assert.equal(G.state, 'play');
  assert.equal(commandDown(G), true);
  assert.equal(G.player, other);
});
