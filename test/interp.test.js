import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from './helpers.js';
import { newMech } from '../src/sim/state.js';
import { applyRemote } from '../src/net/remote.js';
import { netInterp, INTERP_DELAY } from '../src/net/interp.js';
import { makeRng } from '../src/sim/rng.js';

// Acceptance 2 (spec 10 § Latency): a mech walking at 10 m/s, reported 15
// times a second with the sender's clock (ts), the reports arriving 120 ± 40
// ms late (in order, as a WebSocket delivers them). Drawn at 60 fps, it must move smoothly (no frame
// jumps more than twice the walking step: no snapping, no rubber-band) and
// stay close to where it truly was a moment ago.
function walk({ latency = 120, jitter = 40, seconds = 8, speed = 10 } = {}) {
  const G = createTestGame({ foes: [] }), r = makeRng(9), rand = () => r.next();
  const m = newMech(G, 'kestrel', 2, 0, 0, 0);
  Object.assign(m, { remote: true, netId: 2, net: null });
  // The truth: walking north, turning gently.
  const truth = t => { const yaw = 0.15 * t; return { x: Math.sin(yaw) * 0 + speed * Math.sin(0.075 * t) * t * 0.5, z: speed * t * Math.cos(0.075 * t), yaw }; };
  const sends = [];
  let lastArrive = 0;
  for (let t = 0; t < seconds; t += 1 / 15) {
    const p = truth(t), arrive = Math.max(lastArrive, t * 1000 + latency + (rand() * 2 - 1) * jitter);
    lastArrive = arrive;
    sends.push({ arrive, s: { t: 's', ts: Math.round(t * 1000), x: p.x, y: G.ter.height(p.x, p.z), z: p.z, yaw: p.yaw, tw: 0, p: 0, sp: speed, air: 0, al: 1, sd: 0 } });
  }
  let i = 0, worstStep = 0, worstErr = 0, prev = null;
  const dt = 1 / 60;
  for (let now = 0; now < seconds * 1000; now += dt * 1000) {
    while (i < sends.length && sends[i].arrive <= now) applyRemote(G, m, sends[i++].s, sends[i - 1].arrive);
    if (!m.net) continue;
    netInterp(m, dt, now);
    if (now > 1500) {   // settled
      if (prev) worstStep = Math.max(worstStep, Math.hypot(m.x - prev[0], m.z - prev[1]) / (speed * dt));
      // Where it truly was latency + delay ago (what a viewer can at best see).
      const p = truth((now - latency - INTERP_DELAY) / 1000);
      worstErr = Math.max(worstErr, Math.hypot(m.x - p.x, m.z - p.z));
    }
    prev = [m.x, m.z];
  }
  return { worstStep, worstErr };
}

test('acceptance 2: 120 ± 40 ms of jitter, and a walking mech still glides: no snaps, close to its true path', () => {
  const { worstStep, worstErr } = walk();
  console.log(`  worst frame step ${worstStep.toFixed(2)}× a walking step; worst error ${worstErr.toFixed(2)} m`);
  // Before the delay buffer (extrapolating from the newest report): 1.49× and 0.56 m on this walk.
  assert.ok(worstStep < 1.35, `no frame jumps: at most 1.35 walking steps (${worstStep.toFixed(2)})`);
  assert.ok(worstErr < 0.5, `within 0.5 m of where it was ${(120 + INTERP_DELAY)} ms ago (${worstErr.toFixed(2)} m)`);
});

test('on a LAN (10 ms, little jitter) it glides as well', () => {
  const { worstStep, worstErr } = walk({ latency: 10, jitter: 4 });
  console.log(`  LAN: worst frame step ${worstStep.toFixed(2)}×; worst error ${worstErr.toFixed(2)} m`);
  assert.ok(worstStep < 1.35, worstStep.toFixed(2));
  assert.ok(worstErr < 0.5, worstErr.toFixed(2));
});
