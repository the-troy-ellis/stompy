// Mechs on the voxel ground (docs/specs/18-voxel-ground.md § Mechs on 3D
// ground, acceptance 4 to 6): tunnels, walls, ceilings, ground dug out from
// under a mech, feet in a tunnel, and an overhang in the way of a shot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { makeGround } from '../src/world/voxels.js';
import { polar } from '../src/sim/placement.js';
import { initFeet } from '../src/sim/gait.js';
import { blocked } from '../src/sim/sight.js';
import { rayHit, center, eyeOf } from '../src/sim/geom.js';
import { geoOf } from '../src/data/geo.js';

const { hypot, max, PI } = Math;

// A test game on flat ground with `landmarks`, the player at (x, z) facing `yaw`.
function world(landmarks, x, z, yaw = 0, chassis = 'kestrel') {
  const G = createTestGame({ chassis });
  for (const e of foes(G)) { freeze(e); e.x = 900; e.z = -900; }
  G.ter = makeGround(1, { flat: true }, { ground: { landmarks } });
  const P = G.player;
  Object.assign(P, { x, z, yaw, twist: 0, speed: 0, throttle: 0, vy: 0, air: false });
  P.y = G.ter.groundBelow(x, 3, z);
  initFeet(G, P);
  return G;
}
const walk = (G, seconds, each) => { for (let t = 0; t < seconds; t += 0.25) { stepFor(G, 0.25, input({ thrUp: true })); each?.(G.player); } };

// A mesa 60 m high centred 400 m north, and a tunnel through it from 250 m to 550 m.
const MESA = { kind: 'mesa', at: [0, 400], r: 80, top: 60, lip: 0 };
const tunnel = (r, y) => ({ kind: 'tunnel', from: [0, 250, y], to: [0, 550, y], r });

test('a mech walks through a tunnel on its floor, and comes out the far side', () => {
  const G = world([MESA, tunnel(10, 11)], 0, 230), P = G.player;
  let top = -Infinity;
  walk(G, 30, p => { if (p.z > 340 && p.z < 460) top = max(top, p.y); });
  assert.ok(P.z > 500, `out the far side: z ${P.z.toFixed(0)}`);
  assert.ok(top < 4, `on the floor all the way (highest ${top.toFixed(1)} m), never on the mesa's top`);
});

test('a tunnel too low for it turns a mech back at the mouth', () => {
  const G = world([MESA, tunnel(3, 3)], 0, 230), P = G.player;
  walk(G, 15);
  const mouth = polar([0, 400]).z - 80;
  assert.ok(P.z < mouth + 8, `stopped at the mouth: z ${P.z.toFixed(1)} vs ${mouth} (8 m cells round it)`);
  assert.ok(P.walled, 'against the rock');
  assert.ok(Math.abs(P.slide) < 1, 'and its legs stop with it');
});

test('a mech meeting a wall at an angle slides along it', () => {
  const G = world([], 0, 0, PI / 4), P = G.player;
  G.ter.block(30, 60, -1150, 1150, 40);
  walk(G, 12);
  const R = geoOf(P).radius * P.ch.scale;
  assert.ok(P.x < 30 - R * 0.5, `kept out of the wall: x ${P.x.toFixed(1)}`);
  assert.ok(P.x > 20, `but walked up to it: x ${P.x.toFixed(1)}`);
  assert.ok(P.z > 60, `and slid along it: z ${P.z.toFixed(1)}`);
});

test('the jets stop at a ceiling', () => {
  const G = world([], 0, 0), P = G.player;
  G.ter.block(-80, 80, -80, 80, 70);
  G.ter.carve([0, 20, 0], 24);   // a room in the rock: floor about -4 m, roof about 44 m
  P.y = G.ter.groundBelow(0, 20, 0); initFeet(G, P);
  const roof = 20 + 24, head = geoOf(P).height * P.ch.scale;
  let highest = -Infinity;
  stepFor(G, 1, input({ jets: true }));   // a full charge, then let go (docs/specs/26-blast-off.md)
  for (let t = 0; t < 4; t += 0.1) { stepFor(G, 0.1); highest = max(highest, P.y + head); }
  assert.ok(highest - head > 10, `the jets did lift it: ${(highest - head).toFixed(1)}`);
  assert.ok(highest < roof + 1.5, `its head stays under the roof: ${highest.toFixed(1)} vs ${roof}`);
});

test('ground dug out from under a mech drops it, and it lands', () => {
  const G = world([], 0, 0), P = G.player;
  stepFor(G, 0.5);
  const before = P.y;
  G.ter.carve([0, 0, 0], 7);
  let wasAir = false;
  for (let t = 0; t < 3; t += 1 / 60) { stepFor(G, 1 / 60); wasAir ||= P.air; }
  assert.ok(P.y < before - 3, `it went down: ${before.toFixed(1)} -> ${P.y.toFixed(1)}`);
  assert.ok(wasAir && !P.air, 'it fell, then stood');
  assert.ok(G.fx.calls('sfx.land').length >= 1, 'with a landing');
  assert.ok(Math.abs(P.y - G.ter.groundBelow(P.x, P.y + 2, P.z)) < 0.05, 'on the crater floor');
});

