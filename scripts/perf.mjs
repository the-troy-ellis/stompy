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
// Budgets are the latest numbers plus ~15%.
export const BUDGETS = {
  menu:           { meanDraws: 4, peakDraws: 4, tris: 25000, allocKB: 26 },
  'free-start':   { meanDraws: 8, peakDraws: 8, tris: 25000, allocKB: 115 },
  fight:          { meanDraws: 31, peakDraws: 58, tris: 27000, allocKB: 205 },
  'fight-deaths': { meanDraws: 55, peakDraws: 72, tris: 27000, allocKB: 205 },
  wrecks:         { meanDraws: 60, peakDraws: 70, tris: 26000, allocKB: 145 },
  'looking-away': { meanDraws: 26, peakDraws: 30, tris: 27000, allocKB: 135 },
  rain:           { meanDraws: 9, peakDraws: 9, tris: 25000, allocKB: 90 },   // free-start in a downpour: one more draw (the rain), no more garbage
  snow:           { meanDraws: 11, peakDraws: 11, tris: 25000, allocKB: 90 },   // and in snow
  dust:           { meanDraws: 11, peakDraws: 11, tris: 25000, allocKB: 90 },   // and in a dust storm (2,500 grains)
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
  await page.evaluate(setup);
  await page.waitForTimeout(100);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  // Run `frames` frames and record them as scene `name` (after `warm` unrecorded ones).
  const scene = async (name, frames, warm = 0) => {
    if (warm) await page.evaluate(n => window.__frames(n), warm);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });   // count garbage too, not just survivors
    if (process.env.PERF_CPU) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
    const f = await page.evaluate(n => window.__frames(n), frames);
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
    window.requestAnimationFrame = () => 0;
    // The sound samples decode once, as they arrive; let that finish before
    // measuring, or it lands as garbage in whichever scene is running (it
    // added up to ~50 KB a frame to free-start now and then).
    await app.audio.loadSamples();
  });
  await scene('free-start', 60, 10);
  // Six mechs 70-145 m ahead, all awake and shooting; the player can't die.
  await page.evaluate(async () => {
    const { newMech } = await import('/src/sim/state.js');
    const G = window.__stompy.game, P = G.player;
    for (const m of G.mechs) if (m.team) { m.alive = false; m.x += 5000; }
    ['jackal', 'warden', 'puncher', 'sniper1', 'light1', 'jackal'].forEach((t, i) => {
      const a = (i - 2.5) * 0.25, d = 70 + i * 15;
      const e = newMech(G, t, 1, P.x + Math.sin(P.yaw + a) * d, P.z + Math.cos(P.yaw + a) * d, P.yaw + Math.PI);
      e.ai.aware = true; G.mechs.push(e);
    });
    for (const k in P.hp) P.hp[k] = 1e6;
  });
  await scene('fight', 120, 150);
  await page.evaluate(() => { const s = window.__stompy; s.game.mechs.filter(m => m.team && m.alive).slice(0, 3).forEach(m => s.kill(m)); });
  await scene('fight-deaths', 45);
  await scene('wrecks', 120, 60);
  // The same field with the player turned away: culling (spec 14 P6) skips
  // the mechs, wrecks and smoke behind.
  await page.evaluate(() => { const P = window.__stompy.game.player; P.yaw += Math.PI; P.twist = 0; });
  await scene('looking-away', 60);
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
