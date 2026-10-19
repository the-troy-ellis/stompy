import { startBench, BENCH_SEGS } from '../sim/bench.js';
import { update, noInput } from '../sim/update.js';
import { store } from '../util/store.js';

// ?debug=1's bench (sim/bench.js) in the page: BENCH on the FEEL panel, or
// &bench=1 in the URL, plays the scripted scene. The sim steps at a fixed
// 1/60 s whatever the display does, so every run shows the same frames at
// the same moments; each segment's frame times and draws are kept, and at the
// end a card shows them beside the last run's (saved), to judge a change by.
const LAST_KEY = 'debug.bench.last', STEP = 1 / 60;

export function createBench(app) {
  const G = app.G, R = app.R;
  let acc = 0, prevTs = 0, rows = null;

  function start() {
    const fp = document.querySelector('.feel-panel .feel-body');   // the FEEL table folds away: the scene wants the whole view
    if (fp && !fp.hidden) document.querySelector('.feel-panel [data-a="toggle"]')?.click();
    startBench(G);
    app.scene.uploadWorld(); app.ui.launch();
    acc = 0; prevTs = 0;
    rows = Object.fromEntries(BENCH_SEGS.map(s => [s.key, { gap: [], work: [], draws: [], parts: 0 }]));
  }

  // One display frame: as many fixed steps as the time asks (at most 4), then the caller renders.
  function tick(dt) {
    acc = Math.min(acc + dt, STEP * 4);
    while (acc >= STEP - 1e-6) { acc -= STEP; G.clock += STEP * 1000; update(G, noInput(), STEP); }
  }

  // After the frame is drawn: `ts` is the display's clock, `work` this frame's ms of our own work.
  function record(ts, work) {
    if (!rows || G.paused) { prevTs = 0; return; }
    const r = rows[G.bench.seg];
    if (prevTs) r.gap.push(ts - prevTs);
    prevTs = ts;
    r.work.push(work); r.draws.push(R.draws); r.parts = Math.max(r.parts, G.parts.length);
    if (G.bench.done) finish();
  }

  function finish() {
    const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0), p95 = a => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] || 0;
    const res = Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, {
      fps: Math.round(1000 / (mean(r.gap) || 1)), work: +mean(r.work).toFixed(2), work95: +p95(r.work).toFixed(2),
      draws: Math.round(mean(r.draws)), peakDraws: Math.max(0, ...r.draws), parts: r.parts }]));
    rows = null;
    const last = store.get(LAST_KEY, null);
    store.set(LAST_KEY, res);
    if (window.__stompy) window.__stompy.bench = res;
    console.table(res);
    G.state = 'debrief';   // as a match's end, with the bench's own card for its debrief
    app.input.exitLock();
    const was = (k, c) => (last?.[k]?.[c] != null ? ` <i>${last[k][c]}</i>` : '');
    const cols = [['fps', 'FPS'], ['work', 'MS'], ['work95', 'MS 95%'], ['draws', 'DRAWS'], ['peakDraws', 'PEAK'], ['parts', 'BITS']];
    app.ui.showOverlay(`
      <h1>BENCH</h1>
      <div class="panel bench-card">
        <table class="mech-keys"><tr class="dim"><td></td>${cols.map(([, h]) => `<td>${h}</td>`).join('')}</tr>
        ${Object.entries(res).map(([k, r]) => `<tr><td>${k.toUpperCase()}</td>${cols.map(([c]) => `<td>${r[c]}${was(k, c)}</td>`).join('')}</tr>`).join('')}</table>
        <p class="dim">MS is our own work in a frame. Grey is the last run.</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        <button class="go" data-a="bench">AGAIN</button>
        <button class="go" data-a="menu">MAIN MENU</button>
      </div>`);
  }

  return { start, tick, record };
}