test('in a tunnel, every planted foot stands on the floor, within 0.6 m of it', () => {
  const G = world([MESA, tunnel(10, 11)], 0, 330), P = G.player;
  walk(G, 4);
  assert.ok(P.z > 340 && P.z < 460, 'inside');
  for (const f of P.feet) {
    if (f.lifted) continue;
    const floor = G.ter.groundBelow(f.pos[0], P.y + 4, f.pos[2]);
    assert.ok(Math.abs(f.pos[1] - floor) < 0.6, `a foot at ${f.pos[1].toFixed(2)}, the floor at ${floor.toFixed(2)}`);
    assert.ok(f.pos[1] < 5, 'not up on the roof');
  }
});

test('an arch lets a shot through its opening; an overhang stops one its open top would not', () => {
  const G = world([{ kind: 'arch', at: [0, 300], r: 46, thick: 9, face: 0 }, { kind: 'mesa', at: [90, 500], r: 50, top: 60, lip: 24 }], 0, 200);
  const e = foes(G)[0], c = polar([0, 300]);
  // Through the arch: the foe beyond it is hit, and seen.
  Object.assign(e, { x: c.x, z: c.z + 80, alive: true }); e.y = G.ter.groundBelow(e.x, 5, e.z);
  const from = [c.x, 6, c.z - 80], to = center(e), d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], L = hypot(...d);
  assert.equal(blocked(G, from, to), false, 'seen through the opening');
  assert.equal(rayHit(G, from, d.map(v => v / L), L + 5).mech, e, 'and shot through it');
  // Under the mesa's lip, looking up past its edge: the lip is in the way.
  const m = polar([90, 500]), under = [m.x - 50 - 12, 6, m.z], above = [m.x - 50 - 30, 75, m.z];   // up and out through the lip (30 to 60 m up, out to 74 m)
  assert.ok(G.ter.height(under[0], under[2]) > 50, 'the top surface there is the lip');
  const u = [above[0] - under[0], above[1] - under[1], above[2] - under[2]], Lu = hypot(...u);
  assert.equal(blocked(G, under, above), true, 'the lip blocks the view');
  const hit = rayHit(G, under, u.map(v => v / Lu), Lu);
  assert.ok(hit && !hit.mech && !hit.ent && hit.t < Lu, 'and the shot hits the rock');
  // The same line with only the open ground (no lip) is clear.
  G.ter = makeGround(1, { flat: true });
  assert.equal(blocked(G, under, above), false);
});

test('walking into a pocket the bucket dug, the cockpit stops short of its roof', () => {
  // The digger bites the mesa's face at chest height, then keeps walking in:
  // the hollow fits its chest, but its roof sits at eye height. The view must
  // stay out of the rock (it would see through the inside of the ground).
  const G = world([MESA], 0, polar([0, 400]).z - 80 - 12, 0, 'digger'), P = G.player;
  let worst = Infinity;
  for (let t = 0; t < 14; t += 0.25) {
    stepFor(G, 0.25, input({ thrUp: true, held: { energy: t > 1 } }));
    const e = eyeOf(P), a = P.yaw + P.twist;
    for (let r = 0.1; r <= 0.6; r += 0.1) for (const up of [0, 0.3]) if (G.ter.solid(e[0] + Math.sin(a) * r, e[1] + up, e[2] + Math.cos(a) * r)) worst = Math.min(worst, r);
  }
  assert.ok(P.ore > 0, `it dug: ${P.ore} ore`);
  assert.equal(worst, Infinity, `rock ${worst.toFixed(1)} m in front of the eye`);
});

test('turning against a face the bucket dug, the view still never shows the inside of the ground', async () => {
  // Turning isn't a move, so the walk's cab sample doesn't see it: the
  // camera's own guard (render/scene.js clearEye) slides the eye back into the body.
  const { clearEye } = await import('../src/render/scene.js');
  const G = world([MESA], 0, polar([0, 400]).z - 80 - 12, 0, 'digger'), P = G.player;
  let raw = 0, seen = 0;
  for (let t = 0; t < 20; t += 0.1) {
    stepFor(G, 0.1, input({ thrUp: true, held: { energy: true }, turn: t > 6 ? 1 : 0 }));
    const e = eyeOf(P), a = P.yaw + P.twist, d = [Math.sin(a) * Math.cos(P.pitch), Math.sin(P.pitch), Math.cos(a) * Math.cos(P.pitch)];
    const near = q => G.ter.solid(q[0], q[1], q[2]) || G.ter.solid(q[0] + d[0] * 0.6, q[1] + d[1] * 0.6, q[2] + d[2] * 0.6);
    if (near(e)) raw++;
    if (near(clearEye(G.ter, e, d, P.x, P.y + geoOf(P).torsoY * P.ch.scale, P.z))) seen++;
  }
  assert.ok(P.ore > 0, 'it dug');
  assert.ok(raw > 0, 'the turn did bring rock up to the cab (the case this guards)');
  assert.equal(seen, 0, 'and the guarded eye never had rock in front of it');
});
