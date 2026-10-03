import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, foes } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { viewYaw } from '../src/sim/geom.js';
import { damage } from '../src/sim/combat.js';
import { wrapA } from '../src/util/math.js';
import { canSee } from '../src/sim/ai/perception.js';
import { PERCEPTION, DIFF, DIFF_ORDER } from '../src/data/ai.js';

// A wall `h` high over x in (lo, hi), running the length of the map, on
// otherwise flat ground. Nobody in these tests walks through it.
function wall(G, lo, hi, h = 60) { const base = G.ter.height; G.ter = { ...G.ter, height: (x, z) => (x > lo && x < hi ? h : base(x, z)) }; }
const place = (G, m, x, z, yaw) => { Object.assign(m, { x, z, yaw }); initFeet(G, m); };
const { atan2, hypot, abs } = Math;

test('sight range follows difficulty', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const e = foes(G)[0];
  place(G, e, 0, 700, Math.PI);
  assert.equal(canSee(G, e, G.player), false);
  G.diff = 'hard'; assert.equal(canSee(G, e, G.player), true);
  place(G, e, 0, 500, Math.PI);
  G.diff = 'easy'; assert.equal(canSee(G, e, G.player), false);
  G.diff = 'normal'; assert.equal(canSee(G, e, G.player), true);
});

test('a JACKAL on NORMAL cannot track the player through a hill: its belief stays at the last fix', () => {
  const G = createTestGame({ foes: ['jackal'] });
  const P = G.player, e = foes(G)[0];
  e.ai.aware = false; place(G, e, 0, 350, Math.PI);
  stepFor(G, 1.5);   // sight, then NORMAL's 0.8 s to react
  assert.equal(e.ai.state, 'engage', 'should have spotted the player in the open');
  wall(G, 40, 80);
  place(G, P, 120, 0, 0);   // behind the wall, as seen from the enemy
  stepFor(G, 0.5);
  assert.equal(e.ai.seen, false);
  const b0 = { ...e.ai.belief };
  assert.ok(hypot(b0.x, b0.z) < 5, `last fix should be near the origin, not ${b0.x},${b0.z}`);
  stepFor(G, 6);
  assert.deepEqual([e.ai.belief.x, e.ai.belief.z], [b0.x, b0.z]);
  assert.equal(G.stats.taken, 0, 'shot at through the hill');
  const toBelief = atan2(b0.x - e.x, b0.z - e.z), toPlayer = atan2(P.x - e.x, P.z - e.z);
  assert.ok(abs(wrapA(viewYaw(e) - toBelief)) < 0.3, 'torso should point at the last fix');
  assert.ok(abs(wrapA(toPlayer - toBelief)) > 0.3, 'the test needs the player well off the fix');
});

test('after 8 s without line of sight it searches where it last saw you, then gives up', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  e.ai.aware = false; place(G, e, 0, 300, Math.PI);
  stepFor(G, 1.5);
  assert.equal(e.ai.state, 'engage');
  wall(G, 40, 80);
  place(G, P, 120, 0, 0);
  stepFor(G, PERCEPTION.lostAfter - 1);
  assert.equal(e.ai.state, 'engage', 'still remembering');
  stepFor(G, 2.5);
  assert.equal(e.ai.state, 'search');
  const d0 = hypot(e.x - e.ai.belief.x, e.z - e.ai.belief.z);
  stepFor(G, 6);
  const d1 = hypot(e.x - e.ai.belief.x, e.z - e.ai.belief.z);
  assert.ok(d1 < d0 - 15, `not heading for the last known position (${d0.toFixed(0)} -> ${d1.toFixed(0)})`);
  stepFor(G, PERCEPTION.searchFor + 2);
  assert.equal(e.ai.state, 'patrol');
  assert.equal(e.ai.aware, false);
});

test('a contact reaches allies within 200 m that cannot see it themselves, with the place', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal'] });
  const [a, b] = foes(G);
  a.ai.aware = false; b.ai.aware = false;
  wall(G, 100, 140);
  place(G, a, 0, 200, Math.PI);      // sees the player
  place(G, b, 180, 200, 0);          // the wall is between it and the player; 180 m from a
  assert.equal(canSee(G, b, G.player), false);
  stepFor(G, 0.5);
  assert.equal(a.ai.aware, false, 'NORMAL takes 0.8 s to react');
  assert.equal(b.ai.aware, false);
  stepFor(G, 2);
  assert.equal(a.ai.aware, true);
  assert.equal(b.ai.aware, true, 'the group pass or the shout should have told it');
  assert.ok(hypot(b.ai.belief.x, b.ai.belief.z) < 5, 'it was told where');
});

test('being hit is a contact even out of sight, and the shooter is where it looks', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  e.ai.aware = false; place(G, e, 0, 750, Math.PI);   // beyond NORMAL sight
  stepFor(G, 1);
  assert.equal(e.ai.aware, false);
  damage(G, e, [e.x, e.y + 6, e.z - 2], 3, P);
  assert.equal(e.ai.aware, true);
  assert.ok(hypot(e.ai.belief.x - P.x, e.ai.belief.z - P.z) < 1);
  stepFor(G, 0.5);
  assert.equal(e.ai.state, 'engage');
});

test('first sight takes a beat to react to, shorter on harder settings, and resets if you duck away', () => {
  for (const k of DIFF_ORDER) for (const key of ['sight', 'heatCap', 'aimErr', 'react', 'label']) assert.ok(DIFF[k][key] != null, `${k}.${key}`);
  const seen = diff => {
    const G = createTestGame({ foes: ['jackal'] });
    G.diff = diff;
    const e = foes(G)[0];
    e.ai.aware = false; place(G, e, 0, 200, Math.PI);
    let at = null;
    for (let t = 0; t < 3 && at == null; t += 1 / 60) { stepFor(G, 1 / 60); if (e.ai.aware) at = G.time; }
    return at;
  };
  const easy = seen('easy'), hard = seen('hard');
  assert.ok(hard < DIFF.hard.react + 0.4, `HARD reacted at ${hard}`);
  assert.ok(easy >= DIFF.easy.react, `EASY reacted at ${easy}, before its ${DIFF.easy.react} s`);
  assert.ok(easy > hard);
  // Duck behind a wall halfway through the beat: the clock starts over.
  const G = createTestGame({ foes: ['jackal'] });
  G.diff = 'easy';
  const e = foes(G)[0];
  e.ai.aware = false; place(G, e, 0, 200, Math.PI);
  stepFor(G, 0.8);
  assert.equal(e.ai.aware, false);
  assert.ok(e.ai.reactAt != null, 'it should be counting');
  wall(G, 40, 80); place(G, G.player, 120, 0, 0);
  stepFor(G, 0.5);
  assert.equal(e.ai.reactAt, null, 'out of sight: the count should reset');
  assert.equal(e.ai.aware, false);
});
