import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTutorial, tickTutorial } from '../src/sim/tutorial.js';
import { TUT_STEPS, TUT_EVENTS, TUT } from '../src/data/tutorial.js';
import { cycleTarget } from '../src/sim/missiles.js';
import { createTestGame, input, stepFor, foes, freeze } from './helpers.js';

// Mission 1's silent tutorial (#228, spec 11 § Silent tutorial).
function game(opts) {
  const G = createTestGame(opts);
  for (const m of foes(G)) { freeze(m); m.x = 3000; m.z = 3000; }   // far off and still: no events unless a test makes one
  G.tut = newTutorial(G);
  return G;
}
const up = G => G.tut.cur && !G.tut.cur.fade ? G.tut.cur.id : null;
const wait = G => stepFor(G, TUT.gap + TUT.fade + 0.1);   // the last one fades, the next comes up

test('the first prompt comes up after a beat: W: GO. S: LESS GO., by the throttle', () => {
  const G = game();
  assert.equal(up(G), null);
  stepFor(G, TUT.gap + 0.1);
  assert.equal(up(G), 'go');
  assert.equal(G.tut.cur.kb, 'W: GO. S: LESS GO.');
  assert.equal(G.tut.cur.at, 'throttle');
});

test('each step fades when the pilot does it, and the next takes its place, in order', () => {
  const G = game();
  stepFor(G, TUT.gap + 0.1);
  stepFor(G, 0.5, input({ thrUp: true }));
  wait(G);
  assert.equal(up(G), 'legs');
  stepFor(G, 1.5, input({ turn: 1 }));
  wait(G);
  assert.equal(up(G), 'torso');
  stepFor(G, 0.5, input({ twist: 1 }));
  wait(G);
  assert.equal(up(G), 'melt');
  stepFor(G, 0.6, input({ held: { energy: true } }));
  wait(G);
  assert.equal(up(G), 'thump');
  stepFor(G, 0.1, input({ held: { ballistic: true } }));
  wait(G);
  assert.equal(up(G), 'missiles');
  stepFor(G, 0.05, input({ missileTap: true }));
  wait(G);
  assert.equal(up(G), 'jump');
  stepFor(G, 0.3, input({ jets: true }));
  wait(G);
  assert.equal(up(G), null);
  assert.equal(G.tut.done, true, 'every step shown');
  assert.deepEqual([...G.tut.seen].sort(), TUT_STEPS.map(s => s.id).sort());
});

test('a prompt the pilot ignores gives way in the end, and nothing shows twice', () => {
  const G = game();
  stepFor(G, TUT.gap + 0.1);
  assert.equal(up(G), 'go');
  stepFor(G, TUT.giveUp + 0.1);
  wait(G);
  assert.equal(up(G), 'legs', 'W gave up waiting');
  const shown = [];
  for (let i = 0; i < 400; i++) { stepFor(G, 0.25, input({ thrUp: true, turn: 1, twist: 1, held: { energy: true, ballistic: true }, missileTap: true, jets: i % 2 === 0 })); const id = up(G); if (id && shown.at(-1) !== id) shown.push(id); }
  assert.equal(new Set(shown).size, shown.length, `each once: ${shown}`);
  assert.ok(!shown.includes('go'));
});

test('a mech without missiles or jets is never told about them', () => {
  const G = game();
  G.player.weapons = G.player.weapons.filter(w => w.type !== 'lrm' && w.type !== 'srm');
  G.player.jets = 0;
  const shown = [];
  for (let i = 0; i < 300; i++) { stepFor(G, 0.25, input({ thrUp: true, turn: 1, twist: 1, held: { energy: true, ballistic: true } })); const id = up(G); if (id && shown.at(-1) !== id) shown.push(id); }
  assert.ok(!shown.includes('missiles') && !shown.includes('jump'), `${shown}`);
  assert.equal(G.tut.done, true);
});

test('heat over 60 breaks in once, and the step it interrupted comes back', () => {
  const G = game();
  stepFor(G, TUT.gap + 0.1);
  assert.equal(up(G), 'go');
  G.player.heat = TUT.heatAt + 5;
  tickTutorial(G, input(), 0.016);
  assert.equal(up(G), 'heat');
  assert.equal(G.tut.cur.kb, 'HEAT: TOO MUCH');
  G.player.heat = 10;
  stepFor(G, 0.1);
  wait(G);
  assert.equal(up(G), 'go', 'back to W');
  G.player.heat = TUT.heatAt + 5;
  stepFor(G, 0.2);
  assert.notEqual(up(G), 'heat', 'only the first time');
});

test('a JACKAL in reach brings E: PUNCH; a second hostile close brings T: NEXT ONE until the target changes', () => {
  const G = game({ foes: ['jackal', 'jackal'] });
  const [a, b] = foes(G), P = G.player;
  stepFor(G, TUT.gap + 0.1);
  Object.assign(a, { x: P.x + 6, z: P.z });
  stepFor(G, 0.05);
  assert.equal(up(G), 'punch');
  stepFor(G, 0.05, input({ punch: true }));
  wait(G);
  Object.assign(a, { x: P.x + 150, z: P.z }); Object.assign(b, { x: P.x - 150, z: P.z });
  stepFor(G, 0.05);
  assert.equal(up(G), 'target');
  stepFor(G, 1);
  assert.equal(up(G), 'target', 'still up: nothing targeted yet');
  G.target = a;
  stepFor(G, 0.05);
  assert.equal(up(G), 'target', 'a target picked some other way is not T');
  cycleTarget(G);
  stepFor(G, 0.05);
  assert.ok(G.tut.seen.has('target'));
});

test('every prompt has words for keys, glass and a pad, and no longer than the spec allows', () => {
  for (const s of [...TUT_STEPS, ...TUT_EVENTS]) {
    for (const k of ['kb', 'touch', 'pad']) {
      assert.ok(typeof s[k] === 'string' && s[k] === s[k].toUpperCase(), `${s.id} ${k}`);
      assert.ok(s[k].length <= 30, `${s.id} ${k}: ${s[k]}`);
    }
  }
});

test('the tutorial is gone when a new match starts', () => {
  const G = game();
  assert.ok(G.tut);
  const H = createTestGame();
  assert.equal(H.tut, null);
});
