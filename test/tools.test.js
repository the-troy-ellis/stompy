// Hold to dig (docs/specs/25-hold-to-dig.md): DIG held spins the digger's
// arms like a paddle wheel, half a turn apart, and each bucket scoops as it
// comes round; let go and they finish their turn and stop. A run of scoops
// into one face widens one hole, so it always takes ground. At a face it
// brings ore in at the old punch's pace, and at your own site it builds at
// the punch's pace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { shiftMech } from '../src/sim/walkView.js';
import { placeBuilding } from '../src/sim/base.js';
import { TOOL } from '../src/data/tools.js';
import { listParticles, CLOD_SINK } from '../src/sim/particles.js';
import { spawnClods, CLOD_MAX } from '../src/sim/effects.js';

const DT = 1 / 60, TAU = 2 * Math.PI;
const DIG = { held: { ...noInput().held, energy: true } };
const game = (ground = 'mesa', seed = 4) => {
  const G = createGame({ fx: recordFx(), seed });
  startMatch(G, rangeDef({ ground, crew: 'kestrel', base: 'silo' }), seed, false, 'digger', ground === 'flat' ? { terrainOpts: { flat: true } } : {});
  return G;
};
const frames = (G, n, inp = {}) => { for (let i = 0; i < n; i++) update(G, { ...noInput(), ...inp }, DT); };
// Off the foot of the range's mesa, facing it.
function atMesa(G, off = 8) {
  const D = G.player;
  let z = 0;
  while (G.ter.height(0, z) < G.ter.height(0, 0) + 4) z++;
  shiftMech(D, -D.x, z - off - D.z);
  Object.assign(D, { pitch: 0, yaw: 0, twist: 0 });
  return D;
}

test('held, the arms spin up and a bucket comes round every 0.4 s, half a turn apart', () => {
  const G = game(), D = atMesa(G);
  frames(G, 60, DIG);   // up to speed
  const n0 = D.scoops || 0;
  frames(G, 240, DIG);   // 4 s
  assert.equal((D.scoops || 0) - n0, 4 / (TOOL.dig.turn / 2));
  const half = (((D.spin.L - D.spin.R) % TAU) + TAU) % TAU;
  assert.ok(Math.abs(half - Math.PI) < 1e-6, `half a turn apart: ${half}`);
});

test('let go, each arm finishes its turn and stops, bucket down; a tap is one scoop', () => {
  const G = game(), D = atMesa(G);
  frames(G, 50, DIG);
  frames(G, 60);
  assert.deepEqual([D.spin.L, D.spin.R], [0, 0], 'both at rest');
  frames(G, 10);
  assert.equal(D.spin.w, 0);
  const n0 = D.scoops;
  frames(G, 2, DIG);   // a tap
  frames(G, 60);
  assert.equal(D.scoops - n0, 1);
  assert.deepEqual([D.spin.L, D.spin.R], [0, 0]);
});

test('with an arm shot off, the other still digs, half as often', () => {
  const G = game(), D = atMesa(G);
  D.hp.LA = 0;
  frames(G, 60, DIG);
  const n0 = D.scoops || 0;
  frames(G, 240, DIG);
  assert.equal((D.scoops || 0) - n0, 4 / TOOL.dig.turn);
});

test('a run of scoops into the foot of a slope takes ground, and ore', () => {
  const G = game('mesa', 4), D = atMesa(G, 9);
  frames(G, 240, DIG);
  assert.ok(D.ore + (D.oreCarry || 0) > 0 && D.site, `dug: ${D.ore} ore and ${D.oreCarry} on its way`);   // whole ore, or the fraction toward the next (sim/dig.js bite)
});

test('nothing in reach: the arms spin in the air, and it says so', () => {
  const G = game('flat'), D = G.player;
  Object.assign(D, { pitch: 0.4 });   // up at the sky
  frames(G, 120, DIG);
  assert.ok(D.scoops >= 3 && !D.ore && D.dryScoops === D.scoops);
  assert.ok(G.msgs.some(m => m.text === 'NOTHING TO DIG'));
});

