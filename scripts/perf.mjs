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
// Budgets are the latest numbers plus ~15%.
export const BUDGETS = {
  menu:           { meanDraws: 4, peakDraws: 4, tris: 25000, allocKB: 26 },
  'free-start':   { meanDraws: 4, peakDraws: 4, tris: 25000, allocKB: 115 },
  fight:          { meanDraws: 24, peakDraws: 43, tris: 27000, allocKB: 205 },
  'fight-deaths': { meanDraws: 33, peakDraws: 41, tris: 27000, allocKB: 205 },
  wrecks:         { meanDraws: 30, peakDraws: 38, tris: 26000, allocKB: 145 },
  'looking-away': { meanDraws: 12, peakDraws: 15, tris: 25000, allocKB: 135 },
  rain:           { meanDraws: 4, peakDraws: 4, tris: 25000, allocKB: 115 },   // free-start in a downpour: one more draw, no more garbage
  snow:           { meanDraws: 4, peakDraws: 4, tris: 25000, allocKB: 115 },   // and in snow
};
// PERF_BUDGET_SCALE=0.5 npm run perf scales every budget (e.g. to see it fail).
const SCALE = Number(process.env.PERF_BUDGET_SCALE) || 1;

const PORT = 8124, URL_ = `http://localhost:${PORT}/?debug=1`;
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
  window.__frames = async (n, input) => {
    const { update, noInput } = await import('/src/sim/update.js');
    const out = { draws: [], tris: [], parts: [] };
    for (let i = 0; i < n; i++) {
      G.clock += 1000 / 60;
      if (G.state === 'menu') app.ui.menuTick(1 / 60);
      else update(G, input ? Object.assign(noInput(), input) : noInput(), 1 / 60);
      S.tris = 0;
      app.scene.render(); app.hud.draw();
      out.draws.push(R.draws); out.tris.push(S.tris); out.parts.push(G.parts.length);   // render() starts the draw count at 0
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
    const f = await page.evaluate(n => window.__frames(n), frames);
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const bytes = (function sum(node) { return node.selfSize + node.children.reduce((a, c) => a + sum(c), 0); })(profile.head);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    results[name] = { frames, meanDraws: Math.round(mean(f.draws)), peakDraws: Math.max(...f.draws), tris: Math.round(Math.max(...f.tris)), parts: Math.round(mean(f.parts)), peakParts: Math.max(...f.parts), allocKB: Math.round(bytes / frames / 1024) };
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
  for (const [name, pal, weather] of [['rain', 'dusk', 'rain'], ['snow', 'ice', 'snow']]) {
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

const cols = ['meanDraws', 'peakDraws', 'tris', 'parts', 'peakParts', 'allocKB'];
console.log(['scene'.padEnd(14), ...cols.map(c => c.padStart(10))].join(''));
for (const [name, r] of Object.entries(results)) {
  const b = Object.fromEntries(Object.entries(BUDGETS[name] || {}).map(([k, v]) => [k, Math.round(v * SCALE)])), over = cols.filter(c => b[c] != null && r[c] > b[c]);
  if (over.length) failed = true;
  console.log([name.padEnd(14), ...cols.map(c => `${r[c]}${b[c] != null ? (r[c] > b[c] ? '!' : '') : ''}`.padStart(10))].join('') + (over.length ? `   OVER: ${over.map(c => `${c} ${r[c]} > ${b[c]}`).join(', ')}` : ''));
}
writeFileSync('test-results/perf.json', JSON.stringify({ results, budgets: BUDGETS }, null, 2));
console.log(failed ? 'perf: OVER BUDGET (or errored)' : 'perf: OK');
process.exit(failed ? 1 : 0);
