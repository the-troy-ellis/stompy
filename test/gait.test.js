import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, input, DT } from './helpers.js';
import { update } from '../src/sim/update.js';
import { MECH_ORDER } from '../src/data/chassis.js';

for (const chassis of MECH_ORDER) {
  test(`${chassis}: a planted foot never moves while planted, walking straight and turning`, () => {
    const G = createTestGame({ chassis, foes: [] });
    const P = G.player;
    let prev = P.feet.map(f => ({ lifted: f.lifted, pos: [...f.pos] }));
    let planted = 0, steps = 0;
    for (let k = 0; k < 20 * 60; k++) {
      const inp = input({ thrUp: true, turn: k > 600 && k < 900 ? 0.6 : 0 });
      G.clock += DT * 1000;
      update(G, inp, DT);
      P.feet.forEach((f, i) => {
        if (!f.lifted && !prev[i].lifted) {
          const d = Math.hypot(f.pos[0] - prev[i].pos[0], f.pos[1] - prev[i].pos[1], f.pos[2] - prev[i].pos[2]);
          assert.ok(d < 1e-3, `${chassis} foot ${i} slid ${d.toFixed(4)} m at frame ${k}`);
          planted++;
        }
        if (f.lifted && !prev[i].lifted) steps++;
      });
      prev = P.feet.map(f => ({ lifted: f.lifted, pos: [...f.pos] }));
    }
    assert.ok(steps > 10, `only ${steps} steps`);
    assert.ok(planted > 1000);
    assert.ok(P.speed > P.ch.speed * 0.9);
  });
}
