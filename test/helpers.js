// Build a game headlessly and step it with a fixed dt.
import { createGame, startMatch } from '../src/sim/state.js';
import { update, noInput } from '../src/sim/update.js';
import { recordFx } from '../src/sim/fx.js';

export const DT = 1 / 60;

// A match on flat ground (unless `terrain` says otherwise) with a recording fx.
export function createTestGame({ seed = 1, foes = ['jackal'], chassis = 'kestrel', flat = true, gentle = false, pal = 'dusk' } = {}) {
  const fx = recordFx();
  const G = createGame({ fx, seed });
  startMatch(G, { name: 'Test', pal, foes, intel: '' }, seed, gentle, chassis, { terrainOpts: { flat } });
  G.kind = 'free';
  return G;
}

export function input(over = {}) {
  const i = noInput();
  Object.assign(i, over);
  if (over.held) i.held = { ...noInput().held, ...over.held };
  return i;
}

// Advance `seconds` with the same input every frame (or a function of time).
export function stepFor(G, seconds, inp = noInput(), dt = DT) {
  const n = Math.round(seconds / dt);
  for (let k = 0; k < n; k++) {
    G.clock += dt * 1000;
    G.fx.setTime?.(G.time);
    update(G, typeof inp === 'function' ? inp(G.time) : inp, dt);
  }
  return G;
}

export const foes = G => G.mechs.filter(m => m.team !== 0);
// Park an enemy: shut down with so much heat it stays down for the test.
export function freeze(m) { m.ai.aware = false; m.shutdown = true; m.heat = 1000; m.throttle = 0; m.speed = 0; }
export const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
