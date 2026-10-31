// Digging up (docs/specs/30-dig-up.md): a scoop aimed up slopes its floor up
// ahead, so a digger in a pit digs itself a ramp out; aimed level it's a flat
// tunnel and aimed down a pit, as before. A parked digger stuck in a pit does
// the same on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { rangeDef } from '../src/data/range.js';
import { shiftMech } from '../src/sim/walkView.js';
import { TOOL } from '../src/data/tools.js';

const DT = 1 / 60;
const DIG = { held: { ...noInput().held, energy: true } };
const frames = (G, n, inp = {}, each = () => {}) => { for (let i = 0; i < n; i++) { each(); update(G, { ...noInput(), ...inp }, DT); } };
const flat = () => {
  const G = createGame({ fx: recordFx(), seed: 4 });
  startMatch(G, rangeDef({ ground: 'flat' }), 4, false, 'digger', { terrainOpts: { flat: true } });
  return G;
};
// A pit some 16 m deep round you.
function pit(G) {
  const h = G.ter.height(0, 0);
  for (let y = h; y > h - 8; y -= 2) for (let a = 0; a < 8; a++) for (const rr of [0, 6]) G.ter.carve([Math.sin(a * Math.PI / 4) * rr, y - 4, Math.cos(a * Math.PI / 4) * rr], 7);
  frames(G, 180);   // down to its floor
  return h;
}

test('aimed up, a run\'s floor slopes up ahead, no steeper than a ramp the digger walks; level, it\'s flat', () => {
  const G = flat(), D = G.player;
  pit(G);
  D.pitch = 0;
  frames(G, 30, DIG);
  assert.ok(D.digRun && D.digRun.sl == null && D.digRun.fl > -Infinity, 'level: a flat floor');
  D.digRun = null;
  frames(G, 30, DIG, () => { D.pitch = 0.45; });
  const sl = D.digRun?.sl;
  assert.ok(sl, 'aimed up: a slope');
  const s = Math.hypot(sl[0], sl[1]);
  assert.ok(s > 0.2 && s <= TOOL.dig.ramp + 1e-9, `slope ${s.toFixed(2)}`);
});

test('in a pit, aiming up, digging and walking on climbs a digger out', () => {
  const G = flat(), D = G.player, h = pit(G);
  assert.ok(D.y < h - 10, `down in it: ${D.y.toFixed(1)}`);
  let out = false;
  for (let s = 0; s < 30 && !out; s++) {
    frames(G, 60, { ...DIG, ...(s % 2 ? { thrUp: true } : {}) }, () => { D.pitch = 0.45; });
    out = D.y > h - 0.5;
  }
  assert.ok(out, `out: ${D.y.toFixed(1)} for the ground's ${h.toFixed(1)}`);
});

test('a parked digger stuck in a pit digs a ramp and hauls its ore out to the silo', () => {
  // Seed 6: your opening dig, aimed at the floor before you park, leaves a pit across the tunnel (spec 29 § As built).
  const G = createGame({ fx: recordFx(), seed: 6 });
  startMatch(G, rangeDef({ ground: 'mesa', crew: 'kestrel', base: 'silo' }), 6, false, 'digger', {});
  const D = G.player;
  let z = 0;
  while (G.ter.height(0, z) < G.ter.height(0, 0) + 4) z++;
  shiftMech(D, -D.x, z - 9 - D.z);
  D.pitch = 0;
  frames(G, 240, DIG);
  frames(G, 1, { swap: true });
  const silo0 = G.base.ore;
  for (let i = 0; i < 200 / DT && G.base.ore === silo0; i++) update(G, noInput(), DT);
  assert.ok(G.base.ore > silo0, `the silo got ore by ${G.time.toFixed(0)} s`);
});
