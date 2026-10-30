// How digging feels (docs/specs/28-dig-feel.md): each scoop by what the bucket
// met, soil a swish, rock a clunk, rock breaking loose (the scoop that takes
// ore) a crack; and a run of scoops builds to it, each a little harder and
// lower. Feel only: what a scoop takes, and how fast, are as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { shiftMech } from '../src/sim/walkView.js';
import { spinPose } from '../src/sim/tools.js';
import { FEEL } from '../src/data/feel.js';

const DT = 1 / 60;
const DIG = { held: { ...noInput().held, energy: true } };
const game = (ground = 'mesa') => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground }), 4, false, 'digger', ground === 'flat' ? { terrainOpts: { flat: true } } : {});
  return G;
};
function atMesa(G) {
  const D = G.player;
  let z = 0;
  while (G.ter.height(0, z) < G.ter.height(0, 0) + 4) z++;
  shiftMech(D, -D.x, z - 9 - D.z);
  Object.assign(D, { pitch: 0, yaw: 0, twist: 0 });
  return D;
}
// Dig for n frames; each scoop's [tier, into, ore it took], and a hook per frame.
function dig(G, n, each = () => {}) {
  const out = [], calls = () => G.fx.calls('sfx.scoop');
  for (let i = 0; i < n; i++) {
    const c0 = calls().length, ore0 = G.player.ore || 0;
    update(G, { ...noInput(), ...DIG }, DT);
    const c = calls();
    if (c.length > c0) out.push([c[c.length - 1].args[2], c[c.length - 1].args[3], (G.player.ore || 0) - ore0]);
    each(i, c.length > c0 ? c[c.length - 1].args[2] : null);
  }
  return out;
}

test('at the mesa\'s foot: rock clunks, and every scoop that takes ore cracks', () => {
  const G = game(), D = atMesa(G);
  const s = dig(G, 600);
  assert.ok(D.ore > 0, 'it dug ore');
  assert.ok(s.some(([t]) => t === 1) && s.some(([t]) => t === 2), `tiers: ${s.map(x => x[0]).join('')}`);
  for (const [t, , ore] of s) if (ore > 0) assert.equal(t, 2, 'ore came with a crack');
});

test('soil in front, on the flat: a soft swish', () => {
  const G = game('flat'), D = G.player;
  D.pitch = -0.3;   // the floor in front
  const s = dig(G, 120);
  assert.ok(s.length >= 3);
  assert.ok(s.every(([t]) => t === 0), `tiers: ${s.map(x => x[0]).join('')}`);
});

test('a run builds: each scoop further in, up to the last of the run', () => {
  const G = game(); atMesa(G);
  const into = dig(G, 600).map(x => x[1]);
  assert.ok(into.includes(0) && into.includes(1), `into: ${into.join(' ')}`);
  for (let i = 1; i < into.length; i++) assert.ok(into[i] > into[i - 1] || into[i] === 0, `rising, or a new run: ${into[i - 1]} -> ${into[i]}`);
});

test('a crack hitches the arm and holds the crosshair a beat; let go, the arm catches up, the spin unchanged', () => {
  const G = game(), D = atMesa(G);
  let seen = null;
  dig(G, 600, (i, tier) => {
    if (tier !== 2 || seen) return;
    const p = spinPose(D), lag = Math.max(D.spin.L - p.LA, D.spin.R - p.RA);
    seen = { lag, stop: G.hitStop };
  });
  assert.ok(seen, 'a crack');
  assert.ok(seen.lag > FEEL.dig.hitchCrack * 0.8, `the arm lagged ${seen.lag.toFixed(2)}`);
  assert.ok(seen.stop > 0, 'the crosshair held');
  for (let i = 0; i < 60; i++) update(G, noInput(), DT);
  assert.ok((D.spin.hL || 0) < 0.01 && (D.spin.hR || 0) < 0.01, 'caught up');
});
