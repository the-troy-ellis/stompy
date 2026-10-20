import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes, freeze } from './helpers.js';
import { damage, DEATH_BEAT, DEATH_BUCKLE, DEATH_TOPPLE, WRECK_SETTLE } from '../src/sim/combat.js';
import { toppleOf } from '../src/render/scene.js';
import { M } from '../src/util/math.js';
import { VOICE } from '../src/data/voice.js';

test('a kill is a beat of silence, then the blast, then a topple, then a wreck that pops', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal'] });
  const e = foes(G)[0];
  freeze(foes(G)[1]);
  const t0 = G.time;
  damage(G, e, [e.x, e.y + 5, e.z], 1000, G.player);
  assert.equal(e.alive, false, 'dead at once for gameplay');
  assert.ok(e.dying, 'but still falling for the show');
  assert.equal(G.stats.kills, 1);
  assert.equal(G.fx.calls('sfx.whine').length, 1);
  assert.equal(G.fx.calls('sfx.boom').length, 0, 'no bang during the beat');
  assert.equal(G.wrecks.length, 0);
  stepFor(G, DEATH_BEAT - 0.03);
  assert.equal(G.fx.calls('sfx.boom').length, 0);
  assert.equal(e.dying.angle, 0, 'frozen during the beat');
  stepFor(G, 0.1);
  const booms = G.fx.calls('sfx.boom');
  assert.ok(booms.length >= 2, 'the torso blew');
  assert.ok(booms[0].t - t0 >= DEATH_BEAT - 1e-6, `bang at +${(booms[0].t - t0).toFixed(3)} s`);
  // The blast takes the arms and a shower of plates with it.
  assert.equal(e.hp.LA, 0); assert.equal(e.hp.RA, 0);
  assert.equal(G.debris.filter(d => d.part === 'arm').length, 2, 'both arms should be flying');
  assert.ok(G.debris.filter(d => d.part === 'plate').length >= 4, 'plates should be flying');
  // The legs buckle before the topple: the hull drops, the body only leans.
  assert.ok(e.dying.drop > 0 && e.dying.buckle > 0 && e.dying.buckle < 1, `buckling: drop ${e.dying.drop} buckle ${e.dying.buckle}`);
  assert.ok(e.dying.angle > 0 && e.dying.angle < 0.3);
  stepFor(G, DEATH_BUCKLE);
  assert.equal(e.dying.buckle, 1);
  assert.ok(e.dying.angle < 0.4, 'still mostly upright as the topple starts');
  stepFor(G, DEATH_TOPPLE);
  assert.equal(e.dying, null);
  assert.ok(e.gone);
  assert.equal(G.wrecks.length, 1);
  assert.ok(G.wrecks[0].pops.length >= 2);
  assert.ok(G.wrecks[0].settle < 1, 'a fresh wreck is still settling');
  stepFor(G, WRECK_SETTLE + 0.1);
  assert.equal(G.wrecks[0].settle, 1);
  const before = G.fx.calls('sfx.boom').length;
  stepFor(G, 4);
  assert.ok(G.fx.calls('sfx.boom').length > before, 'no secondaries');
  assert.equal(G.wrecks[0].pops.length, 0);
  // The voice waits for the bang.
  const said = G.fx.calls('say').find(c => VOICE.kill.includes(c.args[0]));
  assert.ok(said && said.args[2] >= DEATH_BEAT * 1000);
});

test('the topple rotates about the ground under the mech: the feet stay, the head swings', () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  assert.equal(toppleOf(e), null);
  e.dying = { t: 1, exploded: true, angle: Math.PI / 2, fallYaw: e.yaw, roll: 0 };
  const T = toppleOf(e);
  const foot = M.apply(T, [e.x, e.y, e.z]), head = M.apply(T, [e.x, e.y + 8, e.z]);
  assert.ok(Math.hypot(foot[0] - e.x, foot[1] - e.y, foot[2] - e.z) < 0.01, 'the pivot moved');   // float32 matrices, hundreds of metres out
  assert.ok(head[1] < e.y + 0.5, `head still up at ${head[1]}`);
  assert.ok(Math.hypot(head[0] - e.x, head[2] - e.z) > 7.5, 'head did not swing out');
});

test('the player dies the same way and the match still ends on time', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  damage(G, P, [P.x, P.y + 5, P.z], 1000, e);
  assert.equal(G.state, 'over');
  assert.ok(P.dying);
  stepFor(G, DEATH_BEAT + DEATH_BUCKLE + DEATH_TOPPLE + 0.05);
  assert.ok(P.gone && G.wrecks.length === 1);
  assert.ok(G.fx.calls('thump').some(c => c.args[0] >= 1), 'the death row did not thump');
  stepFor(G, 2.5);
  assert.equal(G.state, 'debrief');
});

// #259: your view goes down with the body and stays down until the debrief;
// it never snaps back to the standing eye over your own wreck.
test('after the topple, your view stays where the fall left it, rolled with the body', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  damage(G, P, [P.x, P.y + 5, P.z], 1000, e);
  P.dying.roll = 1;   // a fall to the side
  let last = null;
  while (P.dying) { last = toppleOf(P); stepFor(G, 1 / 60); }
  assert.ok(P.gone && P.fallen, 'the fall is kept');
  const end = toppleOf(P);
  // The rotation to a tenth; the translation a little looser, as the body now lies in its own crater, metres from the origin it turns about.
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(end[i] - last[i]) < (i >= 12 ? 0.6 : 0.1), 'the kept fall is where the topple ended');
  const rot = (T, v) => { const o = M.apply(T, [0, 0, 0]), p = M.apply(T, v); return [p[0] - o[0], p[1] - o[1], p[2] - o[2]]; };
  for (const dt of [0.1, 1, 0.6]) {   // to just before the debrief (G.endT = 3.2 s from the kill)
    stepFor(G, dt);
    assert.equal(G.state, 'over');
    const T = toppleOf(P);
    assert.ok(T, 'the view still falls');
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(T[i] - end[i]) < 1e-6, `the view moved after the fall (element ${i})`);
    const eye = M.apply(T, G.eye);
    assert.ok(eye[1] < G.eye[1] - 3, `the eye is back up at ${eye[1].toFixed(1)} (standing ${G.eye[1].toFixed(1)})`);
    assert.ok(Math.abs(rot(T, [0, 1, 0])[1]) < 0.5, 'up is still up: the view did not roll with the body');
  }
  stepFor(G, 3);
  assert.equal(G.state, 'debrief');
});

test('the fall is only kept for your own view: a foe goes down to a wreck', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  damage(G, e, [e.x, e.y + 5, e.z], 1000, G.player);
  stepFor(G, DEATH_BEAT + DEATH_BUCKLE + DEATH_TOPPLE + 0.05);
  assert.ok(e.gone && !e.fallen && toppleOf(e) === null);
});
