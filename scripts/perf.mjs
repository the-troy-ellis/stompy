// npm run perf: the frame-cost harness (docs/specs/14-look-and-performance.md
// § The plan, P0). It serves the repo, loads the game in headless Chromium,
// stops the game's own frame loop and steps fixed scenes by hand at 60 Hz on a
// fixed seed, so every run sees the same frames. Per scene it records draw
// calls (mean and peak), triangles, particles, and bytes allocated per frame
// (sampled by the browser's heap profiler). Software GL makes the counts exact
// and the times meaningless, so only counts are budgeted. It prints a table,
// writes test-results/perf.json, and exits 1 when a scene is over budget.
//
// The budgets start at what main costs today plus a margin, so a regression
// fails; each optimisation that lands (instanced effects, the particle pool,
// one draw per mech) lowers them toward the spec's targets.
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Baseline when P0 landed (meanDraws/peakDraws/tris/allocKB):
//   menu 13/13/21.6k/38 · free-start 37/37/21.8k/160 · fight 231/325/26.1k/682
//   fight-deaths 470/529/28.5k/1315 · wrecks 464/515/28.2k/1286
// After P1 (#132, instanced effects): fight 94/112/23.6k/394 ·
//   fight-deaths 106/112/23.6k/545 · wrecks 91/97/23.2k/499
// After P2 (#133, particle pool; the cap rises from 420 to 4,000, so the deaths
//   scene keeps ~540 particles, peak ~710): fight 94/112/23.6k/353 ·
//   fight-deaths 106/112/23.6k/465 · wrecks 91/97/23.2k/392
// After P3 (#134, allocation diet: matrix arena, hot loops out of render(),
//   allocation-free limb and terrain rays): menu 13/13/21.6k/21 ·
//   free-start 37/37/21.8k/98 · fight 94/112/23.6k/174 ·
//   fight-deaths 106/112/23.6k/175 · wrecks 91/97/23.2k/124
// After P4 (#137, one draw per mech; draws now counted by the renderer, so
//   the instanced effect draws count too): menu 2/2 · free-start 4/4 ·
//   fight 24/42 · fight-deaths 44/51 · wrecks 51/58 (tris and alloc as P3)
// After P6 (#138, frustum culling): free-start 2/2 · fight 20/37 ·
//   fight-deaths 28/35 · wrecks 26/33 · looking-away 10/13 (49/53 without)
// After #162 (scenery props, one instanced draw per prop mesh in view, ~1-3k
//   more triangles; garbage unchanged): free-start 5/5 · fight 22/39 ·
//   fight-deaths 34/38 · wrecks 32/39 · looking-away 16/19 · rain 4 ·
//   snow 6 (dead trees and spires) · dust 4. Props add at most one draw per
//   scenery mesh the biome has (dusk 6; ice and volcanic 8, the vent's glow
//   included), so where they matter the budgets are the pre-prop number plus
//   that, not the latest view of a reshuffled field.
// After #163 (explosions: the scorches are one more draw, each burning wreck
//   one more for 30 s; garbage unchanged): fight 27/44 · fight-deaths 36/42 ·
//   wrecks 37/44 · looking-away 18/21
// After #261 (gaits by class: fewer footfalls, so less dust drawn from G.rng,
//   so a differently-fought field): fight-deaths 40/63, the peak the frame the
//   three die, with 27 shed limbs and 17 shots in the air (main had 14 and 8).
//   No new draws: the same main, with only the dust's rolls moved off G.rng,
//   peaks at 60 and averages 48. This scene's peak swings ~20 draws with the
//   fight, so its budget covers that swing, not one seed's luck.
//   The HUD's wireframe loop is its own function now (hud.js wireEdges): it
//   was stuck half compiled and boxed 36 KB a frame; looking-away 104 KB.
// After #263 (the roster: a 1.4-scale WARDEN, JACKAL and KESTREL on new legs,
//   so again a differently-fought field): fight-deaths 48/56 · wrecks 52/57.
//   Main with only the dust's rolls moved gave the same (48/60, wrecks 52/61):
//   these two scenes' draws follow how the scripted fight goes (shed limbs,
//   shots in the air, what burns), not the renderer, so their budgets cover
//   that spread. A scene that holds the field fixed would let them tighten.
// After #262 and #263 together (walkers weigh a climb when they pick cover,
//   on the new roster): fight 29/47 · fight-deaths 51/65 · wrecks 50/57 ·
//   looking-away 22/26, the field reshuffled once more; looking-away's budget
//   covers it. The harness keeps a fresh save's locks (&lock): ?debug=1 alone
//   opens every mech.
// After the weight pass (your view dips and lifts with your acceleration and
//   lurches with each step, so the frustum takes in a little more): fight
//   28/50, 51 on CI (runs jitter by a draw); its peak budget is that plus ~15%.
// The bench replaces the fight scenes (fight, fight-deaths, wrecks,
//   looking-away): src/sim/bench.js scripts the whole field (nobody thinks,
//   nobody is hurt, limbs and kills on its clock), so their draws stop
//   following how a fight goes. Its segments, first measured:
//   walk 13/13 · run 9/27 · fight 49/70 · deaths 69/75 · wrecks 69/88 ·
//   away 25/80 (its peak is the first frames, still facing the wrecks).
//   Two runs agree to the draw, bar a peak's one.
// After #231's terrain chunks (16 squares, each with its box; each run of
//   neighbours in view is one draw, and past the fog none): about half the
//   triangles for 0-2 more draws. menu 4/4 11.3k · free-start 7/7 11.6k ·
//   bench-walk 13/14 15.0k · run 11/29 15.4k · fight 49/70 16.1k ·
//   deaths 70/76 16.3k · wrecks 69/89 16.5k · away 27/82 15.3k · rain 8.7k ·
//   snow 3.7k · dust 3.2k (their fog is short).
// After #281 (the ground as voxels, spec 18: 8 m cells, 256 m groups, far
//   groups past 300 m in 16 m cells, a row of far groups one buffer drawn in
//   runs): the ground is 23-43k triangles in 8-11 draws, where the height map
//   was 11-16k in 1-3. menu 12/12 32.7k · free-start 19/19 42.5k ·
//   bench-walk 23/25 43.3k · run 23/37 40.7k · fight 59/80 41.0k ·
//   deaths 79/85 39.3k · wrecks 79/98 39.5k · away 37/89 41.1k ·
//   dig 15/16 38.7k (new: three blasts rebuild their chunks in the worker) ·
//   rain 18 31.3k · snow 16 23.3k · dust 12 18.0k. Spec 18 allows 70k
//   ground triangles. Rain's garbage measured 88-96 KB (the worker's results
//   arriving land in whichever scene is running).
// After #315 (the ?debug readout made its text four times a second, not
//   every frame, and kept its frame times in a ring; the compass tape's
//   labels made once): allocKB menu 33 · free-start 104 · walk 123 ·
//   run 95 · fight 180 · deaths 164 · wrecks 112 · away 73 · dig 53 ·
//   rain 76 · snow 76 · dust 74 (dust was 89-94, on its 90 KB budget).
//   Budgets left where they were.
// Hold to dig (spec 25 part 2), first measured: scoop 15/16 31.9k, particles
//   28 (53 at most: dirt, sparks and the clods), 45 KB a frame, with the
//   chunks rebuilding two and a half times a second in the worker.
// Fine digging that settles (spec 27 part 1): a dig or a crater near you
//   makes a patch of 2 m ground, meshed in the worker, that the 8 m chunks
//   round it skip; it settles back 15 s after its last dig. The scenes that
//   dig pay for it, the rest don't (with no patch the numbers are main's):
//   dig 20/21 46.7k 122 KB (main 15/16 38.7k 61 KB: three patches' draws and
//   their 2 m ground) · deaths 295 KB (165) · wrecks 248 KB (123) · away
//   48.5k 175 KB (41.1k 86) · fight 234 KB (191) · scoop 70 KB (54). The
//   garbage is the patches' own arrays and the chunks round them meshed
//   again when one is born, grows and goes; the per-frame paths box nothing
//   (world/voxels.js keeps the hot loops free of calls through variables).
// The ground on a 4 m grid (spec 29): the near ground's triangles about
//   double, everything else as it was: menu 74.9k (32.9k) · free-start 94.6k
//   (42.8k) · walk 88.8k (44.8k) · run 78.7k (42.2k) · fight 79.6k (43.0k) ·
//   deaths 76.1k (41.1k) · wrecks 78.5k (44.1k) · away 95.5k (48.5k) · dig
//   86.4k (46.7k) · scoop 65.0k (32.0k) · rain 83.4k (31.6k) · snow 75.4k
//   (23.5k) · dust 70.1k (18.3k). Draws and garbage unchanged (spec 14: the
//   cost is draw calls, not polygons); to be checked on a mid phone.
// Budgets are the latest numbers plus ~15%.
export const BUDGETS = {
  menu:           { meanDraws: 14, peakDraws: 14, tris: 86000, allocKB: 38 },   // the menu's 60 frames are too few for drawWorld to be optimized, so its sums box a little
  'free-start':   { meanDraws: 22, peakDraws: 22, tris: 109000, allocKB: 125 },
  'bench-walk':   { meanDraws: 27, peakDraws: 29, tris: 102000, allocKB: 150 },
  'bench-run':    { meanDraws: 27, peakDraws: 43, tris: 90500, allocKB: 120 },
  'bench-fight':  { meanDraws: 68, peakDraws: 92, tris: 91500, allocKB: 270 },   // craters make fine patches (spec 27)
  'bench-deaths': { meanDraws: 91, peakDraws: 98, tris: 87500, allocKB: 340 },
  'bench-wrecks': { meanDraws: 91, peakDraws: 113, tris: 90500, allocKB: 285 },
  'bench-away':   { meanDraws: 43, peakDraws: 102, tris: 110000, allocKB: 200 },
  'bench-dig':    { meanDraws: 23, peakDraws: 24, tris: 99500, allocKB: 140 },   // three digs: the main thread only copies corners out and uploads what comes back; each makes a fine patch (spec 27)
  scoop:          { meanDraws: 18, peakDraws: 19, tris: 75000, allocKB: 80 },   // DIG held 10 s at the range's mesa (spec 25): clods are particles, so no draws of their own; a fine patch round the face (spec 27)
  rain:           { meanDraws: 21, peakDraws: 21, tris: 96000, allocKB: 110 },   // free-start in a downpour: one more draw (the rain), no more garbage
  snow:           { meanDraws: 19, peakDraws: 19, tris: 87000, allocKB: 95 },   // and in snow
  dust:           { meanDraws: 14, peakDraws: 14, tris: 81000, allocKB: 90 },   // and in a dust storm (2,500 grains)
};
// PERF_BUDGET_SCALE=0.5 npm run perf scales every budget (e.g. to see it fail).
const SCALE = Number(process.env.PERF_BUDGET_SCALE) || 1;

