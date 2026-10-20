import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { update, noInput } from '../src/sim/update.js';
import { recordFx } from '../src/sim/fx.js';
import { startBench, BENCH_END, BENCH_SEGS } from '../src/sim/bench.js';

// Run the whole bench headlessly; note where everyone is at each segment's end.
function run(seed = 1) {
  const G = createGame({ fx: recordFx(), seed });
  G.mode = 'sp';
  startBench(G);
  const at = {}, segs = new Set();
  for (let f = 0; f < BENCH_END * 60 + 5; f++) {
    G.clock += 1000 / 60;
    update(G, noInput(), 1 / 60);
    segs.add(G.bench.seg);
    at[G.bench.seg] = G.mechs.map(m => `${m.type} ${m.x.toFixed(2)} ${m.z.toFixed(2)} ${m.alive}`).join('|');
  }
  return { G, at, segs };
}

test('bench: plays every segment to the end, with the same field every run', () => {
  const a = run(), b = run(7);   // the game's own seed doesn't matter: the bench brings its own
  assert.deepEqual([...a.segs], BENCH_SEGS.map(s => s.key));
  assert.ok(a.G.bench.done);
  assert.deepEqual(a.at, b.at);
});

test('bench: nobody takes damage; limbs and kills come off the script', () => {
  const { G } = run();
  const P = G.player;
  for (const k in P.hp) assert.equal(P.hp[k], P.max[k], `your ${k} is untouched`);
  const foes = G.mechs.filter(m => m.team);
  assert.deepEqual(foes.filter(m => !m.alive).map(m => m.type), ['jackal', 'light1', 'sniper1']);
  assert.equal(G.wrecks.length, 3);
  const warden = foes.find(m => m.type === 'warden');
  assert.equal(warden.hp.LA, 0, 'the WARDEN lost its arm on time');
  assert.equal(warden.hp.T, warden.max.T, 'and nothing else');
  assert.ok(G.stats.shots > 10 && G.stats.taken > 50, 'and the guns did fire');
  assert.equal(G.state, 'play', 'nothing to win: the match never ends itself');
  assert.equal(G.bench.dug, 3, 'and the ground was dug three times');
  assert.ok(G.ter.dirty.size > 0, 'which leaves chunks to mesh again');
});

test('bench: the cast walks in the open and never into each other', () => {
  const G = createGame({ fx: recordFx(), seed: 1 });
  startBench(G);
  let closest = Infinity;
  for (let f = 0; f < 11 * 60; f++) {   // the walking part
    update(G, noInput(), 1 / 60);
    const ms = G.mechs;
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) closest = Math.min(closest, Math.hypot(ms[i].x - ms[j].x, ms[i].z - ms[j].z));
  }
  assert.ok(closest > 15, `everyone keeps their distance (${closest.toFixed(1)} m)`);
});

test('bench: a fresh match after it is an ordinary one', () => {
  const { G } = run();
  startBench(G);
  assert.ok(G.bench);
  const def = { name: 'After', pal: 'dusk', foes: ['jackal'], intel: '' };
  startMatch(G, def, 3, false, 'kestrel');
  assert.equal(G.bench, null);
  assert.ok(!G.mechs.some(m => m.script));
});