test('at your own site, DIG builds it: three scoops a swing of work, the punch\'s pace', () => {
  const G = game('flat'), P = G.player;
  Object.assign(P, { yaw: 0, twist: 0, pitch: 0 });
  placeBuilding(G, P, 'factory');
  const s = G.base.sites[0], e = s.parts[0];
  shiftMech(P, 0, e.z - e.radius - 6 - P.z);
  s.ore = s.need;
  const ore = G.base.ore, h = G.ter.hash();
  frames(G, 60, DIG);
  const w0 = s.work, n0 = P.scoops;
  frames(G, 360, DIG);   // 6 s: 15 scoops
  assert.equal(P.scoops - n0, 15);
  assert.equal(s.work - w0, 5, 'a swing of work every 1.2 s, as the punch built');
  assert.equal(G.ter.hash(), h, 'it built, it didn\'t dig');
  assert.equal(G.base.ore, ore);
});

// The old punch's pace (main at bc24e12): over these 80 seeds, 30 s of a bite
// every 1.2 s at the range's mesa face, walked up to keep it 8 m ahead and the
// hopper emptied as it came in, took 10380 ore. Held DIG must stay within 10%.
// The 8 m is to the 8 m ground's face, the one the bucket aims at and the ore
// is counted on (docs/specs/27-fine-dig.md): a fine patch's bites sit behind it.
test('held DIG at a face brings ore in at the old punch\'s pace (80 seeds)', () => {
  let ore = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const G = game('mesa', seed), D = atMesa(G);
    D.ch = { ...D.ch, hopper: 1e9 };
    for (let i = 0; i < 30 / DT; i++) {
      if (i % 30 === 0) { const t = G.ter.coarse.ray([D.x, D.y + 4 * D.ch.scale, D.z], [0, 0, 1], 60); if (t != null && Math.abs(t - 8) > 1) shiftMech(D, 0, t - 8); }
      update(G, { ...noInput(), ...DIG }, DT);
      ore += D.ore || 0; D.ore = 0; D.dirt = 0; D.heat = 0;
    }
  }
  assert.ok(Math.abs(ore / 10380 - 1) < 0.1, `${ore} ore against the punch's 10380`);
});

// Clods (docs/specs/25-hold-to-dig.md § Clods): particles of kind 'clod'.
const clods = G => listParticles(G).filter(p => p.kind === 'clod');
test('each scoop throws clods out of the face, in the ground\'s colours; they land, lie, then sink away', () => {
  const G = game(), D = atMesa(G);
  frames(G, 60, DIG);
  const c = clods(G), cols = [G.pal.low, G.pal.rock, G.pal.ore];
  assert.ok(c.length >= TOOL.dig.clods[0], `clods: ${c.length}`);
  assert.ok(c.every(p => cols.some(k => p.col.every((v, i) => Math.abs(v / k[i] - 1) < 0.16))), 'soil, rock or seam colours');
  assert.ok(c.every(p => Math.hypot(p.p[0] - D.x, p.p[2] - D.z) < 30));
  frames(G, 90);   // let go: 1.5 s on
  const lying = clods(G);
  assert.ok(lying.length && lying.every(p => Math.hypot(...p.v) < 0.5), 'at rest on the ground (bar a frame of gravity)');
  assert.ok(lying.every(p => Math.abs(p.p[1] - G.ter.groundBelow(p.p[0], p.p[1] + 2, p.p[2])) < 2), 'on it, not floating');
  frames(G, 300);   // 5 s more: past the longest life
  assert.equal(clods(G).length, 0, 'sunk and gone');
});

test('never more than CLOD_MAX clods at once: past it, the oldest sink', () => {
  const G = game(), D = atMesa(G);
  for (let i = 0; i < 30; i++) spawnClods(G, [D.x, D.y + 2, D.z + 8], 5, G.pal.low, [D.x, D.y, D.z]);
  assert.ok(clods(G).filter(p => p.life > CLOD_SINK).length <= CLOD_MAX);
  frames(G, 75);   // the extra ones sink inside a second
  assert.ok(clods(G).length <= CLOD_MAX, `${clods(G).length}`);
  // A held DIG stays under the cap on its own.
  const H = game(), E = atMesa(H);
  let most = 0;
  for (let i = 0; i < 600; i++) { frames(H, 1, DIG); most = Math.max(most, clods(H).length); }
  assert.ok(most <= CLOD_MAX && most > 20, `most at once: ${most}`);
  void E;
});