const PORT = 8124, URL_ = `http://localhost:${PORT}/?debug=1&lock`;   // &lock: a fresh save's field (?debug=1 alone opens every mech, and Free Play picks from them)
const candidates = [process.env.PLAYWRIGHT_CHROMIUM, '/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
let executablePath = candidates.find(p => existsSync(p));
if (!executablePath) { try { executablePath = execSync('which chromium || which chromium-browser || which google-chrome').toString().trim() || undefined; } catch { /* playwright's own */ } }

// In the page: count draws and triangles, and step frames by hand.
function setup() {
  const app = window.__stompy.app, R = app.R, G = window.__stompy.game;
  window.requestAnimationFrame = () => 0;   // the game's loop stops after its current frame
  const S = window.__perf = { draws: 0, tris: 0, frameDraws: [] };
  // Draws from the renderer's own count (per-part, skinned and instanced alike);
  // triangles from the per-part and skinned draw calls (effects are a few hundred).
  const draw = R.draw, drawSkinned = R.drawSkinned;
  R.draw = (mesh, ...a) => { S.tris += mesh.count / 3; return draw(mesh, ...a); };
  if (R.skinned) R.drawSkinned = (mesh, ...a) => { S.tris += mesh.count / 3; return drawSkinned(mesh, ...a); };
  const drawProps = R.drawProps;   // instanced props: each mesh's triangles times its instances
  R.drawProps = (B, meshes) => { for (const k in B) S.tris += meshes[k].count / 3 * B[k].n; return drawProps(B, meshes); };
  window.__frames = async (n, input) => {
    const { update, noInput } = await import('/src/sim/update.js');
    const out = { draws: [], tris: [], parts: [], sim: [], scene: [], hud: [] };
    const gl = R.gl, now = () => performance.now();
    for (let i = 0; i < n; i++) {
      G.clock += 1000 / 60;
      const t0 = now();
      if (G.state === 'menu') app.ui.menuTick(1 / 60);
      else update(G, input ? Object.assign(noInput(), input) : noInput(), 1 / 60);
      S.tris = 0;
      const t1 = now();
      app.scene.render(); gl.finish();   // finish: the frame's GL work lands in this frame's time
      const t2 = now();
      app.hud.draw();
      const t3 = now();
      out.draws.push(R.draws); out.tris.push(S.tris); out.parts.push(G.parts.length);   // render() starts the draw count at 0
      out.sim.push(t1 - t0); out.scene.push(t2 - t1); out.hud.push(t3 - t2);
    }
    return out;
  };
}

const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT), '.'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
mkdirSync('test-results', { recursive: true });
const results = {};
let failed = false;
try {
  const browser = await chromium.launch({ executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('stompy.camp.mission', '0'); });
  await page.goto(URL_);
  await page.waitForSelector('.mm-title', { timeout: 15000 });
  await page.evaluate(() => window.__stompy.app.scene.groundReady());
  await page.evaluate(setup);
  await page.waitForTimeout(100);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  // Run `frames` frames and record them as scene `name` (after `warm` unrecorded
  // ones), with `input` held (merged over noInput()) if given.
  const scene = async (name, frames, warm = 0, input = null) => {
    if (warm) await page.evaluate(n => window.__frames(n), warm);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });   // count garbage too, not just survivors
    if (process.env.PERF_CPU) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
    const f = await page.evaluate(([n, inp]) => window.__frames(n, inp), [frames, input]);
    if (process.env.PERF_CPU) {   // PERF_CPU=1 npm run perf: each scene's busiest functions, by self time
      const { profile } = await cdp.send('Profiler.stop'), self = {}, byId = new Map(profile.nodes.map(n => [n.id, n])), dt = profile.timeDeltas;
      profile.samples.forEach((id, i) => { const cf = byId.get(id).callFrame, key = `${cf.functionName || '(anon)'} ${cf.url.split('/src/').pop()}:${cf.lineNumber + 1}`; self[key] = (self[key] || 0) + (dt[i] || 0); });
      const js = Object.entries(self).filter(([k]) => !k.startsWith('(')), total = js.reduce((a, [, v]) => a + v, 0);   // the game's own code: not idle, the browser or GC
      console.log(`busiest, ${name} (% of the game's own JS time, ${(total / 1000 / frames).toFixed(2)} ms a frame):`);
      js.sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(String((v / total * 100).toFixed(1)).padStart(6), k));
    }
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const bytes = (function sum(node) { return node.selfSize + node.children.reduce((a, c) => a + sum(c), 0); })(profile.head);
    if (process.env.PERF_TOP) {   // PERF_TOP=1 npm run perf: where each scene's garbage comes from
      const by = {};
      (function walk(n) { const cf = n.callFrame, key = `${cf.functionName || '(anon)'} ${cf.url.split('/src/').pop()}:${cf.lineNumber + 1}`; if (n.selfSize) by[key] = (by[key] || 0) + n.selfSize; n.children.forEach(walk); })(profile.head);
      console.log(`top allocators, ${name} (KB/frame):`);
      Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(String(Math.round(v / frames / 1024)).padStart(6), k));
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length, med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
    results[name] = { frames, meanDraws: Math.round(mean(f.draws)), peakDraws: Math.max(...f.draws), tris: Math.round(Math.max(...f.tris)), parts: Math.round(mean(f.parts)), peakParts: Math.max(...f.parts), allocKB: Math.round(bytes / frames / 1024),
      simMs: +med(f.sim).toFixed(2), sceneMs: +med(f.scene).toFixed(2), hudMs: +med(f.hud).toFixed(2) };   // medians; this machine's, software GL: for comparing, not budgets
  };

  await scene('menu', 60);
  // A fixed Free Play match: three JACKALs on the ring, seed 1234, dusk.
  await page.evaluate(async () => {
    const { startMatch } = await import('/src/sim/state.js');
    const G = window.__stompy.game, app = window.__stompy.app;
    startMatch(G, { name: 'Perf', pal: 'dusk', foes: ['jackal', 'jackal', 'jackal'], intel: '' }, 1234, false, 'kestrel');
    G.kind = 'free'; G.diff = 'normal';
    app.scene.uploadWorld(); app.ui.launch();
    await app.scene.groundReady();   // the far chunks mesh in the worker; measure the whole ground
    window.requestAnimationFrame = () => 0;
    // The sound samples decode once, as they arrive; let that finish before
    // measuring, or it lands as garbage in whichever scene is running (it
    // added up to ~50 KB a frame to free-start now and then).
    await app.audio.loadSamples();
  });
  await scene('free-start', 60, 10);
  // The bench (src/sim/bench.js): one scripted scene, nobody thinking and
  // nobody hurt, every step, shot, lost limb and kill on its clock, so a
  // change to the AI, the dice or the walk doesn't reshuffle what it measures.
  // Each of its segments is a scene here, recorded end to end.
  const segs = await page.evaluate(async () => {
    const { startBench, BENCH_SEGS } = await import('/src/sim/bench.js');
    const G = window.__stompy.game, app = window.__stompy.app;
    startBench(G);
    app.scene.uploadWorld(); app.ui.launch();
    await app.scene.groundReady();   // the far chunks mesh in the worker; measure the whole ground
    window.requestAnimationFrame = () => 0;
    return BENCH_SEGS;
  });
  let from = 0;
  for (const s of segs) { await scene(`bench-${s.key}`, Math.round((s.to - from) * 60)); from = s.to; }
  // Hold to dig (docs/specs/25-hold-to-dig.md): the range's mesa in the
  // digger, DIG held 10 s at its face. Its chunks rebuild in the worker two
  // and a half times a second, and the clods fly, land and sink.
  await page.evaluate(async () => {
    const { startMatch } = await import('/src/sim/state.js');
    const { rangeDef } = await import('/src/data/range.js');
    const { shiftMech } = await import('/src/sim/walkView.js');
    const G = window.__stompy.game, app = window.__stompy.app;
    startMatch(G, rangeDef({ ground: 'mesa' }), 7, false, 'digger');
    G.kind = 'range'; G.diff = 'normal';
    app.scene.uploadWorld(); app.ui.launch();
    await app.scene.groundReady();
    window.requestAnimationFrame = () => 0;
    const D = G.player;
    let z = 0;
    while (G.ter.height(0, z) < G.ter.height(0, 0) + 4) z++;
    shiftMech(D, -D.x, z - 8 - D.z); Object.assign(D, { pitch: 0, yaw: 0, twist: 0 });
  });
  await scene('scoop', 600, 0, { held: { energy: true, ballistic: false, missile: false, fusion: false } });
  // Weather on its own: the free-start match again, in rain and in snow, to
  // compare with free-start (spec 07: the box of drops is one more draw and
  // no garbage).
  for (const [name, pal, weather] of [['rain', 'dusk', 'rain'], ['snow', 'ice', 'snow'], ['dust', 'volcanic', 'dust']]) {
    await page.evaluate(async ([pal, weather]) => {
      const { startMatch } = await import('/src/sim/state.js');
      const G = window.__stompy.game, app = window.__stompy.app;
      startMatch(G, { name: 'Perf', pal, weather, foes: ['jackal', 'jackal', 'jackal'], intel: '' }, 1234, false, 'kestrel');
      G.kind = 'free'; G.diff = 'normal';
      app.scene.uploadWorld(); app.ui.launch();
    await app.scene.groundReady();   // the far chunks mesh in the worker; measure the whole ground
      window.requestAnimationFrame = () => 0;
    }, [pal, weather]);
    await scene(name, 60, 30);
  }

  await browser.close();
  if (errors.length) { failed = true; console.error('page errors:\n' + errors.join('\n')); }
} catch (e) {
  failed = true; console.error(e);
} finally {
  server.kill();
}

const cols = ['meanDraws', 'peakDraws', 'tris', 'parts', 'peakParts', 'allocKB', 'simMs', 'sceneMs', 'hudMs'];   // the ms columns have no budgets (machine-dependent)
console.log(['scene'.padEnd(14), ...cols.map(c => c.padStart(10))].join(''));
for (const [name, r] of Object.entries(results)) {
  const b = Object.fromEntries(Object.entries(BUDGETS[name] || {}).map(([k, v]) => [k, Math.round(v * SCALE)])), over = cols.filter(c => b[c] != null && r[c] > b[c]);
  if (over.length) failed = true;
  console.log([name.padEnd(14), ...cols.map(c => `${r[c]}${b[c] != null ? (r[c] > b[c] ? '!' : '') : ''}`.padStart(10))].join('') + (over.length ? `   OVER: ${over.map(c => `${c} ${r[c]} > ${b[c]}`).join(', ')}` : ''));
}
writeFileSync('test-results/perf.json', JSON.stringify({ results, budgets: BUDGETS }, null, 2));
console.log(failed ? 'perf: OVER BUDGET (or errored)' : 'perf: OK');
process.exit(failed ? 1 : 0);
