import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, DT } from './helpers.js';
import { update, noInput } from '../src/sim/update.js';
import { initFeet } from '../src/sim/gait.js';
import { viewYaw } from '../src/sim/geom.js';
import { aimPoint, decideFire } from '../src/sim/ai/fire.js';
import { brawler } from '../src/sim/ai/behaviours.js';
import { DIFF, FIRE } from '../src/data/ai.js';
import { WEAPONS } from '../src/data/weapons.js';

const { hypot, cos, sin } = Math;
const place = (G, m, x, z, yaw) => { Object.assign(m, { x, z, yaw }); initFeet(G, m); };
const immortal = P => { P.hp.T = 1e9; P.max.T = 1e9; };
const shotsBy = (G, e, kind) => G.shots.filter(s => s.owner === e && s.kind === kind && !s.ghost).length;

test('over a minute of a four-enemy fight on each difficulty, nobody fires past its heat cap', () => {
  const maxHeat = Math.max(...Object.values(WEAPONS).map(w => w.heat || 0));
  for (const diff of ['easy', 'normal', 'hard']) {
    const G = createTestGame({ seed: 4, foes: ['jackal', 'warden', 'jackal', 'kestrel'] });
    G.diff = diff; immortal(G.player);
    for (const e of foes(G)) { e.ai.aware = true; e.fuel = 0; }
    let worst = 0, fired = 0;
    for (let k = 0; k < 60 / DT; k++) {
      const before = foes(G).map(e => [e, e.heat, shotsBy(G, e, 'shell') + shotsBy(G, e, 'missile')]);
      G.clock += DT * 1000; update(G, noInput(), DT);
      for (const [e, h, n] of before) {
        e.fuel = 0;   // jets add heat that is not fire
        if (shotsBy(G, e, 'shell') + shotsBy(G, e, 'missile') > n) { fired++; if (h > DIFF[diff].heatCap) worst = Math.max(worst, h); }
      }
    }
    assert.ok(fired > 0, `${diff}: nobody fired a gun in a minute`);
    assert.equal(worst, 0, `${diff}: a gun fired at ${worst} heat, over the cap of ${DIFF[diff].heatCap}`);
    assert.ok(Math.max(...foes(G).map(e => e.heat)) < 100 + maxHeat);
  }
});

test('missiles need a second of lock and never fly under 120 m', () => {
  const G = createTestGame({ seed: 2, foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  immortal(P);
  place(G, e, 0, 400, Math.PI); e.ai.aware = true; e.twist = 0;
  e.weapons.forEach(w => { w.cd = 0; });
  stepFor(G, 0.6);
  assert.equal(shotsBy(G, e, 'missile'), 0, 'fired before the lock held');
  stepFor(G, 3);
  assert.ok(shotsBy(G, e, 'missile') > 0, 'no volley after a held lock');
  const G2 = createTestGame({ seed: 2, foes: ['warden'] });
  immortal(G2.player);
  const e2 = foes(G2)[0];
  place(G2, e2, 0, 100, Math.PI); e2.ai.aware = true;
  e2.ai.plan = { drive: [brawler], shape: [], brawler: true };   // walks in facing the player, so the cannon has a shot
  e2.weapons.forEach(w => { w.cd = 0; });
  stepFor(G2, 6);
  assert.equal(shotsBy(G2, e2, 'missile'), 0, 'missiles inside 120 m');
  assert.ok(shotsBy(G2, e2, 'shell') > 0, 'the cannon should still be working');
});

test('a target with its torso under a quarter gets an alpha: every ready weapon in one frame; otherwise one at a time', () => {
  const ready = (G, e) => { e.weapons.forEach(w => { w.cd = 0; }); e.ai.lockT = 2; e.ai.jitter = 0; e.ai.strafeT = 1; e.heat = 0; };
  const G = createTestGame({ seed: 7, foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  place(G, e, 0, 300, Math.PI); e.twist = 0; e.ai.aware = true;
  const ctx = { dist: 300, toYaw: Math.PI };
  ready(G, e);
  decideFire(G, e, P, ctx, DT);
  assert.equal(shotsBy(G, e, 'shell') + (shotsBy(G, e, 'missile') ? 1 : 0), 1, 'a healthy target gets one weapon per decision');
  G.shots = [];
  P.hp.T = P.max.T * 0.2;
  ready(G, e);
  decideFire(G, e, P, ctx, DT);
  assert.ok(shotsBy(G, e, 'shell') === 1 && shotsBy(G, e, 'missile') === WEAPONS.lrm.count, 'alpha should fire the cannon and the volley together');
});

test('HARD aims at the more damaged arm; NORMAL and EASY aim at the centre', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  place(G, e, 0, 200, Math.PI);
  P.hp.LA = P.max.LA * 0.3;
  const c = aimPoint(G, e, P);
  assert.deepEqual(c, [P.x, P.y + 4.2 * P.ch.scale, P.z]);
  G.diff = 'hard';
  const a = aimPoint(G, e, P), yaw = viewYaw(P);
  const lx = (a[0] - P.x) * cos(yaw) - (a[2] - P.z) * sin(yaw);   // in the player's torso frame: +x is their left
  assert.ok(lx > FIRE.armOffset * P.ch.scale * 0.9, `offset ${lx} should be toward the left arm`);
  P.hp.LA = 0;
  const b = aimPoint(G, e, P);
  const lx2 = (b[0] - P.x) * cos(yaw) - (b[2] - P.z) * sin(yaw);
  assert.ok(lx2 < 0, 'with the left arm gone it should go for the right');
  P.hp.RA = 0;
  assert.deepEqual(aimPoint(G, e, P), c, 'no arms left: the centre');
  P.hp.LA = P.max.LA; P.hp.RA = P.max.RA;
  assert.deepEqual(aimPoint(G, e, P), c, 'undamaged: the centre');
  G.diff = 'easy';
  P.hp.LA = 1;
  assert.deepEqual(aimPoint(G, e, P), c);
  void hypot;
});
