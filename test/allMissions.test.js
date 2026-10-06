import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMission, playPerfectly } from './harness.js';
import { MISSIONS, missionDef } from '../src/data/missions.js';
import { destroy } from '../src/sim/combat.js';
import { destroyEntity } from '../src/sim/entities.js';
import { stepFor, freeze, input } from './helpers.js';

const ALL = MISSIONS.map((m, n) => n), CONTRACTS = [12, 13, 14, 15, 16];
const label = n => n < MISSIONS.length ? MISSIONS[n].key : missionDef(n).name;

// Acceptance 1: every mission loads, is winnable by the scripted perfect
// player, and fails when its fail rule triggers.
for (const n of [...ALL, ...CONTRACTS]) {
  for (const diff of ['easy', 'normal', 'hard']) {
    test(`${label(n)} (${diff}): the perfect player wins it`, () => {
      const G = playPerfectly(startMission(n, { diff }));
      assert.equal(G.state, 'over', `${label(n)} still running at ${G.time.toFixed(0)} s: ${G.objectives.map(o => `${o.def.type}:${o.state}`).join(', ')}`);
      assert.equal(G.won, true);
      for (const o of G.objectives.filter(x => !x.def.secondary)) assert.equal(o.state, 'done', `${label(n)}: ${o.def.type}`);
    });
  }

  test(`${label(n)}: losing the mech loses it`, () => {
    const G = startMission(n);
    stepFor(G, 0.5);
    const foe = G.mechs.find(m => m.team !== 0) || null;
    destroy(G, G.player, foe);
    stepFor(G, 0.2);
    assert.equal(G.state, 'over'); assert.equal(G.won, false);
  });

  // Its own fail rule, where it has one beyond dying.
  const main = (missionDef(n).objectives || []).filter(o => !o.secondary);
  for (const o of main) {
    if (o.type === 'extract' && o.within != null) test(`${label(n)}: too slow to the pad loses it`, () => {
      const G = startMission(n), P = G.player;
      // Do everything that comes first, then stand still.
      for (const x of G.objectives) if (x.def.type === 'destroy') for (const e of x.targets) destroyEntity(G, e, P);
      stepFor(G, o.within + 2, () => { for (const k in P.hp) P.hp[k] = 1e6; for (const m of G.mechs) if (m.team && m.alive) freeze(m); return input(); }, 1 / 20);
      assert.equal(G.state, 'over'); assert.equal(G.won, false);
    });
    if (o.type === 'escort') test(`${label(n)}: losing the convoy loses it`, () => {
      const G = startMission(n), trucks = G.entities.filter(e => e.kind === 'vehicle');
      for (const t of trucks.slice(0, trucks.length - (o.minAlive ?? 1) + 1)) destroyEntity(G, t, null);
      stepFor(G, 0.3);
      assert.equal(G.state, 'over'); assert.equal(G.won, false);
    });
  }
}

test('the twelve take a sensible time for the perfect player (the clock is the floor, not the fun)', () => {
  const times = ALL.map(n => playPerfectly(startMission(n)).time);
  assert.ok(times.every(t => t < 400), times.map(t => t.toFixed(0)).join(' '));
});
