import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, DT } from './helpers.js';
import { update, noInput } from '../src/sim/update.js';
import { initFeet } from '../src/sim/gait.js';
import { damage } from '../src/sim/combat.js';
import { canSee } from '../src/sim/ai/perception.js';
import { keepRange, harass, useCover, ridge, brawler, holdLine, avoidEdge, avoidAllies, findCover, findRidge } from '../src/sim/ai/behaviours.js';
import { BEHAVIOUR as B } from '../src/data/ai.js';

const { hypot } = Math;
const place = (G, m, x, z, yaw) => { Object.assign(m, { x, z, yaw }); initFeet(G, m); };
// A block of terrain `h` high over x in (lo, hi), the length of the map.
const wall = (G, lo, hi, h) => { const base = G.ter.height; G.ter = { ...G.ter, height: (x, z) => (x > lo && x < hi ? h : base(x, z)) }; };
const immortal = P => { P.hp.T = 1e9; P.max.T = 1e9; };
// Step one frame at a time with a hook, for tests that script a condition.
function frames(G, seconds, hook) {
  for (let k = 0; k < Math.round(seconds / DT); k++) { G.clock += DT * 1000; update(G, noInput(), DT); hook?.(); }
}

test('a WARDEN at 85 heat walks to a spot without line of sight and waits there until under 35', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  immortal(P);
  wall(G, 40, 80, 60);
  place(G, e, 0, 250, Math.PI); e.ai.aware = true;
  e.ai.plan = { drive: [useCover, keepRange(e.ch.pref)], shape: [avoidEdge] };
  assert.ok(findCover(G, e, P), 'the wall should offer cover within 120 m');
  let arrived = 0, hidden = false, movedWhileHot = false, searchedInCover = false;
  frames(G, 40, () => {
    if (!arrived && e.heat < 70) e.heat = 85;   // hot until it gets there, then let it cool
    if (!arrived && e.ai.cover && hypot(e.ai.cover.x - e.x, e.ai.cover.z - e.z) < B.coverArrive) { arrived = G.time; hidden = !canSee(G, e, P); }
    if (arrived && G.time > arrived + 1.5 && e.heat > B.coverLeave + 2 && e.speed > 1) movedWhileHot = true;   // after it has stopped
    if (arrived && G.time > arrived + 3 && e.ai.cover && e.ai.state === 'search') searchedInCover = true;
  });
  assert.ok(arrived, 'never reached cover');
  assert.ok(hidden, 'the cover point still had line of sight');
  assert.equal(movedWhileHot, false, 'it should wait in cover while hot');
  assert.equal(e.ai.cover, null, 'it should leave cover once cool');
  assert.equal(searchedInCover, false, 'hiding on purpose is not losing contact');
});

test('holdLine keeps a JACKAL at the slowest ally speed within 150 m, and not beyond it', () => {
  const G = createTestGame({ foes: ['jackal', 'warden'] });
  const [j, w] = foes(G);
  immortal(G.player);
  place(G, j, 0, 600, Math.PI); place(G, w, 100, 620, Math.PI);
  for (const e of [j, w]) { e.ai.aware = true; e.ai.plan = { drive: [keepRange(e.ch.pref)], shape: [holdLine, avoidEdge] }; }
  stepFor(G, 6);
  assert.ok(j.speed > 3, `the JACKAL should be advancing (${j.speed.toFixed(1)})`);
  assert.ok(j.speed <= w.ch.speed + 0.5, `JACKAL at ${j.speed.toFixed(1)} m/s with a WARDEN alongside`);
  place(G, w, 0, 900, Math.PI);   // out of the group now
  stepFor(G, 6);
  assert.ok(j.speed > w.ch.speed + 3, `JACKAL still held back at ${j.speed.toFixed(1)} m/s`);
});

