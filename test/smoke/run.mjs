// Smoke test in a real browser: serve the repo, load the page, start a Free
// Play mission, hold W for a while, and check the mech moved with no errors.
// Uses playwright-core with whatever Chromium is available: the preinstalled
// one in Claude cloud containers, PLAYWRIGHT_CHROMIUM, or `chromium` on PATH.
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const PORT = 8123, URL_ = `http://localhost:${PORT}/?debug=1`;
const candidates = [process.env.PLAYWRIGHT_CHROMIUM, '/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
let executablePath = candidates.find(p => existsSync(p));
if (!executablePath) { try { executablePath = execSync('which chromium || which chromium-browser || which google-chrome').toString().trim(); } catch { /* none */ } }

const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT), process.env.SMOKE_DIR || '.'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
mkdirSync('test-results', { recursive: true });
let failed = false;
try {
  const browser = await chromium.launch({ executablePath, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const run = async (name, url, body) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, hasTouch: name === 'touch' });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: console ${m.text()}`); });
    await page.goto(url);
    await page.waitForSelector('.mm-title', { timeout: 15000 });
    await body(page);
    await page.screenshot({ path: `test-results/smoke-${name}.png` });
    await page.close();
  };
  await run('desktop', URL_, async page => {
    await page.click('[data-sel="free"]');
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy?.game?.state === 'play', null, { timeout: 10000 });
    const x0 = await page.evaluate(() => [window.__stompy.game.player.x, window.__stompy.game.player.z, window.__stompy.game.frame]);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');
    const x1 = await page.evaluate(() => [window.__stompy.game.player.x, window.__stompy.game.player.z, window.__stompy.game.frame]);
    const moved = Math.hypot(x1[0] - x0[0], x1[1] - x0[1]);
    console.log(`desktop: moved ${moved.toFixed(1)} m over ${x1[2] - x0[2]} frames`);
    if (!(moved > 5)) { failed = true; console.error('FAIL: the mech did not move under throttle'); }
    if (!(x1[2] - x0[2] > 20)) { failed = true; console.error('FAIL: the frame counter barely advanced'); }
    // Every weapon, the jets, targeting and the pause, with the enemies awake.
    await page.evaluate(() => { for (const m of window.__stompy.game.mechs) if (m.team) m.ai.aware = true; });
    for (const [key, ms] of [['Digit1', 900], ['Digit2', 200], ['Space', 100], ['Space', 700], ['KeyJ', 800], ['KeyT', 50], ['KeyF', 50], ['KeyZ', 50], ['KeyZ', 50], ['KeyG', 1200]]) {
      await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(150);
    }
    const st = await page.evaluate(() => { const g = window.__stompy.game; return { heat: g.player.heat, shots: g.stats.shots, state: g.state, parts: g.parts.length }; });
    console.log(`desktop: after firing heat=${st.heat.toFixed(0)} shots=${st.shots.toFixed(0)} state=${st.state} particles=${st.parts}`);
    if (!(st.shots > 5)) { failed = true; console.error('FAIL: weapons did not fire'); }
    await page.keyboard.press('KeyP'); await page.waitForTimeout(200);
    const paused = await page.evaluate(() => window.__stompy.game.paused && !document.querySelector('.mech-overlay').hidden);
    if (!paused) { failed = true; console.error('FAIL: P did not pause'); }
    await page.keyboard.press('KeyP'); await page.waitForTimeout(200);
    // Win the mission through the real destroy path and reach the debrief.
    await page.evaluate(() => { const s = window.__stompy; for (const m of s.game.mechs) if (m.team && m.alive) s.kill(m); });
    await page.waitForFunction(() => window.__stompy.game.state === 'debrief', null, { timeout: 8000 });
    const won = await page.evaluate(() => /MISSION COMPLETE/.test(document.querySelector('.mech-overlay').textContent));
    console.log(`desktop: debrief reached, won=${won}`);
    if (!won) { failed = true; console.error('FAIL: debrief did not show MISSION COMPLETE'); }
  });
  await run('touch', URL_ + '&touch=1', async page => {
    // Taps, not clicks: a mouse click would switch the game back to mouse mode.
    await page.tap('[data-sel="free"]');
    await page.tap('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy?.game?.state === 'play', null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const ok = await page.evaluate(() => !document.querySelector('.touch-ui').hidden && window.__stompy.game.touchUI === true);
    console.log(`touch: cluster visible ${ok}`);
    if (!ok) { failed = true; console.error('FAIL: touch UI not shown'); }
  });
  await browser.close();
  if (errors.length) { failed = true; console.error('FAIL: page errors:\n  ' + errors.join('\n  ')); }
} catch (e) {
  failed = true; console.error('FAIL:', e.message);
} finally {
  server.kill();
}
console.log(failed ? 'smoke: FAILED' : 'smoke: OK');
process.exit(failed ? 1 : 0);
