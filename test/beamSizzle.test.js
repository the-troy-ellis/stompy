import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { damage, BEAM_CONTACT_GAP } from '../src/sim/combat.js';
import { initFeet } from '../src/sim/gait.js';
import { beamTick } from '../src/sim/beams.js';
import { center } from '../src/sim/geom.js';
import * as P from '../src/net/protocol.js';

const clangs = G => G.fx.calls('sfx.clang').length;

test('under a steady beam: one clang on contact, then none, however long it stays on', () => {
  const G = createTestGame({ foes: [] });
  const M = G.player, at = [M.x, M.y + 4, M.z];
  for (let i = 0; i < 30 * 60; i++) { damage(G, M, at, 0.001, null, true); stepFor(G, 1 / 60); }
  assert.equal(clangs(G), 1, 'thirty seconds of beam: one clang');
  stepFor(G, BEAM_CONTACT_GAP + 0.1);
  damage(G, M, at, 0.001, null, true);
  assert.equal(clangs(G), 2, 'off for a moment, then on again: a new contact');
  damage(G, M, at, 1, null, false);
  assert.equal(clangs(G), 3, 'a cannon round during the beam still clangs');
});

test('a real enemy laser held on you clangs once', () => {
  const G = createTestGame({ foes: ['kestrel'] });
  const M = G.player, e = foes(G)[0];
  Object.assign(e, { x: M.x, z: M.z + 60, yaw: Math.PI }); initFeet(G, e);
  e.ai.aware = false;
  e.weapons = e.weapons.filter(w => w.def.kind === 'beam');   // its lasers only: a cannon round or a missile would clang, as it should
  for (const k in M.hp) M.hp[k] = 1e6;
  let beamed = 0;
  for (let i = 0; i < 8 * 60; i++) {
    e.heat = 0; e.throttle = 0;
    beamTick(G, e, 1 / 60, center(M));
    if (G.beamOnAt === G.time) beamed++;
    stepFor(G, 1 / 60);
  }
  assert.ok(beamed > 6 * 60, `the beam was on for ${beamed} frames`);
  assert.equal(clangs(G), 1);
});

test('beam damage does not spark or jolt you; an impact still does', () => {
  const G = createTestGame({ foes: [] });
  const M = G.player, at = [M.x, M.y + 4, M.z];
  stepFor(G, 0.5);
  const parts = G.parts.length, v0 = M.wob.p.v;
  damage(G, M, at, 5, null, true);
  assert.equal(G.parts.length, parts, 'no sparks');
  assert.equal(M.wob.p.v, v0, 'no jolt');
  damage(G, M, at, 5, null, false);
  assert.ok(G.parts.length > parts && M.wob.p.v !== v0, 'an impact sparks and jolts');
});

test('the arena batches beam damage apart from impacts, flagged bm, and the flag round-trips', () => {
  const both = P.batchMessages({ amt: 4, bamt: 6, p: [0, 1, 2], zap: 1 }, (amt, x) => P.hit(7, amt, [0, 1, 2], false, x));
  assert.deepEqual(both, [{ t: 'hit', to: 7, amt: 4, p: [0, 1, 2], zap: 1 }, { t: 'hit', to: 7, amt: 6, p: [0, 1, 2], bm: 1 }]);
  const beamOnly = P.batchMessages({ amt: 0, bamt: 3, p: [0, 1, 2], hh: 5 }, (amt, x) => P.hit(7, amt, [0, 1, 2], false, x));
  assert.deepEqual(beamOnly, [{ t: 'hit', to: 7, amt: 3, p: [0, 1, 2], hh: 5, bm: 1 }], 'beam only: one message, flagged, carrying the heat');
  assert.equal(P.batchMessages({ amt: 5, p: [0, 0, 0] }, (amt, x) => P.hit(7, amt, [0, 0, 0], false, x)).length, 1, 'impacts only: as before');
  const back = P.parse(JSON.stringify(both[1]));
  assert.equal(back.bm, 1);
  const eh = P.batchMessages({ amt: 0, bamt: 2, p: [0, 0, 0], eid: 3 }, (amt, x) => P.ehit(3, amt, [0, 0, 0], x));
  assert.equal(eh[0].t, 'ehit'); assert.equal(eh[0].bm, 1);
});

test('a remote pilot under your beam gets its damage queued as beam damage', () => {
  const G = createTestGame({ foes: ['kestrel'] });
  const t = foes(G)[0];
  G.mode = 'mp'; t.remote = true; t.netId = 7;
  damage(G, t, [t.x, t.y + 4, t.z], 2, G.player, true);
  damage(G, t, [t.x, t.y + 4, t.z], 3, G.player, false);
  const q = G.pendingHits.get(7);
  assert.equal(q.bamt, 2); assert.equal(q.amt, 3);
});
