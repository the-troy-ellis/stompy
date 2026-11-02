// The mechs' grid (docs/specs/34-big-fights.md part 2): it finds what looking
// at every mech finds, so a fight runs exactly as it did without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { shiftMech } from '../src/sim/walkView.js';
import { buildNear, dropNear, mechsNear, mechsAlong, NEAR_PAD } from '../src/sim/near.js';
import { HALF } from '../src/world/terrain.js';
import { makeRng } from '../src/sim/rng.js';

const FOES = ['jackal', 'jackal', 'kestrel', 'jackal', 'warden'];
// A Free Play fight, every foe close and after you, you standing and unhurt.
function fight(n, off = false) {
  const G = createGame({ fx: recordFx(), seed: 1234 });
  startMatch(G, { name: 'Near', pal: 'dusk', foes: Array.from({ length: n }, (_, i) => FOES[i % FOES.length]), intel: '' }, 1234, false, 'kestrel');
  G.mode = 'sp'; G.cheats = { god: true }; G.nearOff = off;
  const P = G.player;
  G.mechs.filter(m => m !== P && m.ai).forEach((m, i) => {
    const a = i * 2.39996, d = 60 + (i * 37) % 120;
    shiftMech(m, P.x + Math.sin(a) * d - m.x, P.z + Math.cos(a) * d - m.z);
    m.ai.aware = true; m.ai.frozen = false;
  });
  return G;
}
const state = G => G.mechs.map(m => [m.x, m.y, m.z, m.yaw, m.alive, Object.values(m.hp ?? {}).join(), m.heat].join('|'));

test('a seeded 20-foe fight ends the same with the grid and without it', () => {
  const a = fight(20), b = fight(20, true), start = state(a);
  for (let i = 0; i < 900; i++) { update(a, noInput(), 1 / 60); update(b, noInput(), 1 / 60); }
  assert.ok(a.mechs.some((m, i) => state(a)[i].split('|')[5] !== start[i].split('|')[5]), 'they fought: someone is hurt');
  assert.deepEqual(state(a), state(b));
  assert.equal(a.time, b.time);
});

test('mechsNear and mechsAlong find every mech a brute force finds, in G.mechs order, at the edges too', () => {
  const G = fight(30), r = makeRng(7);
  for (const m of G.mechs) shiftMech(m, r.range(-HALF - 40, HALF + 40) - m.x, r.range(-HALF - 40, HALF + 40) - m.z);
  buildNear(G);
  // they move up to the pad after the build, as they do during a frame
  for (const m of G.mechs) { const a = r.range(0, 6.3), d = r.range(0, NEAR_PAD); m.x += Math.sin(a) * d; m.z += Math.cos(a) * d; }
  const out = [];
  for (let q = 0; q < 300; q++) {
    const x = r.range(-HALF, HALF), z = r.range(-HALF, HALF), R = r.range(5, 300);
    const k = mechsNear(G, x, z, R, out), got = out.slice(0, k);
    const want = G.mechs.filter(m => Math.hypot(m.x - x, m.z - z) <= R);
    for (const m of want) assert.ok(got.includes(m), 'found');
    assert.deepEqual(got.map(m => G.mechs.indexOf(m)), [...got.map(m => G.mechs.indexOf(m))].sort((a, b) => a - b), 'in order');
    const x1 = x + r.range(-400, 400), z1 = z + r.range(-400, 400), pad = r.range(1, 10);
    const n = mechsAlong(G, x, z, x1, z1, pad, out), along = out.slice(0, n);
    const dx = x1 - x, dz = z1 - z, l2 = dx * dx + dz * dz;
    for (const m of G.mechs) {
      const t = Math.max(0, Math.min(1, ((m.x - x) * dx + (m.z - z) * dz) / l2));
      if (Math.hypot(m.x - x - dx * t, m.z - z - dz * t) <= pad) assert.ok(along.includes(m), 'found along');
    }
  }
  dropNear(G);
  assert.equal(mechsNear(G, 0, 0, 1, out), G.mechs.length, 'out of a frame: every mech');
});

test('a mech added during the frame is always found', () => {
  const G = fight(5), out = [];
  buildNear(G);
  const late = { ...G.mechs[1], x: 900, z: 900 };
  G.mechs.push(late);
  const k = mechsNear(G, -900, -900, 1, out);
  assert.ok(out.slice(0, k).includes(late));
  dropNear(G);
});

test('the grid looks at far fewer mechs than every mech', () => {
  const G = fight(50), out = [];
  for (let i = 0; i < 60; i++) update(G, noInput(), 1 / 60);
  buildNear(G);
  const P = G.player, k = mechsNear(G, P.x + 150, P.z + 150, 10, out);
  dropNear(G);
  assert.ok(k < 10, `${k} of ${G.mechs.length}`);
});
