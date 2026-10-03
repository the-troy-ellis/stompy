import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEL, FEEL_EVENTS, FEEL_COLS } from '../src/data/feel.js';
import { makeSpring, stepSpring, kickSpring } from '../src/util/spring.js';
import { feel, initFeel } from '../src/sim/feel.js';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { damage } from '../src/sim/combat.js';
import { initFeet } from '../src/sim/gait.js';

test('the table is complete: every event row has every column, finite and non-negative', () => {
  for (const ev of FEEL_EVENTS) for (const c of FEEL_COLS) {
    const v = FEEL[ev][c];
    assert.ok(Number.isFinite(v) && v >= 0, `${ev}.${c} = ${v}`);
  }
  assert.ok(FEEL.view.shakeMax > 0 && FEEL.spring.squashK > 0);
});

test('every row is wired: firing the event moves exactly what its row says', () => {
  for (const ev of FEEL_EVENTS) {
    const G = createTestGame({ foes: [] });
    const P = G.player, row = FEEL[ev];
    G.kick = 0; G.shake = 0; G.flash = 0; G.whiteFlash = 0;
    feel(G, ev, { mech: P, k: 1, roll: 0.5 });
    assert.equal(G.kick, row.kick, `${ev} kick`);
    assert.equal(G.shake, Math.min(FEEL.view.shakeMax, row.shake), `${ev} shake`);
    assert.equal(G.flash, Math.min(FEEL.view.flashMax, row.flash), `${ev} flash`);
    assert.equal(G.whiteFlash, row.white, `${ev} white`);
    assert.equal(P.squash.v > 0, row.squash > 0, `${ev} squash`);
    assert.equal(P.wob.p.v > 0, row.wobble > 0, `${ev} wobble pitch`);
    assert.equal(P.wob.r.v > 0, row.wobble > 0, `${ev} wobble roll`);
    const thumps = G.fx.calls('thump');
    if (row.bass || row.duck || row.haptic) {
      assert.equal(thumps.length, 1, `${ev} thump`);
      assert.deepEqual(thumps[0].args.slice(0, 3), [row.bass, row.duck, row.haptic]);
    } else assert.equal(thumps.length, 0);
  }
});

test('intensity scales the row, an enemy event leaves the camera alone, and k = 0 does nothing', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  G.shake = 0; G.kick = 0;
  feel(G, 'hit', { mech: e, k: 2 });
  assert.equal(G.shake, 0); assert.equal(G.kick, 0);
  assert.ok(e.wob.p.v > 0);
  assert.equal(G.fx.calls('thump')[0].args[2], 0, 'no haptics for someone else');
  feel(G, 'hit', { mech: G.player, k: 2 });
  assert.ok(Math.abs(G.shake - Math.min(FEEL.view.shakeMax, FEEL.hit.shake * 2)) < 1e-9);
  const before = G.fx.calls('thump').length;
  feel(G, 'land', { mech: G.player, k: 0 });
  assert.equal(G.fx.calls('thump').length, before);
});

test('springs converge: a kick settles within 2 s with no NaN; the under-damped one rings first', () => {
  const crit = makeSpring(160, 1), ring = makeSpring(90, 0.35);
  kickSpring(crit, 3); kickSpring(ring, 3);
  let crossed = false, peakC = 0, peakR = 0;
  for (let t = 0; t < 2; t += 1 / 60) {
    const c = stepSpring(crit, 1 / 60), r = stepSpring(ring, 1 / 60);
    assert.ok(Number.isFinite(c) && Number.isFinite(r));
    peakC = Math.max(peakC, Math.abs(c)); peakR = Math.max(peakR, Math.abs(r));
    if (r < -1e-4) crossed = true;
  }
  assert.ok(Math.abs(crit.x) < 1e-3 && Math.abs(ring.x) < 1e-3, `did not settle: ${crit.x} ${ring.x}`);
  assert.ok(crossed, 'the under-damped spring never overshot');
  assert.ok(peakC < 0.3 && peakR < 0.5, `peaks ${peakC} ${peakR}`);
  // A big frame (the 50 ms cap) stays stable too.
  const s = makeSpring(160, 0.7); kickSpring(s, 5);
  for (let i = 0; i < 60; i++) assert.ok(Math.abs(stepSpring(s, 0.05)) < 10);
});

test('in play: landing squashes and thumps, a hit wobbles toward the blow, footfalls thump by weight', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 60, z: 0 }); initFeet(G, e); freeze(e);
  stepFor(G, 1.2, input({ jets: true }));
  stepFor(G, 3);
  const land = G.fx.calls('thump').filter(c => c.args[0] >= FEEL.land.bass * 0.25);
  assert.ok(land.length >= 1, 'no landing thump');
  // A hit from the mech's right (−x in torso space when facing +z) rolls it left.
  initFeel(P);
  damage(G, P, [P.x - 2.5, P.y + 5, P.z], 10, e);
  assert.ok(P.wob.p.v > 0 && P.wob.r.v > 0, `wobble ${P.wob.p.v} ${P.wob.r.v}`);
  // Walking: a KESTREL's steps thump; the sound is placed only for other mechs.
  const n0 = G.fx.calls('thump').length;
  stepFor(G, 4, input({ thrUp: true }));
  const thumps = G.fx.calls('thump').slice(n0).filter(c => c.args[0] > 0 && c.args[0] <= FEEL.step.bass * 1.01);
  const mine = thumps.filter(c => c.args[3] === null), theirs = thumps.filter(c => c.args[3] !== null);
  assert.ok(mine.length >= 6, `only ${mine.length} step thumps`);
  assert.ok(theirs.every(c => Array.isArray(c.args[3]) && c.args[3].length === 3), 'another mech\'s step must carry a position');
});

test('hotFrac is 0 up to 85 heat, 1 at shutdown, and linear between', async () => {
  const { hotFrac, HEAT } = await import('../src/data/feel.js');
  assert.equal(hotFrac(0), 0);
  assert.equal(hotFrac(HEAT.from), 0);
  assert.ok(Math.abs(hotFrac((HEAT.from + HEAT.to) / 2) - 0.5) < 1e-9);
  assert.equal(hotFrac(HEAT.to), 1);
  assert.equal(hotFrac(140), 1);
});
