// The crowd scene (docs/specs/34-big-fights.md part 1): the sim alone, in
// Node, with 12, 25, 50 and 100 foes in one fight, each really thinking and
// shooting (unlike the bench, where nobody thinks). It measures how the sim's
// cost grows with the number of mechs.
//
// For each size it runs a fixed Free Play match (seed 1234, dusk) with you
// invincible and standing still, warms up for 2 s, then records 5 s:
//   ms     median ms per update(), this machine's, for comparing before and
//          after (not budgeted: times are noisy on CI)
//   rays   ground rays per frame (G.ter.ray)
//   pairs  mech reads per frame: every time the sim reads one of G.mechs,
//          which is how many mechs each loop over every mech looks at
// Rays and pairs come from a second, identical run with counters wrapped
// round G.ter.ray and G.mechs, so the timed run carries no counting. Fixed
// seed, fixed steps: the counts are the same every run, so they're budgeted.
//
// `npm run perf` runs it after the browser scenes; `node scripts/crowd.mjs`
// runs it alone.
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { update, noInput } from '../src/sim/update.js';
import { shiftMech } from '../src/sim/walkView.js';

export const SIZES = [12, 25, 50, 100];
// At 50 foes, today's counts plus ~15% (spec 34 lowers them part by part).
export const CROWD_BUDGETS = { rays: 70, pairs: 2750 };   // main at spec 34: 60 and 11,356 mech reads; the grid (part 2): 2,391

const DT = 1 / 60, WARM = 120, FRAMES = 300;
const FOES = ['jackal', 'jackal', 'kestrel', 'jackal', 'warden'];

function match(n) {
  const G = createGame({ fx: recordFx(), seed: 1234 });
  startMatch(G, { name: 'Crowd', pal: 'dusk', foes: Array.from({ length: n }, (_, i) => FOES[i % FOES.length]), intel: '' }, 1234, false, 'kestrel');
  G.kind = 'free'; G.diff = 'normal'; G.mode = 'sp'; G.cheats = { god: true };   // you stay up, so the fight runs the whole 7 s
  // All in, at once, the worst case: every foe aware, on rings 80 to 200 m out.
  const P = G.player, foes = G.mechs.filter(m => m !== P && m.ai);
  foes.forEach((m, i) => {
    const a = i * 2.39996, d = 80 + (i * 37) % 120;   // the golden angle: spread round, no two together
    shiftMech(m, P.x + Math.sin(a) * d - m.x, P.z + Math.cos(a) * d - m.z);
    m.ai.aware = true; m.ai.frozen = false;
  });
  return G;
}

function counted(G) {
  const C = { rays: 0, pairs: 0 }, ray = G.ter.ray;
  G.ter.ray = (...a) => { C.rays++; return ray(...a); };
  G.mechs = new Proxy(G.mechs, { get(t, k, r) { if (typeof k === 'string' && k >= '0' && k <= '9') C.pairs++; return Reflect.get(t, k, r); } });
  return C;
}

export function crowd(sizes = SIZES) {
  const out = {};
  for (const n of sizes) {
    let G = match(n);
    for (let i = 0; i < WARM; i++) update(G, noInput(), DT);
    const ts = [];
    for (let i = 0; i < FRAMES; i++) { const t = performance.now(); update(G, noInput(), DT); ts.push(performance.now() - t); }
    const alive = G.mechs.filter(m => m.alive && m !== G.player).length;
    G = match(n);
    for (let i = 0; i < WARM; i++) update(G, noInput(), DT);
    const C = counted(G);
    for (let i = 0; i < FRAMES; i++) update(G, noInput(), DT);
    out[n] = { ms: +[...ts].sort((a, b) => a - b)[FRAMES >> 1].toFixed(2), rays: Math.round(C.rays / FRAMES), pairs: Math.round(C.pairs / FRAMES), alive };
  }
  return out;
}

// A table, each size's time against the size before it, and whether the
// counts at 50 are over budget.
export function report(out, scale = 1) {
  let over = [], prev = null;
  console.log(['crowd'.padEnd(14), ...['ms', 'x prev', 'rays', 'pairs', 'alive'].map(c => c.padStart(10))].join(''));
  for (const [n, r] of Object.entries(out)) {
    const grow = prev ? (r.ms / prev.ms).toFixed(2) : '';
    const b = n === '50' ? CROWD_BUDGETS : {};
    const cell = k => `${r[k]}${b[k] && r[k] > b[k] * scale ? '!' : ''}`;
    for (const k of ['rays', 'pairs']) if (b[k] && r[k] > b[k] * scale) over.push(`${k} ${r[k]} > ${Math.round(b[k] * scale)}`);
    console.log([`${n} foes`.padEnd(14), String(r.ms).padStart(10), grow.padStart(10), cell('rays').padStart(10), cell('pairs').padStart(10), String(r.alive).padStart(10)].join('') + (n === '50' && over.length ? `   OVER: ${over.join(', ')}` : ''));
    prev = r;
  }
  return over;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const over = report(crowd(), Number(process.env.PERF_BUDGET_SCALE) || 1);
  process.exit(over.length ? 1 : 0);
}
