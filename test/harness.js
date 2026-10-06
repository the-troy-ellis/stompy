// The "perfect player" (docs/specs/04-campaign.md § Acceptance 1): plays any
// mission by its objectives with direct calls instead of skill. It kills
// every hostile as soon as it appears, knocks down whatever a DESTROY wants,
// stands still and unhurt through a SURVIVE, walks the convoy home by
// clearing its attackers, and teleports onto an EXTRACT's pad once that
// objective is live. Returns the game when the mission ends (or time runs out).
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { destroy } from '../src/sim/combat.js';
import { destroyEntity } from '../src/sim/entities.js';
import { missionDef } from '../src/data/missions.js';

export function startMission(n, { diff = 'normal', seed = 1 } = {}) {
  const G = createGame({ fx: recordFx(), seed }), def = missionDef(n);
  G.diff = diff;
  startMatch(G, def, def.seed ?? 7 + n * 13, n === 0, 'kestrel');
  G.kind = 'campaign';
  return G;
}

const DT = 1 / 20;
export function playPerfectly(G, { maxSeconds = 600 } = {}) {
  const P = G.player, wanted = new Set();
  for (const o of G.objectives) if (o.def.type === 'destroy') for (const t of o.def.targets) wanted.add(t);
  for (let t = 0; t < maxSeconds && G.state === 'play'; t += DT) {
    for (const k in P.hp) P.hp[k] = Math.max(P.hp[k], 1e5);   // perfect: never hurt
    P.heat = 0;
    for (const m of G.mechs) if (m.team !== 0 && m.alive && !m.dying && !m.remote) destroy(G, m, P);
    for (const o of G.objectives) {
      if (o.state !== 'active') continue;
      if (o.def.type === 'destroy') for (const e of o.targets) if (e.alive && e.tags.some(x => wanted.has(x))) destroyEntity(G, e, P);
      if (o.def.type === 'extract') { P.x = o.nav.x; P.z = o.nav.z; }
    }
    G.clock += DT * 1000;
    update(G, noInput(), DT);
  }
  return G;
}
