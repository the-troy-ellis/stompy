import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, input, DT, stepFor } from './helpers.js';
import { geoOf } from '../src/data/geo.js';
import { update } from '../src/sim/update.js';
import { MECH_ORDER, CHASSIS } from '../src/data/chassis.js';
import { runOf } from '../src/sim/gait.js';
import { GAIT } from '../src/data/walk.js';

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
    assert.ok(planted > 600, `${planted} planted foot-frames`);   // a runner at full throttle has a flight phase (spec 16), so fewer
    assert.ok(P.speed > P.ch.speed * 0.9);
  });
}

// Gaits by class (spec 16, #261): fewer, longer steps; runners leave the
// ground at speed, walkers and crawlers never do. Measured at top speed on
// flat ground. "Before" is what each took when this landed.
const BEFORE = { kestrel: 3.75, jackal: 5.59, warden: 2.37, puncher: 2.16, light1: 5.85, sniper1: 3.25 };
function topSpeedGait(chassis) {
  const G = createTestGame({ chassis, foes: [] }), P = G.player;
  let lands = 0, flight = 0, frames = 0, prev = P.feet.map(f => f.lifted);
  for (let k = 0; k < 30 * 60; k++) {
    update(G, input({ thrUp: true }), DT);
    if (k >= 600) {
      frames++;
      P.feet.forEach((f, i) => { if (prev[i] && !f.lifted) lands++; });
      if (P.feet.every(f => f.lifted)) flight++;
    }
    prev = P.feet.map(f => f.lifted);
  }
  return { perSec: lands / (frames * DT) / (P.feet.length === 4 ? 2 : 1), flight: flight / frames, legs: P.ch.legs, runs: runOf(P, 1) > 0.99 };
}
for (const chassis of MECH_ORDER) {
  test(`${chassis}: fewer, longer steps, and only a runner leaves the ground`, () => {
    const { perSec, flight, legs, runs } = topSpeedGait(chassis);
    assert.ok(perSec < BEFORE[chassis] * 0.85, `${perSec.toFixed(2)} footfalls a second (was ${BEFORE[chassis]})`);
    // Bird legs run; forward knees run too if they're quick enough (GAIT runMin); heavies and crawlers walk.
    assert.equal(runs, legs === 'reverse' || (legs === 'forward' && CHASSIS[chassis].speed >= GAIT.forward.runMin), 'who runs');
    if (runs) assert.ok(flight > 0.15, `a runner in the air ${(flight * 100).toFixed(0)}% of the time`);
    else assert.equal(flight, 0, 'a walker or crawler always has a foot down');
    if (chassis === 'puncher' || chassis === 'warden') assert.ok(perSec < 1.9, `a heavy at ${perSec.toFixed(2)} a second`);
  });
}

test('no high kicks: a swinging foot never jumps, and never gets far out ahead of its hip', () => {
  for (const chassis of MECH_ORDER) {
    const G = createTestGame({ chassis, foes: [] });
    const P = G.player, g = geoOf(P), s = P.ch.scale, L = (g.l1 + g.l2) * s;
    stepFor(G, 4, input({ thrUp: true }));
    let last = P.feet.map(f => [...f.pos]), maxJump = 0, maxAhead = 0;
    for (let k = 0; k < 300; k++) {
      stepFor(G, 1 / 60, input({ thrUp: true }));
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      P.feet.forEach((f, i) => {
        const leg = g.legs[i], hx = P.x + (rx * leg.hx + fx * leg.hz) * s, hz = P.z + (rz * leg.hx + fz * leg.hz) * s;
        maxAhead = Math.max(maxAhead, ((f.pos[0] - hx) * fx + (f.pos[2] - hz) * fz) / L);
        maxJump = Math.max(maxJump, Math.hypot(f.pos[0] - last[i][0], f.pos[2] - last[i][2]) / L);
        last[i] = [...f.pos];
      });
    }
    assert.ok(maxAhead < 0.75, `${chassis}: a foot ${maxAhead.toFixed(2)} leg lengths ahead of its hip`);
    assert.ok(maxJump < 0.4, `${chassis}: a foot jumped ${maxJump.toFixed(2)} leg lengths in one frame`);
  }
});

test('into a run, a sprinter\'s lean: the torso pitches forward (and the hips sink, gait.js); a heavy that walks stays upright', () => {
  const at = (chassis, thr) => {
    const G = createTestGame({ chassis, foes: [] }), P = G.player;
    for (let k = 0; k < 8 * 60; k++) { P.throttle = thr; update(G, input({}), DT); }
    return { lean: P.runLean };
  };
  for (const chassis of ['kestrel', 'jackal']) {
    const walk = at(chassis, 0.4), run = at(chassis, 1), gp = GAIT[CHASSIS[chassis].legs];
    assert.equal(walk.lean, 0, `${chassis} walking stands up`);
    assert.ok(Math.abs(run.lean - gp.runLean) < 0.02, `${chassis} leans ${run.lean} running`);
  }
  assert.equal(at('puncher', 1).lean, 0, 'a heavy walks upright');
});
