import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center, rayHit } from '../src/sim/geom.js';
import { fire } from '../src/sim/combat.js';
import { blast, cycleTarget, BLAST_R } from '../src/sim/missiles.js';
import { applyLoadout } from '../src/sim/loadout.js';
import { addEntity, BLOCK_AHEAD, FALL_TIME, fallAngle } from '../src/sim/entities.js';
import { meleeTarget } from '../src/sim/melee.js';

const { hypot } = Math;
// A test game with nobody else about: the foes are moved far off and frozen.
function quiet(opts = {}) {
  const G = createTestGame({ foes: ['jackal'], ...opts });
  for (const e of foes(G)) { Object.assign(e, { x: 900, z: 900 }); initFeet(G, e); freeze(e); }
  return G;
}

test('a vehicle drives its waypoints at its speed and stops at the last one', () => {
  const G = quiet();
  const v = addEntity(G, { kind: 'vehicle', x: 100, z: 0, path: [[100, 60], [160, 60]], speed: 8 });
  stepFor(G, 2);
  assert.ok(Math.abs(v.z - 16) < 1, `after 2 s at 8 m/s it should be 16 m on (${v.z.toFixed(1)})`);
  stepFor(G, 20);
  assert.ok(v.arrived && hypot(v.x - 160, v.z - 60) < 3.5, `ended at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`);
  assert.ok(Math.abs(v.y - G.ter.height(v.x, v.z)) < 1e-9, 'it sits on the ground');
});

test('a convoy stops behind a mech in its path and resumes when the mech moves', () => {
  const G = quiet();
  const v = addEntity(G, { kind: 'vehicle', x: 100, z: 0, path: [[100, 200]], speed: 8 });
  const P = G.player;
  Object.assign(P, { x: 100, z: 30 }); initFeet(G, P);
  stepFor(G, 4);
  assert.ok(v.blocked && v.speed === 0, 'it should be waiting');
  assert.ok(30 - v.z <= BLOCK_AHEAD + 2.5 && 30 - v.z > 3, `stopped ${(30 - v.z).toFixed(1)} m short`);
  const z0 = v.z;
  Object.assign(P, { x: 140, z: 30 }); initFeet(G, P);
  stepFor(G, 2);
  assert.ok(!v.blocked && v.z > z0 + 10, 'and drives on once the road is clear');
  const w = addEntity(G, { kind: 'vehicle', x: 100, z: v.z - 12, path: [[100, 400]], speed: 12 });
  v.cruise = 0;   // the lead stalls; the one behind waits for it
  stepFor(G, 3);
  assert.ok(w.blocked && v.z - w.z > 3, 'a truck does not drive into the one in front');
});

test('a shot hits a structure before the mech behind it, and a blast hurts structures in its radius', () => {
  const G = quiet();
  const s = addEntity(G, { x: 0, z: 40, hp: 50, height: 12 });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 80 }); initFeet(G, e);
  const hit = rayHit(G, center(P), [0, 0, 1], 200, P);
  assert.equal(hit.ent, s);
  assert.equal(hit.mech, null);
  const near = addEntity(G, { x: 200, z: 0, hp: 50 }), out = addEntity(G, { x: 260, z: 0, hp: 50 });
  blast(G, [200 - near.radius - 2, near.y + 2, 0], 20, P, null);
  assert.ok(near.hp < 50, 'inside the radius it takes damage');
  assert.equal(out.hp, 50, `outside ${BLAST_R} m it does not`);
});

test('every weapon kind can knock a structure down: shell, beam, missiles and a punch', () => {
  const kinds = { ac: 't1', laser: 'la', lrm: 't2' };
  for (const [w, slot] of Object.entries(kinds)) {
    const G = quiet();
    const s = addEntity(G, { x: 0, z: 120, hp: 6, height: 10 });
    const P = G.player;
    applyLoadout(G, P, { hp: { la: null, ra: null, t1: null, t2: null, [slot]: w }, sys: { sinks: 0, armour: 0, jets: 1 } });
    G.aim = center(s);
    if (w === 'laser') stepFor(G, 3, input({ held: { energy: true } }));
    else { const wp = P.weapons.find(x => x.type === w); wp.cd = 0; assert.ok(fire(G, P, wp, center(s), w === 'lrm' ? s : null)); stepFor(G, 4); }   // LRMs home on a locked structure
    assert.ok(!s.alive && s.wreck, `${w} did not bring it down (hp ${s.hp})`);
  }
});

test('a punched-down tower topples toward the puncher\'s facing; it stays a wreck', () => {
  const G = quiet();
  const s = addEntity(G, { x: 0, z: 9, hp: 5, height: 14 });
  const P = G.player;
  assert.equal(meleeTarget(G, P), s, 'the fist lights up for a structure');
  stepFor(G, DT, input({ punch: true }));
  stepFor(G, 1);
  assert.ok(!s.alive && s.fall, 'it should be falling');
  assert.ok(Math.abs(s.fall.yaw - 0) < 0.05, `away from the fist (fall yaw ${s.fall.yaw.toFixed(2)})`);
  stepFor(G, FALL_TIME);
  assert.ok(Math.abs(fallAngle(s) - Math.PI / 2) < 1e-6, 'flat on the ground');
});

test('nothing walks through a structure; T and R can target one; a decorative one only sparks', () => {
  const G = quiet();
  const s = addEntity(G, { x: 0, z: 30, hp: 40, radius: 4, label: 'RELAY' });
  const P = G.player;
  stepFor(G, 8, input({ thrUp: true }));
  assert.ok(hypot(P.x - s.x, P.z - s.z) >= s.radius + 2, 'the mech is stopped at the footprint');
  G.mechs.filter(m => m.team).forEach(m => { m.alive = false; });
  cycleTarget(G);
  assert.equal(G.target, s);
  assert.equal(G.target.ch.name, 'RELAY');
  const deco = addEntity(G, { x: 50, z: 0, hp: Infinity });
  assert.equal(deco.targetable, false);
  blast(G, [50, deco.y + 2, 0], 999, P, null);
  assert.ok(deco.alive, 'decorative structures do not fall');
  const truck = addEntity(G, { kind: 'vehicle', x: 80, z: 0 });
  assert.equal(truck.targetable, false, 'your own convoy is not a target');
});
