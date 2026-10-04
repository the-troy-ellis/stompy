import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, input, foes, freeze, DT } from './helpers.js';
import { update } from '../src/sim/update.js';
import { CHASSIS } from '../src/data/chassis.js';
import { GEO, geoFor } from '../src/data/geo.js';
import { buildMechParts, styleOf } from '../src/mesh/mechParts.js';

// A chassis that exists only here: forward legs on stilts (the shape the
// spec gives BEANPOLE) with the quadruped's turret on top, so the overrides
// and the style switch are both exercised before any real chassis uses them.
const STILTS = { ...CHASSIS.jackal, legs: 'forward', style: 'quad', geo: { hip: 5.4, l1: 3.0, l2: 2.8, stride: [3.8, 4.8] } };
const withStilts = f => { CHASSIS.stilts = STILTS; try { f(); } finally { delete CHASSIS.stilts; } };
const ALL = [...Object.keys(CHASSIS), 'stilts'];

// Walk for `secs` and fail on any planted foot that moves. `setup` can change
// the throttle or drop the mech from a height part-way.
function noSlide(chassis, { secs = 12, throttle = 1, flat = true, drop = 0 } = {}) {
  const G = createTestGame({ chassis, foes: ['jackal'], flat });
  for (const e of foes(G)) freeze(e);
  const P = G.player;
  let prev = P.feet.map(f => ({ lifted: f.lifted, pos: [...f.pos] }));
  let planted = 0, steps = 0, landed = false;
  for (let k = 0; k < secs * 60; k++) {
    P.throttle = throttle;
    if (drop && k === 240) { P.y += drop; P.air = true; P.vy = 0; }
    const wasAir = P.air;
    G.clock += DT * 1000;
    update(G, input({ turn: k > 300 && k < 420 ? 0.5 : 0 }), DT);
    if (wasAir && !P.air) landed = true;
    P.feet.forEach((f, i) => {
      if (!f.lifted && !prev[i].lifted && !P.air && !wasAir) {
        const d = Math.hypot(f.pos[0] - prev[i].pos[0], f.pos[1] - prev[i].pos[1], f.pos[2] - prev[i].pos[2]);
        assert.ok(d < 1e-3, `${chassis}: foot ${i} slid ${d.toFixed(4)} m at frame ${k}`);
        planted++;
      }
      if (f.lifted && !prev[i].lifted) steps++;
    });
    prev = P.feet.map(f => ({ lifted: f.lifted, pos: [...f.pos] }));
  }
  assert.ok(steps > 6, `${chassis}: only ${steps} steps`);
  assert.ok(planted > 500, `${chassis}: only ${planted} planted foot-frames`);
  if (drop) assert.ok(landed, `${chassis}: never landed`);
}

for (const k of ALL) {
  test(`${k}: feet never slide at half and full throttle, on hills, and after a landing`, () => withStilts(() => {
    noSlide(k, { throttle: 0.5 });
    noSlide(k, { throttle: 1 });
    noSlide(k, { throttle: 1, flat: false });
    noSlide(k, { throttle: 1, drop: 6 });
  }));
}

test('geoFor merges a chassis partial over its leg type, and moves what sits on the hip with it', () => {
  const g = geoFor(STILTS), base = GEO.forward;
  assert.equal(g.l1, 3.0); assert.equal(g.l2, 2.8); assert.equal(g.hip, 5.4);
  assert.deepEqual(g.stride, [3.8, 4.8]);
  assert.equal(g.swing, base.swing, 'unset fields come from the leg type');
  assert.ok(Math.abs(g.torsoY - (base.torsoY + 0.8)) < 1e-9 && Math.abs(g.height - (base.height + 0.8)) < 1e-9 && Math.abs(g.legTop - (base.legTop + 0.8)) < 1e-9);
  assert.equal(GEO.forward.hip, 4.6, 'the shared plan is untouched');
  assert.equal(geoFor(CHASSIS.kestrel), geoFor(CHASSIS.kestrel), 'built once per chassis');
  assert.equal(geoFor(CHASSIS.kestrel).hip, GEO.reverse.hip, 'no partial, no change');
});

test('every body plan can reach the ground with a bent knee', () => withStilts(() => {
  for (const k of ALL) {
    const g = geoFor(CHASSIS[k]), reach = g.hip - g.ankle;
    assert.ok(reach < g.l1 + g.l2 - 0.2 && reach > Math.abs(g.l1 - g.l2), `${k}: hip ${g.hip} with legs ${g.l1} + ${g.l2}`);
  }
}));

test('each chassis is under 700 triangles; legs follow the leg type and the body the style', () => withStilts(() => {
  const tris = ch => Object.values(buildMechParts(ch)).reduce((a, b) => a + b.d.length / 27, 0);
  for (const k of ALL) assert.ok(tris(CHASSIS[k]) < 700, `${k}: ${tris(CHASSIS[k])} triangles`);
  assert.equal(styleOf(CHASSIS.kestrel), 'reverse');
  const s = buildMechParts(STILTS), q = buildMechParts(CHASSIS.warden), j = buildMechParts(CHASSIS.jackal);
  assert.equal(s.torso.d.length, q.torso.d.length, 'the quad turret');
  assert.equal(s.foot.d.length, j.foot.d.length, 'forward feet');
  const top = b => Math.min(...b.d.filter((_, i) => i % 9 === 1));
  assert.ok(Math.abs(top(s.uleg) - top(j.uleg) + 0.4) < 1e-6, 'the upper leg is 0.4 longer, as l1 says');
}));