test('harass orbits inside its band and flips the strafe when hit', () => {
  const G = createTestGame({ seed: 6, foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  immortal(P);
  place(G, e, 0, 400, Math.PI); e.ai.aware = true;
  e.ai.plan = { drive: [harass], shape: [avoidEdge] };
  e.fuel = 0;   // no jumping in this one
  stepFor(G, 25);
  let inBand = 0, n = 0;
  for (let s = 0; s < 20; s++) { stepFor(G, 0.5); e.fuel = 0; n++; const d = hypot(e.x, e.z); if (d > B.harassBand[0] - 25 && d < B.harassBand[1] + 25) inBand++; }
  assert.ok(inBand >= n * 0.7, `in the band ${inBand}/${n}`);
  const side = e.ai.strafe;
  damage(G, e, [e.x, e.y + 5, e.z - 2], 1, P);
  stepFor(G, DT);
  assert.equal(e.ai.strafe, -side, 'a hit should reverse the strafe');
});

test('harass jumps over a player within 60 m and comes down behind them', () => {
  const G = createTestGame({ seed: 3, foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  immortal(P);
  place(G, e, 0, 30, Math.PI); e.ai.aware = true; e.fuel = 1;
  e.ai.plan = { drive: [harass], shape: [] };
  let flew = false, behind = false, minD = 1e9;
  frames(G, 6, () => { if (e.air && e.jetting) flew = true; if (e.z < -5) behind = true; minD = Math.min(minD, hypot(e.x, e.z)); });
  assert.ok(flew, 'never used the jets');
  // Landing on the player instead is a stomp, which is also fine by Stompy.
  const stomped = G.fx.calls('sfx.punch').some(c => c.args[1] === true);
  assert.ok(behind || stomped, `never got behind or on top (closest ${minD.toFixed(1)} m)`);
});

test('ridge picks a spot 15 m up with line of sight and walks to it', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  immortal(P);
  wall(G, 100, 140, 25);   // a plateau east of the player
  place(G, e, 0, 300, Math.PI); e.ai.aware = true;
  e.ai.plan = { drive: [ridge, keepRange(e.ch.pref)], shape: [] };
  const r = findRidge(G, e, P);
  assert.ok(r && r.x > 100 && r.x < 140, `ridge at ${r && [r.x, r.z]}`);
  const d0 = hypot(r.x - e.x, r.z - e.z);
  stepFor(G, 8);
  assert.ok(e.ai.ridge, 'no ridge chosen');
  const d1 = hypot(e.ai.ridge.x - e.x, e.ai.ridge.z - e.z);
  assert.ok(d1 < d0 - 30, `not closing on the ridge (${d0.toFixed(0)} -> ${d1.toFixed(0)})`);
});

test('brawler closes to reach and punches, and never backs out of the player\'s reach', () => {
  const G = createTestGame({ seed: 5, foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  immortal(P); G.diff = 'hard';
  place(G, e, 0, 200, Math.PI); e.ai.aware = true;
  e.ai.plan = { drive: [brawler], shape: [], brawler: true };
  stepFor(G, 40);
  assert.ok(G.fx.calls('sfx.punch').some(c => c.args[1] === true), 'never landed a punch');
  const d = hypot(e.x - P.x, e.z - P.z);
  assert.ok(d < 25, `backed off to ${d.toFixed(0)} m from the player`);   // the player skids under the punches; it follows
});

test('avoidAllies steers around an ally in the way; the collision pass lets a mech pass clear over another', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal'] });
  const [a, b] = foes(G);
  place(G, a, 0, 100, Math.PI); place(G, b, 0, 94, Math.PI);
  const out = avoidAllies(G, b, {}, { moveYaw: 0, thr: 1 });   // b heading +z, straight into a
  assert.notEqual(out.moveYaw, 0);
  const straight = avoidAllies(G, a, {}, { moveYaw: 0, thr: 1 });   // a heading +z, b is behind it
  assert.equal(straight.moveYaw, 0);
  // Over the top: no sideways shove while one is above the other.
  place(G, a, 0, 300, 0); place(G, b, 0, 300, 0); b.y = a.y + 20; b.vy = 0;
  G.player.x = 500;   // out of the way
  stepFor(G, DT);
  assert.ok(Math.abs(a.x) < 0.01 && Math.abs(b.x) < 0.01, 'separated although one was in the air above');
});
