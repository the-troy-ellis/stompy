import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { damage } from '../src/sim/combat.js';
import { voiceLine } from '../src/sim/voice.js';
import { VOICE, DRY_GAP } from '../src/data/voice.js';

const isDry = (key, line) => VOICE[key].indexOf(line) > 0;

test('at most one dry line a minute; the flat line covers the rest', () => {
  const G = createTestGame();
  const lines = [];
  for (let i = 0; i < 6; i++) { lines.push(voiceLine(G, 'kill')); G.time += 5; }
  assert.ok(lines.every(l => VOICE.kill.includes(l)));
  assert.ok(lines.filter(l => isDry('kill', l)).length <= 1, lines.join(' | '));
});

test('dry lines never repeat in one mission, then the flat line takes over', () => {
  const G = createTestGame({ seed: 11 });
  const dry = [];
  for (let i = 0; i < 40; i++) { const l = voiceLine(G, 'legLost'); if (isDry('legLost', l)) dry.push(l); G.time += DRY_GAP; }
  assert.equal(new Set(dry).size, dry.length, 'a dry line repeated');
  assert.equal(dry.length, VOICE.legLost.length - 1, 'the whole pool should get used over 40 minutes');
  assert.equal(voiceLine(G, 'legLost'), 'Leg destroyed.');
});

test('the pick is seeded: the same seed says the same things', () => {
  const run = seed => { const G = createTestGame({ seed }); const out = []; for (let i = 0; i < 5; i++) { out.push(voiceLine(G, 'kill'), voiceLine(G, 'online')); G.time += DRY_GAP; } return out; };
  assert.deepEqual(run(4), run(4));
});

test('a lost limb is announced with its side when the line is flat, and dry lines come from the pool', () => {
  const G = createTestGame({ seed: 2 });
  const P = G.player;
  G.time = 10;
  damage(G, P, [P.x + 3, P.y + 8, P.z], P.hp.LA, null);
  assert.equal(P.hp.LA, 0, 'the arm should be the section hit');
  const said = G.fx.calls('say').map(c => c.args[0]);
  assert.ok(said.some(l => l === 'Left arm destroyed.' || isDry('armLost', l)), said.join(' | '));
});

test('a punch kill and a stomp kill get their own pools; a gun kill does not', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 7, yaw: Math.PI }); initFeet(G, e); freeze(e);
  e.lastHitMelee = 'stomp';
  damage(G, e, [e.x, e.y + 6, e.z], 1e4, G.player, false, true);
  stepFor(G, 0.5);
  const said = G.fx.calls('say').map(c => c.args[0]);
  assert.ok(said.some(l => VOICE.killStomp.includes(l)), said.join(' | '));
  assert.ok(!said.some(l => VOICE.killPunch.includes(l)));
});
