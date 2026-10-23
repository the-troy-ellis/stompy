// Smoke test in a real browser: serve the repo, load the page, start a Free
// Play mission, hold W for a while, and check the mech moved with no errors.
// Uses playwright-core with whatever Chromium is available: the preinstalled
// one in Claude cloud containers, PLAYWRIGHT_CHROMIUM, or `chromium` on PATH.
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, hasTouch: name.startsWith('touch') });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: console ${m.text()}`); });
    await page.goto(url);
    await page.waitForSelector('.mm-title', { timeout: 15000 });
    await body(page);
    await page.screenshot({ path: `test-results/smoke-${name}.png` });
    await page.close();
  };
  await run('desktop', URL_ + '&lock', async page => {   // &lock: the locks a fresh save has, which ?debug=1 would open
    // FIT: cycle the left arm, see the preview mech change, go overweight, reset, back.
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-sel]')].map(b => b.dataset.sel).join(','));
    if (tabs !== 'campaign,free,mp,settings') { failed = true; console.error(`FAIL: &lock should show the player's four tabs (${tabs})`); }
    await page.click('[data-a="fit"]');
    await page.waitForSelector('.lab-row');
    await page.click('[data-lab="hp"][data-id="la"][data-d="1"]');
    const fitted = await page.evaluate(() => window.__stompy.game.player.weapons.map(w => w.type).join(','));
    if (!fitted.startsWith('mlaser,laser')) { failed = true; console.error(`FAIL: FIT did not refit the preview (${fitted})`); }
    await page.click('[data-lab="hp"][data-id="la"][data-d="-1"]');   // back to the stock laser
    await page.click('[data-lab="sys"][data-id="jets"][data-d="1"]');
    for (let i = 0; i < 2; i++) await page.click('[data-lab="sys"][data-id="armour"][data-d="1"]');
    for (let i = 0; i < 3; i++) await page.click('[data-lab="sys"][data-id="sinks"][data-d="1"]');
    await page.screenshot({ path: 'test-results/smoke-fit.png' });
    const heavy = await page.evaluate(() => [document.querySelector('.mm-launch')?.disabled, document.querySelector('.lab-tons')?.textContent]);
    console.log(`desktop: FIT ${fitted}; launch disabled=${heavy[0]} (${heavy[1].trim()})`);
    if (heavy[0] !== true || !/OVERWEIGHT/.test(heavy[1])) { failed = true; console.error('FAIL: an overweight fit did not disable LAUNCH'); }
    await page.setViewportSize({ width: 740, height: 360 });
    await page.screenshot({ path: 'test-results/smoke-fit-phone.png' });
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.click('[data-lab="reset"]');
    const stock = await page.evaluate(() => [document.querySelector('.mm-launch')?.disabled, window.__stompy.game.player.weapons.map(w => w.type).join(',')]);
    if (stock[0] || stock[1] !== 'laser,laser,ac,lrm,fusion') { failed = true; console.error(`FAIL: RESET did not restore stock (${stock})`); }
    await page.click('[data-lab="back"]');
    // The selector: PIPSQUEAK is fourth and locked on a fresh save; LAUNCH says so and does nothing.
    for (let i = 0; i < 3; i++) await page.click('[data-mech="1"]');
    const lock = await page.evaluate(() => [document.querySelector('.mm-launch')?.disabled, document.querySelector('.mm-launch')?.textContent, document.querySelector('.mm-role')?.textContent, !!document.querySelector('.mm-fit')]);
    console.log(`desktop: ${lock[2]}; launch ${lock[1]} disabled=${lock[0]}`);
    if (!lock[0] || lock[1] !== 'LOCKED' || !/^LOCKED/.test(lock[2]) || lock[3]) { failed = true; console.error(`FAIL: a locked chassis could launch or fit (${lock})`); }
    await page.screenshot({ path: 'test-results/smoke-locked.png' });
    for (let i = 0; i < 3; i++) await page.click('[data-mech="-1"]');
    await page.click('[data-sel="settings"]');
    await page.click('[data-opt="frameTime"]');   // the readout on, through the setting rather than ?debug
    await page.click('[data-set="fov"][data-d="1"]');
    const fov = await page.evaluate(() => window.__stompy.app.prefs.fov);
    if (fov !== 67) { failed = true; console.error(`FAIL: the FOV dial read ${fov}, not 67`); }
    await page.click('[data-sel="free"]');
    await page.click('[data-fp="diff"][data-d="1"]');   // NORMAL -> HARD
    for (let i = 0; i < 2; i++) await page.click('[data-fp="mix"][data-d="1"]');   // MIXED -> LIGHT -> HEAVY
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy?.game?.state === 'play', null, { timeout: 10000 });
    const diff = await page.evaluate(() => [window.__stompy.app.prefs.diff, window.__stompy.game.diff, [...new Set(window.__stompy.game.mechs.filter(m => m.team).map(m => m.type))].join(',')]);
    console.log(`desktop: difficulty ${diff[0]} / game ${diff[1]}; HEAVY mix on a fresh save: ${diff[2]}`);
    if (!(diff[0] === 'hard' && diff[1] === 'hard')) { failed = true; console.error('FAIL: the difficulty picker did not reach the game'); }
    if (diff[2] !== 'kestrel') { failed = true; console.error(`FAIL: HEAVY on a fresh save should fall back to KESTRELs, with no heavy unlocked yet (${diff[2]})`); }
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
    for (const [key, ms] of [['Digit1', 900], ['Digit2', 200], ['Space', 100], ['Space', 700], ['KeyJ', 800], ['KeyT', 50], ['KeyE', 50], ['KeyF', 50], ['KeyZ', 50], ['KeyZ', 50], ['KeyG', 1200]]) {
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
  // The DEBUG tab (docs/specs/19-debug-menu.md): a fresh debug run opens on it; JUMP TO -> BENCH plays the bench.
  await run('debug-tab', URL_, async page => {
    const seen = await page.evaluate(() => [[...document.querySelectorAll('[data-sel]')].map(b => b.dataset.sel).join(','), document.querySelector('.mm-item.on')?.dataset.sel]);
    console.log(`debug tab: tabs ${seen[0]}, opened on ${seen[1]}`);
    if (seen[0] !== 'campaign,free,mp,settings,debug' || seen[1] !== 'debug') { failed = true; console.error(`FAIL: ?debug=1 should show a DEBUG tab and open on it (${seen})`); }
    await page.click('[data-dsec="jump"]');
    await page.click('[data-dmis="1"]');
    const mis = await page.evaluate(() => window.__stompy.app.prefs.mission);
    await page.screenshot({ path: 'test-results/smoke-debug-tab.png' });
    await page.click('[data-dj="bench"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'bench' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    console.log(`debug tab: MISSION picker at ${mis + 1}; BENCH started`);
  });
  // RANGE: the arch, two foes standing still; LAUNCH puts you on the range facing it.
  await run('debug-range', URL_, async page => {
    await page.click('[data-dsec="cheats"]');
    await page.click('[data-dch="digs"]');   // BIG DIGS on
    await page.screenshot({ path: 'test-results/smoke-debug-cheats.png' });
    await page.click('[data-dsec="range"]');
    await page.screenshot({ path: 'test-results/smoke-debug-range-menu.png' });
    const ground = await page.$eval('[data-drg="ground"] ~ b', b => b.textContent);
    if (ground !== 'ARCH') await page.click('[data-drg="ground"][data-d="1"]');
    await page.click('[data-drg="foes"][data-d="1"]');   // NONE -> STANDING STILL
    await page.click('[data-drg="n"][data-d="1"]');
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'range' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => { const G = window.__stompy.game, f = G.mechs.filter(m => m.team === 1); return { arch: G.ter.solid(0, 40, 220), foes: f.length, still: f.every(m => m.ai.still), objectives: G.objectives.length }; });
    console.log(`debug range: arch ${r.arch}, ${r.foes} foes standing still ${r.still}, objectives ${r.objectives}`);
    if (!r.arch || r.foes !== 2 || !r.still || r.objectives) { failed = true; console.error(`FAIL: RANGE did not build the arch with two still foes (${JSON.stringify(r)})`); }
    // The pause menu's DEBUG block shows the cheat on; switch it off from there.
    await page.keyboard.press('p');
    await page.waitForSelector('.dbg-pause [data-dch="digs"]', { timeout: 5000 });
    const before = await page.$eval('.dbg-pause [data-dch="digs"]', b => b.textContent);
    await page.click('.dbg-pause [data-dch="digs"]');
    const after = await page.evaluate(() => [document.querySelector('.dbg-pause [data-dch="digs"]').textContent, window.__stompy.game.cheats.digs]);
    console.log(`debug cheats: pause shows ${before}, then ${after[0]} (G.cheats.digs ${after[1]})`);
    if (before !== 'BIG DIGS: ON' || after[0] !== 'BIG DIGS: OFF' || after[1] !== false) { failed = true; console.error('FAIL: the pause menu\'s cheat switch'); }
  });
  // The digger (spec 20, #308): ?debug=1's selector offers it; on the range its punch bites the mesa and fills the hopper.
  await run('digger', URL_, async page => {
    for (let i = 0; i < 8 && (await page.evaluate(() => window.__stompy.app.prefs.chassis)) !== 'digger'; i++) await page.click('[data-mech="1"]');
    const menu = await page.evaluate(() => [window.__stompy.app.prefs.chassis, document.querySelector('.mm-role')?.textContent, !!document.querySelector('.mm-fit')]);
    await page.click('[data-sel="debug"]'); await page.click('[data-dsec="range"]');
    for (let i = 0; i < 8 && (await page.$eval('[data-drg="ground"] ~ b', b => b.textContent)) !== 'MESA'; i++) await page.click('[data-drg="ground"][data-d="1"]');
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'range' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    await page.evaluate(() => { const G = window.__stompy.game, P = G.player; P.z = 182; P.y = G.ter.groundBelow(0, 5, 182); P.yaw = 0; P.twist = 0; });
    for (let i = 0; i < 3; i++) { await page.keyboard.press('e'); await page.waitForTimeout(1400); }
    const r = await page.evaluate(() => ({ ore: window.__stompy.game.player.ore, guns: window.__stompy.game.player.weapons.length }));
    await page.screenshot({ path: 'test-results/smoke-digger.png' });
    console.log(`digger: ${menu[1]} (FIT shown ${menu[2]}); three bites into the mesa, ${r.ore} ore, ${r.guns} guns`);
    if (menu[0] !== 'digger' || menu[1] !== 'IT DIGS.' || menu[2] || !(r.ore > 0) || r.guns) { failed = true; console.error(`FAIL: the digger (${menu}, ${JSON.stringify(r)})`); }
  });
  // TUNING and the overlays (spec 19, #299): a FEEL number edited on the page takes at once; NAV and DIGS AND FALLS
  // drawn over the range's arch after its leg is cut; the same pages in the pause menu.
  await run('tuning', URL_, async page => {
    await page.click('[data-sel="debug"]'); await page.click('[data-dsec="tuning"]');
    await page.click('[data-tune="feel"]');
    const box = await page.$('.dbg-tune input[data-ev="step"][data-col="kick"]');
    await box.fill('0.77'); await box.dispatchEvent('input');
    const kick = await page.evaluate(async () => (await import('/src/data/feel.js')).FEEL.step.kick);
    await page.click('[data-tune="gait"]');
    const gaitRows = await page.$$eval('.dbg-tune input[data-gait]', l => l.length);
    await page.click('[data-tune-a="copy"]');
    const copied = await page.$eval('.dbg-tune-out', t => JSON.parse(t.value).step.kick);
    await page.click('[data-tune="overlays"]');
    for (const k of ['nav', 'digs']) if (!(await page.$eval(`[data-tov="${k}"]`, b => b.classList.contains('on')))) await page.click(`[data-tov="${k}"]`);
    await page.screenshot({ path: 'test-results/smoke-tuning-menu.png' });
    await page.click('[data-dsec="range"]');
    for (let i = 0; i < 8 && (await page.$eval('[data-drg="ground"] ~ b', b => b.textContent)) !== 'ARCH'; i++) await page.click('[data-drg="ground"][data-d="1"]');
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'range' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    const logged = await page.evaluate(async () => {   // the arch's +x leg cut through (as test/torque.test.js), then a dig there runs the rules
      const G = window.__stompy.game, { dig } = await import('/src/sim/dig.js'), ax = 0, az = 220;
      for (const y of [0, 6, 12, 18]) for (const dz of [-8, 0, 8]) for (const dx of [-6, 0, 6]) G.ter.carve([ax - 46 + dx, y, az + dz], 7);
      dig(G, [ax - 46, G.ter.groundBelow(ax - 46, 2, az), az], 4);
      return G.digLog.map(e => e.kind);
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'test-results/smoke-overlay-digs.png' });
    await page.evaluate(async () => {   // a route under the arch, so the nav has links to show (it works them out only when asked)
      const G = window.__stompy.game, P = G.player, { navOf } = await import('/src/sim/ai/nav.js');
      navOf(G).path(P.x, P.y, P.z, 0, 0, 300);
      P.pitch = -0.5;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/smoke-overlay-nav.png' });
    await page.keyboard.press('KeyP'); await page.waitForTimeout(300);
    const inPause = await page.evaluate(() => !!document.querySelector('.dbg-pause .dbg-tune [data-tune="feel"]'));
    await page.screenshot({ path: 'test-results/smoke-tuning-pause.png' });
    const links = await page.evaluate(async () => (await import('/src/sim/ai/nav.js')).navOf(window.__stompy.game).links.size);
    console.log(`tuning: FEEL step.kick -> ${kick}, ${gaitRows} gait inputs, COPY has ${copied}; digs logged ${[...new Set(logged)]}; ${links} nav links; in the pause menu ${inPause}`);
    if (kick !== 0.77 || !(gaitRows > 4) || copied !== 0.77 || !logged.includes('dig') || !logged.includes('weigh') || !inPause) { failed = true; console.error('FAIL: TUNING and the overlays'); }
  });
  // The walk viewer (spec 19 § Walk viewer): JUMP TO → WALK, your mech walking with the camera outside; slow, pause, step, back out.
  await run('walk', URL_, async page => {
    await page.click('[data-sel="debug"]'); await page.click('[data-dsec="jump"]');
    await page.click('[data-dj="walk"]');
    await page.waitForFunction(() => window.__stompy.game.state === 'walk' && window.__stompy.game.player.speed > 1, null, { timeout: 10000 });
    await page.click('[data-w="view"][data-v="three"]'); await page.click('[data-w="time"][data-v="2"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'test-results/smoke-walk.png' });
    await page.click('[data-w="pause"]');
    const t0 = await page.evaluate(() => window.__stompy.game.time);
    await page.waitForTimeout(300);
    const t1 = await page.evaluate(() => window.__stompy.game.time);
    await page.click('[data-w="step"]'); await page.waitForTimeout(200);
    const t2 = await page.evaluate(() => window.__stompy.game.time);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const out = await page.evaluate(() => [window.__stompy.game.state, document.querySelector('.walk-ui')?.hidden]);
    console.log(`walk: paused ${t0 === t1}, a step ${(t2 - t1).toFixed(4)} s; out to ${out[0]}, panel hidden ${out[1]}`);
    if (t0 !== t1 || Math.abs(t2 - t1 - 1 / 60) > 1e-6 || out[0] !== 'menu' || out[1] !== true) { failed = true; console.error('FAIL: the walk viewer'); }
  });
  // The crew and SWAP (spec 20, #310): a range with a digger parked beside you; Q swaps into it and back.
  await run('crew', URL_, async page => {
    await page.click('[data-sel="debug"]'); await page.click('[data-dsec="range"]');
    for (let i = 0; i < 4 && (await page.$eval('[data-drg="crew"] ~ b', b => b.textContent)) === 'JUST YOU'; i++) await page.click('[data-drg="crew"][data-d="1"]');
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'range' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    const first = await page.evaluate(() => [window.__stompy.game.player.type, window.__stompy.game.crew.length]);
    await page.keyboard.press('q'); await page.waitForTimeout(400);
    const second = await page.evaluate(() => { const G = window.__stompy.game; return [G.player === G.crew[1], G.crew[0].parked]; });
    await page.screenshot({ path: 'test-results/smoke-crew.png' });
    await page.keyboard.press('q'); await page.waitForTimeout(300);
    const third = await page.evaluate(() => window.__stompy.game.player === window.__stompy.game.crew[0]);
    console.log(`crew: ${first[1]} in the crew; in ${first[0]}, Q -> the other ${second[0]} (the first parked ${second[1]}), Q -> back ${third}`);
    if (first[1] !== 2 || !second[0] || !second[1] || !third) { failed = true; console.error(`FAIL: SWAP (${first}, ${second}, ${third})`); }
  });
  // The base (spec 20, #309): the digger, a silo; BUILD held then let go puts the factory up.
  await run('base', URL_, async page => {
    for (let i = 0; i < 8 && (await page.evaluate(() => window.__stompy.app.prefs.chassis)) !== 'digger'; i++) await page.click('[data-mech="1"]');
    await page.click('[data-sel="debug"]'); await page.click('[data-dsec="range"]');
    for (let i = 0; i < 8 && (await page.$eval('[data-drg="ground"] ~ b', b => b.textContent)) !== 'FLAT'; i++) await page.click('[data-drg="ground"][data-d="1"]');
    for (let i = 0; i < 3 && (await page.$eval('[data-drg="base"] ~ b', b => b.textContent)) !== 'SILO'; i++) await page.click('[data-drg="base"][data-d="1"]');
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'range' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    await page.evaluate(() => { const G = window.__stompy.game; G.base.ore = 100; G.player.yaw = Math.PI; G.player.twist = 0; });
    await page.keyboard.down('Space'); await page.waitForTimeout(400);
    const preview = await page.evaluate(() => window.__stompy.game.buildAt && window.__stompy.game.buildAt.why);
    await page.keyboard.up('Space'); await page.waitForTimeout(7500);
    const r = await page.evaluate(() => { const b = window.__stompy.game.base; return { silo: b.silo.alive, ore: b.ore, prog: b.factory?.prog }; });
    await page.screenshot({ path: 'test-results/smoke-base.png' });
    console.log(`base: silo up ${r.silo}; BUILD showed the footprint (why ${preview}); factory ${r.prog}, ore left ${r.ore}`);
    if (!r.silo || preview !== null || r.prog !== 1 || r.ore !== 40) { failed = true; console.error(`FAIL: the base (${preview}, ${JSON.stringify(r)})`); }
  });
  // Raids (spec 20, #311): the range's SILO AND A RAID, the raid brought forward; it is called and walks on going for the base.
  await run('raid', URL_, async page => {
    await page.click('[data-sel="debug"]'); await page.click('[data-dsec="range"]');
    for (let i = 0; i < 3 && (await page.$eval('[data-drg="base"] ~ b', b => b.textContent)) !== 'SILO AND A RAID'; i++) await page.click('[data-drg="base"][data-d="1"]');
    await page.click('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'range' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    await page.evaluate(() => { const G = window.__stompy.game; G.waves[0].due = G.time + 4; });
    await page.waitForFunction(() => window.__stompy.game.mechs.some(m => m.team === 1), null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => { const G = window.__stompy.game, f = G.mechs.filter(m => m.team === 1); return { n: f.length, raid: f.every(m => m.ai.raid), silo: G.base.silo.alive }; });
    await page.screenshot({ path: 'test-results/smoke-raid.png' });
    console.log(`raid: ${r.n} raiders, all raiding ${r.raid}, silo up ${r.silo}`);
    if (r.n !== 2 || !r.raid || !r.silo) { failed = true; console.error(`FAIL: the raid (${JSON.stringify(r)})`); }
  });
  // The base mission (spec 20, #312) from JUMP TO: dig the mesa, unload at the silo, put the factory up, swap.
  await run('first-factory', URL_, async page => {
    await page.click('[data-sel="debug"]'); await page.click('[data-dsec="jump"]');
    await page.click('[data-dj="base"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'base' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    const start = await page.evaluate(() => { const G = window.__stompy.game; return [G.player.type, G.crew.length, G.base.ore]; });
    // To the mesa's face (data/missions.js BASE_MISSION: at [10, 190], r 60), facing it.
    await page.evaluate(() => { const G = window.__stompy.game, P = G.player, b = 10 * Math.PI / 180, cx = -Math.sin(b) * 190, cz = Math.cos(b) * 190; P.x = cx; P.z = cz - 71; P.y = G.ter.groundBelow(P.x, 30, P.z); P.yaw = 0; P.twist = 0; });
    for (let i = 0; i < 3; i++) { await page.keyboard.press('e'); await page.waitForTimeout(1400); }
    const dug = await page.evaluate(() => window.__stompy.game.player.ore);
    await page.evaluate(() => { const G = window.__stompy.game, P = G.player, s = G.base.silo; P.x = s.x + Math.sin(s.yaw) * s.radius * 0.9; P.z = s.z + Math.cos(s.yaw) * s.radius * 0.9; P.y = G.ter.groundBelow(P.x, 30, P.z); });
    await page.waitForTimeout(500);
    const unloaded = await page.evaluate(() => [window.__stompy.game.player.ore, window.__stompy.game.base.ore]);
    await page.evaluate(() => { const G = window.__stompy.game, P = G.player; G.base.ore = Math.max(G.base.ore, 60); P.x = 0; P.z = 0; P.y = G.ter.groundBelow(0, 30, 0); P.yaw = Math.PI; P.twist = 0; });
    await page.keyboard.down('Space'); await page.waitForTimeout(400); await page.keyboard.up('Space');
    await page.waitForFunction(() => window.__stompy.game.base.factory?.prog === 1, null, { timeout: 15000 }).catch(() => {});
    const prog = await page.evaluate(() => window.__stompy.game.base.factory?.prog);
    await page.keyboard.press('q'); await page.waitForTimeout(500);
    const now = await page.evaluate(() => window.__stompy.game.player.type);
    await page.screenshot({ path: 'test-results/smoke-first-factory.png' });
    console.log(`first-factory: in the ${start[0]}, crew ${start[1]}, ${start[2]} ore; dug ${dug}; unloaded (hopper ${unloaded[0]}, silo ${unloaded[1]}); factory ${prog}; Q -> ${now}`);
    if (start[0] !== 'digger' || start[1] !== 2 || !(dug > 0) || unloaded[0] !== 0 || !(unloaded[1] > start[2]) || prog !== 1 || now !== 'kestrel') { failed = true; console.error('FAIL: the base mission'); }
  });
  // SWAP on touch (spec 20): the digger shows BUILD and no guns; TGT held swaps into the KESTREL, whose fire buttons appear.
  await run('touch-swap', URL_ + '&touch=1', async page => {
    await page.tap('[data-sel="debug"]'); await page.tap('[data-dsec="jump"]');
    await page.tap('[data-dj="base"]');
    await page.waitForFunction(() => window.__stompy.game.kind === 'base' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const btns = () => page.evaluate(() => Object.fromEntries(['missile', 'energy', 'ballistic', 'fusion'].map(c => { const b = document.querySelector(`[data-t="${c}"]`); return [c, b.hidden ? '-' : b.firstChild.textContent]; })));
    const dig = await btns();
    const box = await (await page.$('[data-t="tgt"]')).boundingBox(), cdp = await page.context().newCDPSession(page), pt = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }); await page.waitForTimeout(800);   // a real finger, held
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const kes = await btns(), now = await page.evaluate(() => window.__stompy.game.player.type);
    await page.screenshot({ path: 'test-results/smoke-touch-swap.png' });
    console.log(`touch-swap: digger ${JSON.stringify(dig)}; TGT held -> ${now} ${JSON.stringify(kes)}`);
    if (dig.missile !== 'BUILD' || dig.energy !== 'DUMP' || now !== 'kestrel' || kes.missile !== 'MISSILE' || kes.energy !== 'ENERGY') { failed = true; console.error('FAIL: touch buttons after SWAP'); }
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
    // The left side flies the mech, the right side only shoots (input.js).
    // Real touches through CDP, on 1024 x 640 (the zones meet 200 px up):
    // the lower stick turns the legs for as long as it's held out and tilts;
    // the upper stick is the throttle (sideways twists the torso); a double
    // tap on the lower one centres the torso; a drag off the buttons on the
    // right does nothing.
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const drag = async (x0, y0, x1, y1, hold = 0) => {
      await touch('touchStart', x0, y0);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6); await page.waitForTimeout(16); }
      if (hold) await page.waitForTimeout(hold);
      await touch('touchEnd');
    };
    const P = () => page.evaluate(() => { const p = window.__stompy.game.player; return { yaw: p.yaw, twist: p.twist, pitch: p.pitch, thr: p.throttle }; });
    await page.evaluate(() => { const g = window.__stompy.game; for (const k in g.player.hp) g.player.hp[k] = 1e6; for (const m of g.mechs) if (m.team) m.ai.aware = false; });
    let a0 = await P();
    await drag(200, 560, 140, 530, 300);
    const short = (await P()).yaw - a0.yaw;
    a0 = await P();
    await drag(200, 560, 140, 530, 1500);   // held out five times as long: it keeps turning
    let a1 = await P();
    const aimOk = a1.yaw - a0.yaw > 2 * short && a1.yaw - a0.yaw > 0.3 && Math.abs(a1.twist - a0.twist) < 0.05 && a1.pitch !== a0.pitch;
    a0 = a1;
    await drag(200, 300, 160, 240, 500);
    a1 = await P();
    const stickOk = a1.thr > a0.thr + 0.3 && a1.twist - a0.twist > 0.2 && Math.abs(a1.yaw - a0.yaw) < 0.05;
    a0 = a1;
    await drag(760, 200, 640, 140);
    await page.waitForTimeout(300);
    a1 = await P();
    const rightOk = Math.abs(a1.yaw - a0.yaw) < 0.01 && Math.abs(a1.twist - a0.twist) < 0.01 && a1.pitch === a0.pitch;
    // A double tap as one burst: the four events queued at once. Awaited one
    // by one, each dispatch waits for a software-rendered frame, and the two
    // taps landed 220-335 ms apart, past the 300 ms window about one run in ten.
    // On the lower stick it punches.
    await page.evaluate(() => { const p = window.__stompy.game.player; p.melee = null; p.meleeCd = 0; });
    await Promise.all([touch('touchStart', 200, 560), touch('touchEnd'), touch('touchStart', 200, 560), touch('touchEnd')]);
    await page.waitForTimeout(150);
    const punched = await page.evaluate(() => !!window.__stompy.game.player.melee);
    // Tap, then tap and hold, on the upper stick: the jets burn while it's held.
    await page.waitForTimeout(800);
    await Promise.all([touch('touchStart', 200, 300), touch('touchEnd'), touch('touchStart', 200, 300)]);
    await page.waitForTimeout(700);
    const jumped = await page.evaluate(() => { const p = window.__stompy.game.player; return !!p.air && p.jetting; });
    await touch('touchEnd');
    // A tap on the compass: the torso swings back over the legs.
    await page.evaluate(() => { window.__stompy.game.player.twist = 1.2; });
    await Promise.all([touch('touchStart', 512, 24), touch('touchEnd')]);
    await page.waitForTimeout(800);
    const centred = Math.abs((await P()).twist) < 0.1;
    const gone = await page.evaluate(() => !document.querySelector('[data-t="jump"]') && !document.querySelector('[data-t="punch"]'));
    console.log(`touch: the lower stick keeps turning the legs while held ${aimOk}, the upper stick sets throttle and twists ${stickOk}, right side only buttons ${rightOk}, double tap lower punches ${punched}, tap then hold upper jumps ${jumped}, compass tap centres ${centred}, no JUMP or PUNCH buttons ${gone}`);
    if (!(aimOk && stickOk && rightOk && punched && jumped && centred && gone)) { failed = true; console.error('FAIL: the touch layout did not behave'); }
  });
  // The mission editor (#246): ?edit=1 shows a mission from above; a tap on a
  // truck selects it, a box round the four trucks selects them all, and
  // tapping empty ground clears it. On a touch screen, with no keyboard.
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, hasTouch: true });
    page.on('pageerror', e => errors.push(`editor: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`editor: console ${m.text()}`); });
    await page.goto(`http://localhost:${PORT}/?debug=1&edit=1&mission=m03`);
    await page.waitForSelector('.ed-panel', { timeout: 15000 });
    const at = id => page.evaluate(i => { const ed = window.__stompy.app.editor; return ed.toScreen(ed.E.map.things.find(x => x.id === i)); }, id);
    const truck = await at('entities.truck2');
    await page.touchscreen.tap(truck[0], truck[1]);
    const one = await page.evaluate(() => [...window.__stompy.app.editor.E.sel]);
    const panelText = await page.textContent('.ed-sel');
    const ends = await Promise.all(['entities.truck1', 'entities.truck4'].map(at));
    const [x0, y0, x1, y1] = [Math.min(ends[0][0], ends[1][0]) - 30, Math.min(ends[0][1], ends[1][1]) - 30, Math.max(ends[0][0], ends[1][0]) + 30, Math.max(ends[0][1], ends[1][1]) + 30];
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', x0, y0);
    for (let k = 1; k <= 8; k++) await touch('touchMove', x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8);
    await touch('touchEnd');
    const boxed = await page.evaluate(() => [...window.__stompy.app.editor.E.sel].sort());
    await page.screenshot({ path: 'test-results/smoke-editor.png' });
    await page.touchscreen.tap(60, 60);
    const cleared = await page.evaluate(() => window.__stompy.app.editor.E.sel.size);
    console.log(`editor: tap ${one.join()} (${panelText.slice(0, 24)}), box ${boxed.join()}, cleared ${cleared === 0}`);
    if (one.join() !== 'entities.truck2' || !/TRUCK/.test(panelText)) { failed = true; console.error('FAIL: a tap did not select the truck'); }
    if (boxed.join() !== 'entities.truck1,entities.truck2,entities.truck3,entities.truck4') { failed = true; console.error('FAIL: the box did not select the four trucks'); }
    if (cleared !== 0) { failed = true; console.error('FAIL: tapping empty ground did not clear the selection'); }
    // #248: dragging a truck and exporting changes that truck's `at` and
    // nothing else.
    const exportText = async () => { await page.tap('[data-act="export"]'); const v = await page.inputValue('.ed-io-text'); await page.tap('[data-io="close"]'); return v; };
    const before = await exportText(), t2 = await at('entities.truck2');
    await touch('touchStart', t2[0], t2[1]);
    for (let k = 1; k <= 6; k++) await touch('touchMove', t2[0] - k * 10, t2[1] - k * 8);
    await touch('touchEnd');
    const after = await exportText(), changed = after.split('\n').filter((l, i) => l !== before.split('\n')[i]);
    console.log(`editor: export changed ${changed.length} line(s): ${changed.join(' ').trim().slice(0, 60)}`);
    if (changed.length !== 1 || !/id: 'truck2', at: \[/.test(changed[0])) { failed = true; console.error('FAIL: moving a truck changed more than its at'); }
    // #247: the palette places a foe where the next tap lands, a drag moves
    // it along the ground, and holding it shades what it sees.
    await page.tap('[data-tool="FOE"]');
    await page.touchscreen.tap(300, 200);
    const n = await page.evaluate(() => window.__stompy.app.editor.E.def.foes.length);
    const placed = await page.evaluate(i => JSON.stringify(window.__stompy.app.editor.E.def.foes[i]), n - 1);
    const nf = await at(`foes.${n - 1}`);
    await touch('touchStart', nf[0], nf[1]);
    for (let k = 1; k <= 6; k++) await touch('touchMove', nf[0] + k * 15, nf[1] + k * 6);
    await touch('touchEnd');
    const moved = await page.evaluate(i => JSON.stringify(window.__stompy.app.editor.E.def.foes[i]), n - 1);
    const mf = await at(`foes.${n - 1}`);
    await touch('touchStart', mf[0], mf[1]);
    await page.waitForTimeout(700);
    const sees = await page.evaluate(() => window.__stompy.app.editor.E.sight?.cells.filter(c => c.seen).length || 0);
    await touch('touchEnd');
    console.log(`editor: placed ${placed}, moved to ${moved}, it sees ${sees} cells`);
    if (n !== 1 || !/jackal/.test(placed) || moved === placed) { failed = true; console.error('FAIL: placing and moving a foe'); }
    if (!(sees > 0)) { failed = true; console.error('FAIL: holding a foe did not shade what it sees'); }
    // #248: PLAY starts it, the pause menu's EDITOR comes back with nothing
    // lost, and so does a reload.
    const work = await page.evaluate(() => JSON.stringify(window.__stompy.app.editor.E.def));
    await page.tap('[data-act="play"]');
    await page.waitForFunction(() => window.__stompy.game.state === 'play', null, { timeout: 5000 });
    const playing = await page.evaluate(() => ({ kind: window.__stompy.game.kind, foes: window.__stompy.game.mechs.filter(m => m.team !== 0).length }));
    await page.tap('[data-t="pause"]');
    await page.tap('.mech-overlay [data-a="menu"]');
    await page.waitForFunction(() => window.__stompy.game.state === 'edit', null, { timeout: 5000 });
    const backAgain = await page.evaluate(() => JSON.stringify(window.__stompy.app.editor.E.def));
    await page.reload();
    await page.waitForSelector('.ed-panel', { timeout: 15000 });
    const reloaded = await page.evaluate(() => JSON.stringify(window.__stompy.app.editor.E.def));
    console.log(`editor: PLAY (${playing.kind}, ${playing.foes} foe), back ${backAgain === work}, reload ${reloaded === work}`);
    if (playing.kind !== 'edit' || playing.foes !== 1) { failed = true; console.error('FAIL: PLAY did not start the edited mission'); }
    if (backAgain !== work || reloaded !== work) { failed = true; console.error('FAIL: PLAY and back, or a reload, lost the working copy'); }
    await page.evaluate(() => localStorage.removeItem('stompy.edit.work'));
    await page.close();
  }
  // HUD SCALE and COLOURS (#229): 1.5 in full on a desktop and a tablet, as
  // much as fits on a phone held sideways (1 at 360 tall); a screenshot of
  // each colour mode, armour and heat hurt so the states show.
  {
    const hudAt = async (name, vp, touch, scale, colours) => {
      const page = await browser.newPage({ viewport: vp, hasTouch: touch });
      page.on('pageerror', e => errors.push(`hud ${name}: ${e.message}`));
      await page.addInitScript(([s, c]) => { localStorage.setItem('stompy.hud.scale', String(s)); localStorage.setItem('stompy.hud.colours', String(c)); }, [scale, colours]);
      await page.goto(URL_ + (touch ? '&touch=1' : ''));
      await page.waitForSelector('.mm-title', { timeout: 15000 });
      await page.evaluate(() => { document.querySelector('[data-sel="free"]').click(); document.querySelector('[data-a="go"]').click(); });
      await page.waitForFunction(() => window.__stompy.game.state === 'play', null, { timeout: 10000 });
      await page.evaluate(() => { const g = window.__stompy.game, p = g.player; p.hp.LA = p.max.LA * 0.5; p.hp.RA = p.max.RA * 0.2; p.hp.LL = 0.01; p.heat = 70; for (const m of g.mechs) if (m.team) m.ai.aware = false; g.target = g.mechs.find(m => m.team); window.__stompy.app.ui.pause(false); });
      await page.waitForTimeout(600);
      const s = await page.evaluate(() => window.__stompy.app.hud.scale());
      await page.screenshot({ path: `test-results/smoke-hud-${name}.png` });
      await page.close();
      return Math.round(s * 100) / 100;
    };
    const scales = [await hudAt('desk-15', { width: 1024, height: 640 }, false, 3, 0), await hudAt('tablet-15', { width: 1024, height: 768 }, true, 3, 0),
      await hudAt('phone-15', { width: 740, height: 360 }, true, 3, 0), await hudAt('iphone-15', { width: 896, height: 414 }, true, 3, 0)];
    for (const [i, k] of ['deutan', 'protan', 'tritan'].entries()) await hudAt(k, { width: 1024, height: 640 }, false, 1, i + 1);
    console.log(`hud: HUD SCALE 1.5 is ${scales[0]} on a desktop, ${scales[1]} on a tablet, ${scales[2]} on a 740x360 phone, ${scales[3]} on an 896x414 phone; colour modes in test-results/smoke-hud-*.png`);
    if (!(scales[0] === 1.5 && scales[1] === 1.5 && scales[2] === 1 && scales[3] > 1 && scales[3] < 1.2)) { failed = true; console.error('FAIL: HUD SCALE'); }
  }
  // Mission 1's silent tutorial (#228): the first run shows W: GO. by the
  // throttle and it fades when the throttle goes up; the pause screen's SKIP
  // TUTORIAL ends it; the next mission 1 shows nothing.
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    page.on('pageerror', e => errors.push(`tutorial: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`tutorial: console ${m.text()}`); });
    const mission1 = async () => {
      await page.goto(URL_);
      await page.waitForSelector('.mm-title', { timeout: 15000 });
      await page.click('[data-sel="campaign"]');
      await page.click('[data-a="go"]');
      await page.waitForFunction(() => window.__stompy.game.state === 'play', null, { timeout: 10000 });
      await page.evaluate(() => { const g = window.__stompy.game; for (const k in g.player.hp) g.player.hp[k] = 1e6; for (const m of g.mechs) if (m.team) { m.ai.aware = false; m.x += 2000; } });
    };
    await page.evaluate(() => localStorage.removeItem('stompy.tut.done')).catch(() => {});
    await mission1();
    const first = await page.waitForFunction(() => window.__stompy.game.tut?.cur?.id, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => null);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/smoke-tutorial.png' });
    await page.evaluate(() => window.__stompy.app.ui.pause(false));
    await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
    const next = await page.waitForFunction(() => { const c = window.__stompy.game.tut?.cur; return c && c.id !== 'go' && !c.fade ? c.id : null; }, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => null);
    await page.evaluate(() => window.__stompy.app.ui.pause(true));
    const skip = await page.$('[data-a="skiptut"]');
    if (skip) await skip.click();
    const after = await page.evaluate(() => ({ tut: !!window.__stompy.game.tut, saved: localStorage.getItem('stompy.tut.done') }));
    await mission1();
    await page.waitForTimeout(2500);
    const again = await page.evaluate(() => !!window.__stompy.game.tut);
    console.log(`tutorial: first prompt ${first}, after W ${next}; SKIP ${!!skip} -> tutorial ${after.tut ? 'still on' : 'off'}, saved ${after.saved}; second mission 1 shows it ${again}`);
    if (!(first === 'go' && next === 'legs' && skip && !after.tut && after.saved === 'true' && !again)) { failed = true; console.error('FAIL: the silent tutorial'); }
    await page.close();
  }
  // A gamepad (#227), faked in the page: the D-pad and A pick FREE PLAY, Start
  // launches; in play the touch controls step aside, the sticks drive, RT
  // fires, Start pauses and B resumes; a thumb on the glass brings the touch
  // controls back.
  {
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, hasTouch: true });
    page.on('pageerror', e => errors.push(`gamepad: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`gamepad: console ${m.text()}`); });
    await page.addInitScript(() => {
      const pad = { id: 'smoke pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.__pad = { set: (i, on) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; }, axis: (i, v) => { pad.axes[i] = v; } };
      Object.defineProperty(window.navigator, 'getGamepads', { value: () => [pad] });
    });
    await page.goto(URL_ + '&touch=1');
    await page.waitForSelector('.mm-title', { timeout: 15000 });
    const press = async i => { await page.evaluate(i => window.__pad.set(i, true), i); await page.waitForTimeout(120); await page.evaluate(i => window.__pad.set(i, false), i); await page.waitForTimeout(120); };
    const hold = async (fn, ms) => { await page.evaluate(fn); await page.waitForTimeout(ms); };
    await press(13); await press(13);   // D-pad down twice: CAMPAIGN, then FREE PLAY
    const lit = await page.evaluate(() => document.querySelector('.pad-focus')?.textContent);
    await press(0);   // A
    const picked = await page.evaluate(() => window.__stompy.app.prefs.menuSel);
    await press(9);   // Start
    await page.waitForFunction(() => window.__stompy.game.state === 'play', null, { timeout: 10000 });
    await page.evaluate(() => { const g = window.__stompy.game; for (const k in g.player.hp) g.player.hp[k] = 1e6; for (const m of g.mechs) if (m.team) m.ai.aware = false; });
    await page.waitForTimeout(400);
    const P = () => page.evaluate(() => { const g = window.__stompy.game, p = g.player; return { thr: p.throttle, twist: p.twist, yaw: p.yaw, heat: p.heat, paused: g.paused, tui: !document.querySelector('.touch-ui').hidden }; });
    const s0 = await P();
    await hold(() => window.__pad.axis(1, -1), 900);   // left stick up: throttle
    await hold(() => { window.__pad.axis(1, 0); window.__pad.axis(0, -1); window.__pad.axis(2, 1); }, 500);   // legs left, torso right
    await page.evaluate(() => { window.__pad.axis(0, 0); window.__pad.axis(2, 0); });
    const s1 = await P();
    await hold(() => window.__pad.set(7, true), 700);   // RT: the energy weapons
    await page.evaluate(() => window.__pad.set(7, false));
    const s2 = await P();
    await press(9);
    const paused = (await P()).paused;
    await press(1);
    const resumed = !(await P()).paused;
    await page.touchscreen.tap(200, 150);
    await page.waitForTimeout(200);
    const back = (await P()).tui;
    console.log(`gamepad: D-pad lit ${lit}, A picked ${picked}; touch controls hidden ${!s0.tui}; stick throttle ${s0.thr.toFixed(2)} -> ${s1.thr.toFixed(2)}, legs ${(s1.yaw - s0.yaw).toFixed(2)}, twist ${(s1.twist - s0.twist).toFixed(2)}; RT heat ${s1.heat.toFixed(0)} -> ${s2.heat.toFixed(0)}; Start paused ${paused}, B resumed ${resumed}; a tap brings touch back ${back}`);
    if (!(lit === 'FREE PLAY' && picked === 'free' && !s0.tui && s1.thr > s0.thr + 0.5 && s1.yaw - s0.yaw > 0.1 && s1.twist - s0.twist < -0.2 && s2.heat > s1.heat && paused && resumed && back)) { failed = true; console.error('FAIL: the gamepad'); }
    await page.screenshot({ path: 'test-results/smoke-gamepad.png' });
    await page.close();
  }
  // The arena: the real relay, two pilots in one browser, each sees the other walk.
  // The limit is 1 so the round's end can be tried at the end (#187).
  const relay = spawn('python3', ['server/server.py', '8096'], { stdio: 'ignore', env: { ...process.env, STOMPY_ROUND_GAP: '4', STOMPY_SCORE_LIMIT: '1' } });
  await new Promise(r => setTimeout(r, 600));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    const pages = [];
    for (const name of ['ONE', 'TWO']) {
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(`arena ${name}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`arena ${name}: console ${m.text()}`); });
      await page.goto(URL_);
      await page.waitForSelector('.mm-title', { timeout: 15000 });
      await page.click('[data-sel="mp"]');
      await page.fill('#callsign', name);
      // ONE joins in a custom fit (the two tabs share storage, so it is cleared again for TWO).
      if (name === 'ONE') await page.evaluate(() => localStorage.setItem('stompy.fit.kestrel', JSON.stringify({ hp: { la: 'mlaser', ra: 'mlaser', t1: null, t2: 'lrm' }, sys: { sinks: 2, armour: 0, jets: 1 } })));
      await page.click('[data-a="go"]');
      await page.waitForFunction(() => window.__stompy?.game?.mode === 'mp' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
      // The lobby (#185): the pilots listed, then READY drops you in.
      await page.waitForSelector('[data-a="ready"]', { timeout: 5000 });
      await page.click('[data-a="ready"]');
      await page.waitForFunction(() => !window.__stompy.game.lobby && window.__stompy.game.player.alive, null, { timeout: 5000 });
      if (name === 'ONE') await page.evaluate(() => localStorage.removeItem('stompy.fit.kestrel'));
      pages.push(page);
    }
    await pages[1].waitForFunction(() => window.__stompy.game.mechs.length === 2 && window.__stompy.game.mechs.some(m => m.remote && m.alive), null, { timeout: 8000 });
    // Opening TWO's tab blurred ONE's, and a blurred cockpit pauses: bring ONE back before driving.
    await pages[0].bringToFront();
    await pages[0].evaluate(() => { window.focus(); document.querySelector('.mech-wrap').focus(); });
    await pages[0].waitForTimeout(300);
    await pages[0].evaluate(() => window.__stompy.app.ui.pause(false));
    await pages[0].keyboard.down('KeyW'); await pages[0].waitForTimeout(1800);
    // Read ONE's relayed speed while the key is still down (the old duplicate `sp` key made this 0).
    const own = await pages[0].evaluate(() => ({ speed: window.__stompy.game.player.speed, paused: window.__stompy.game.paused }));
    const seen = await pages[1].evaluate(() => { const r = window.__stompy.game.mechs.find(m => m.remote); return { speed: r.speed, raw: r.net?.sp, net: !!r.net, players: window.__stompy.app.net.Net.info.size }; });
    await pages[0].keyboard.up('KeyW');
    console.log(`arena: ONE at ${own.speed.toFixed(1)} m/s (paused=${own.paused}); TWO sees ONE at ${seen.speed.toFixed(1)} m/s (raw sp ${seen.raw}), ${seen.players} pilots on the board`);
    if (!(seen.players === 2 && seen.net && seen.speed > 1)) { failed = true; console.error('FAIL: the arena did not relay the second pilot moving'); }
    await pages[0].keyboard.down('Digit1'); await pages[0].waitForTimeout(700); await pages[0].keyboard.up('Digit1');
    await pages[1].waitForTimeout(500);
    // ONE punches the air; TWO's copy of ONE should wind up within a state report or two.
    await pages[0].keyboard.press('KeyE');
    const swung = await pages[1].waitForFunction(() => { const r = window.__stompy.game.mechs.find(m => m.remote); return r?.melee ? r.melee.phase : null; }, null, { timeout: 2000 }).then(h => h.jsonValue()).catch(() => null);
    console.log(`arena: TWO sees ONE's swing as ${swung}`);
    if (!swung) { failed = true; console.error('FAIL: the arena did not relay the punch'); }
    const fit = await pages[1].waitForFunction(() => { const r = window.__stompy.game.mechs.find(m => m.remote); const t = r?.weapons.map(w => w.type).join(','); return t === 'mlaser,mlaser,lrm,fusion' ? t : null; }, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(() => null);
    const twoKit = await pages[1].evaluate(() => window.__stompy.game.player.weapons.map(w => w.type).join(','));
    console.log(`arena: TWO sees ONE fitted as ${fit}; TWO itself carries ${twoKit}`);
    if (!fit || twoKit !== 'laser,laser,ac,lrm,fusion') { failed = true; console.error('FAIL: the arena did not carry the mechlab loadout'); }
    // The ground dug (spec 18 § Sync, #283): ONE and TWO each dig where they
    // stand; the relay numbers the digs and echoes them; a pilot who joins
    // after (THREE) replays the room's list. All three hold the same ground.
    for (const [i, off] of [[0, 30], [1, -25]]) {
      await pages[i].evaluate(async off => {
        const { dig } = await import('/src/sim/dig.js');
        const G = window.__stompy.game, P = G.player;
        dig(G, [P.x, G.ter.height(P.x, P.z + off), P.z + off], 6);
        dig(G, [P.x + 8, G.ter.height(P.x + 8, P.z + off), P.z + off], 4);
      }, off);
    }
    await pages[0].waitForTimeout(800);
    const late = await ctx.newPage();
    late.on('pageerror', e => errors.push(`arena THREE: ${e.message}`));
    await late.goto(URL_);
    await late.waitForSelector('.mm-title', { timeout: 15000 });
    await late.click('[data-sel="mp"]');
    await late.fill('#callsign', 'THREE');
    await late.click('[data-a="go"]');
    await late.waitForFunction(() => window.__stompy?.game?.mode === 'mp' && window.__stompy.game.state === 'play', null, { timeout: 10000 });
    const hashes = await Promise.all([...pages, late].map(p => p.evaluate(() => ({ h: window.__stompy.game.ter.hash(), seq: window.__stompy.game.digSeq }))));
    console.log(`digs: ONE, TWO and THREE (joined after) hold ground ${hashes.map(x => `${x.h} (dig ${x.seq})`).join(', ')}`);
    if (!(hashes.every(x => x.h === hashes[0].h && x.seq === 4))) { failed = true; console.error('FAIL: the ground differs between pilots after digging'); }
    await late.close();
    // A fall in the fight (#284): the same ball of rock on a stem on both
    // maps; ONE blows out the stem; both work out the same fall from the
    // relay's order and end with the same ground.
    const mush = G => { const h = G.ter.height(40, -40); for (const t of [G.ter, G.terC].filter(Boolean)) { t.block(36, 44, -44, -36, h + 30); t.build([40, h + 40, -40], 14); } return h; };   // on the start's flat ground, the same on every map
    for (const p of pages) await p.evaluate(src => { const G = window.__stompy.game; window.__mushH = new Function('G', `return (${src})(G)`)(G); }, mush.toString());
    await pages[0].evaluate(async () => { const { dig } = await import('/src/sim/dig.js'); const G = window.__stompy.game; dig(G, [40, window.__mushH + 8, -40], 7); });
    await pages[0].waitForTimeout(2500);
    const fell = await Promise.all(pages.map(p => p.evaluate(() => { const G = window.__stompy.game; return { h: G.ter.hash(), gone: !G.ter.solid(40, window.__mushH + 44, -40), heap: G.ter.solid(40, window.__mushH + 28, -40) }; })));   // the grid, not the drawing: a background tab's fall may still be in the air
    console.log(`falls: after ONE cut the stem, ${fell.map((x, i) => `${['ONE', 'TWO'][i]} ${x.h} (ball gone from up there ${x.gone}, heap below ${x.heap})`).join(', ')}`);
    if (!(fell[0].h === fell[1].h && fell.every(x => x.gone && x.heap))) { failed = true; console.error('FAIL: a fall left the pilots with different ground'); }
    await pages[1].waitForTimeout(500);
    await pages[0].screenshot({ path: 'test-results/smoke-arena.png' });
    // The round's end (#187): TWO reports going down to ONE, which reaches the
    // limit. Both get the summary; both vote SAME MAP; the next round is on
    // the same map, and the summary closes.
    const seed0 = await pages[0].evaluate(() => window.__stompy.game.ter.seed);
    const oneId = await pages[0].evaluate(() => window.__stompy.app.net.Net.id);
    await pages[1].evaluate(id => window.__stompy.app.net.send({ t: 'died', by: id }), oneId);
    for (const p of pages) await p.waitForSelector('[data-a="vote"][data-v="1"]', { timeout: 3000 });
    for (const p of pages) await p.click('[data-a="vote"][data-v="1"]');
    const counted = await pages[0].waitForFunction(() => document.querySelector('[data-v="1"] .n')?.textContent.includes('2'), null, { timeout: 3000 }).then(() => true).catch(() => false);
    await pages[0].screenshot({ path: 'test-results/smoke-vote.png' });
    await pages[0].waitForFunction(() => !window.__stompy.game.summary && !window.__stompy.game.roundOver, null, { timeout: 8000 });
    const after = await pages[0].evaluate(() => ({ seed: window.__stompy.game.ter.seed, alive: window.__stompy.game.player.alive, shown: !document.querySelector('.mech-overlay').hidden }));
    console.log(`vote: both voted SAME MAP (counted ${counted}); seed ${seed0} then ${after.seed}, alive ${after.alive}, overlay ${after.shown ? 'still up' : 'closed'}`);
    if (!(counted && after.seed === seed0 && after.alive && !after.shown)) { failed = true; console.error('FAIL: the round-end vote'); }
    await pages[1].keyboard.press('F2');
    await pages[1].waitForFunction(() => window.__stompy.game.state === 'menu', null, { timeout: 5000 });
    await ctx.close();
  } finally { relay.kill(); }
  // Team deathmatch (#186): a relay in tdm; ONE starts on STEEL, TWO on RED and
  // taps STEEL in the lobby before READY. Both wear STEEL's colour, see each
  // other as a teammate (nothing to target), and spawn on STEEL's half.
  await new Promise(r => setTimeout(r, 300));
  const tdmRelay = spawn('python3', ['server/server.py', '--port', '8096', '--mode', 'tdm'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    const pages = [];
    for (const name of ['ONE', 'TWO']) {
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(`tdm ${name}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`tdm ${name}: console ${m.text()}`); });
      await page.goto(URL_);
      await page.waitForSelector('.mm-title', { timeout: 15000 });
      await page.click('[data-sel="mp"]');
      await page.fill('#callsign', name);
      await page.click('[data-a="go"]');
      await page.waitForSelector('[data-a="team"]', { timeout: 10000 });
      if (name === 'TWO') {
        const start = await page.evaluate(() => window.__stompy.app.net.myTeam());
        await page.click('[data-a="team"][data-team="0"]');
        await page.waitForFunction(() => window.__stompy.app.net.myTeam() === 0 && document.querySelector('[data-team="0"]').classList.contains('on'), null, { timeout: 3000 });
        console.log(`tdm: TWO started on team ${start}, picked STEEL in the lobby`);
        if (start !== 1) { failed = true; console.error('FAIL: the second pilot did not start on RED'); }
      }
      await page.click('[data-a="ready"]');
      await page.waitForFunction(() => !window.__stompy.game.lobby && window.__stompy.game.player.alive, null, { timeout: 5000 });
      pages.push(page);
    }
    // Each must have the other's mech before we look (TWO joined last, so ONE's first state may still be on its way).
    for (const p of pages) await p.waitForFunction(() => window.__stompy.game.mechs.some(m => m.remote && m.netId), null, { timeout: 8000 });
    const look = await Promise.all(pages.map(p => p.evaluate(() => {
      const G = window.__stompy.game, net = window.__stompy.app.net, r = G.mechs.find(m => m.remote);
      return { z: G.player.z, mine: G.player.partsKey, theirs: r?.partsKey, mate: !!r?.mate, team: r?.team, colors: [...net.Net.info.values()].map(p => p.color).join(',') };
    })));
    console.log(`tdm: ${look.map((l, i) => `${['ONE', 'TWO'][i]} at z ${l.z.toFixed(0)} wears ${l.mine}, sees a teammate ${l.mate} (team ${l.team}), colours ${l.colors}`).join('; ')}`);
    if (!look.every(l => l.z < 0 && l.mate && l.team === 0 && l.colors === '0,0' && l.mine.endsWith(':0'))) { failed = true; console.error('FAIL: team deathmatch sides, colours or spawns'); }
    await pages[0].screenshot({ path: 'test-results/smoke-tdm.png' });
    // Reconnect (#189): TWO goes down once (a death on the board), then its
    // socket drops: RECONNECTING, and back in place with the same id and death.
    // Then 10 s with no network: the tries run out, the menu says so, and
    // JOIN brings the same pilot back.
    const two = pages[1], twoNet = () => two.evaluate(() => { const n = window.__stompy.app.net, G = window.__stompy.game; return { id: n.Net.id, deaths: n.Net.info.get(n.Net.id)?.deaths, mode: G.mode, lobby: !!G.lobby, back: !G.reconnecting && G.mode === 'mp' && n.Net.ws?.readyState === 1 }; });
    await two.evaluate(() => window.__stompy.app.net.send({ t: 'died', by: 0 }));
    await two.waitForFunction(() => { const n = window.__stompy.app.net; return n.Net.info.get(n.Net.id)?.deaths === 1; }, null, { timeout: 3000 });
    const before = await twoNet();
    await two.evaluate(() => window.__stompy.app.net.Net.ws.close());
    const said = await two.waitForFunction(() => window.__stompy.game.reconnecting, null, { timeout: 2000 }).then(() => true).catch(() => false);
    await two.waitForFunction(() => !window.__stompy.game.reconnecting && window.__stompy.app.net.Net.ws?.readyState === 1, null, { timeout: 8000 }).catch(() => {});
    const quick = await twoNet();
    console.log(`reconnect: dropped (RECONNECTING ${said}), back as ${quick.id} (was ${before.id}) with ${quick.deaths} death, in place ${quick.back && !quick.lobby}`);
    if (!(said && quick.back && !quick.lobby && quick.id === before.id && quick.deaths === 1)) { failed = true; console.error('FAIL: a dropped socket did not come back in place'); }
    const t0 = Date.now();
    await two.evaluate(() => {   // no network for 10 s: every new socket fails
      const Real = window.WebSocket, until = Date.now() + 10000;
      window.WebSocket = function (url) { if (Date.now() < until) throw new Error('offline'); return new Real(url); };
      window.__stompy.app.net.Net.ws.close();
    });
    await two.waitForFunction(() => window.__stompy.game.state === 'menu' && /CONNECTION LOST/.test(document.querySelector('.status')?.textContent || ''), null, { timeout: 12000 });
    const gaveUp = (Date.now() - t0) / 1000;
    await two.waitForTimeout(Math.max(0, 10500 - (Date.now() - t0)));
    await two.click('[data-a="go"]');
    await two.waitForFunction(() => window.__stompy.game.mode === 'mp' && window.__stompy.game.state === 'play' && window.__stompy.app.net.Net.ws?.readyState === 1, null, { timeout: 8000 }).catch(() => {});
    const later = await twoNet();
    console.log(`reconnect: 10 s offline, gave up after ${gaveUp.toFixed(1)} s; JOIN at ${((Date.now() - t0) / 1000).toFixed(1)} s back as ${later.id} with ${later.deaths} death, straight in ${!later.lobby}`);
    if (!(later.mode === 'mp' && !later.lobby && later.id === before.id && later.deaths === 1)) { failed = true; console.error('FAIL: JOIN after a 10 s drop did not bring the score back'); }
    await ctx.close();
  } finally { tdmRelay.kill(); }
  // Co-op (#205, acceptance 1 of spec 09): ONE hosts mission 2 (three relays to
  // knock down) and TWO joins by the room code. The host's READY starts it on
  // both screens: the same enemies (the host's; TWO draws them), each other
  // as teammates. TWO's hit on a relay lands on the host's; the relays down,
  // both get the debrief and both saves move on.
  await new Promise(r => setTimeout(r, 300));
  const coopRelay = spawn('python3', ['server/server.py', '--port', '8096'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    await ctx.addInitScript(() => { if (!window.sessionStorage.getItem('seeded')) { localStorage.setItem('stompy.camp.mission', '1'); window.sessionStorage.setItem('seeded', '1'); } });
    const pages = [];
    for (const name of ['ONE', 'TWO']) {
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(`coop ${name}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`coop ${name}: console ${m.text()}`); });
      await page.goto(URL_);
      await page.waitForSelector('.mm-title', { timeout: 15000 });
      await page.click('[data-sel="mp"]');
      await page.click('[data-mpk="coop"]');
      await page.fill('#callsign', name);
      pages.push(page);
    }
    const [one, two] = pages;
    await one.click('[data-cj="0"]');
    await one.click('[data-a="go"]');
    await one.waitForSelector('.lobby-head', { timeout: 5000 });
    const code = await one.evaluate(() => window.__stompy.app.net.Net.room);
    await two.click('[data-cj="1"]');
    await two.fill('#room', code.toLowerCase());
    await two.click('[data-a="go"]');
    await two.waitForSelector('.lobby-head', { timeout: 5000 });
    await two.click('[data-a="ready"]');
    const waiting = await two.waitForFunction(() => /WAITING FOR HOST/.test(document.querySelector('.lobby-note')?.textContent || ''), null, { timeout: 3000 }).then(() => true).catch(() => false);
    await one.click('[data-a="ready"]');
    for (const p of pages) await p.waitForFunction(() => window.__stompy.game.state === 'play' && window.__stompy.game.mode === 'coop', null, { timeout: 8000 });
    await two.waitForFunction(() => window.__stompy.game.mechs.some(m => m.eid && m.net), null, { timeout: 5000 });
    const look = await Promise.all(pages.map(p => p.evaluate(() => { const G = window.__stompy.game; return { role: G.role, foes: G.mechs.filter(m => m.eid).map(m => `${m.eid}${m.type}`).join(), mate: G.mechs.some(m => m.netId && m.remote && m.mate && m.team === 0) }; })));
    console.log(`coop: room ${code}, TWO waiting for host ${waiting}; ONE ${look[0].role} [${look[0].foes}], TWO ${look[1].role} [${look[1].foes}], teammates ${look.map(l => l.mate)}`);
    if (!(waiting && look[0].role === 'host' && look[1].role === 'guest' && look[0].foes && look[0].foes === look[1].foes && look.every(l => l.mate))) { failed = true; console.error('FAIL: co-op did not start the same mission on both screens'); }
    await two.evaluate(async () => { const { damageEntity } = await import('/src/sim/entities.js'); const G = window.__stompy.game; damageEntity(G, G.entities.find(e => e.id === 'relay1'), 15, G.player, null); });
    const landed = await one.waitForFunction(() => window.__stompy.game.entities.find(e => e.id === 'relay1').hp < 40, null, { timeout: 3000 }).then(() => true).catch(() => false);
    await two.screenshot({ path: 'test-results/smoke-coop.png' });
    await one.evaluate(async () => { const { destroyEntity } = await import('/src/sim/entities.js'); const G = window.__stompy.game; for (const e of G.entities) if (e.tags.includes('relay')) destroyEntity(G, e, G.player); });
    const ends = [];
    for (const p of pages) {   // a tab in the background doesn't run its frames: each to the front in turn
      await p.bringToFront();
      ends.push(await p.waitForFunction(() => window.__stompy.game.state === 'debrief', null, { timeout: 10000 })
        .then(() => p.evaluate(() => ({ won: window.__stompy.game.won, saved: localStorage.getItem('stompy.camp.mission'), crew: document.querySelectorAll('.coop-crew tr').length - 1 })))
        .catch(() => null));
    }
    console.log(`coop: TWO's hit on the relay landed on the host ${landed}; debriefs ${JSON.stringify(ends)}`);
    if (!(landed && ends.every(e => e && e.won && e.saved === '2' && e.crew === 2))) { failed = true; console.error('FAIL: co-op mission 2 did not end in a shared, saved win'); }
    await ctx.close();
  } finally { coopRelay.kill(); }
  // Private arenas (#216): on a phone held sideways, PRIVATE's picks leave
  // CREATE on screen. ONE opens a private team deathmatch; TWO joins by the
  // code; PUB, in the public ARENA, sees neither, and they don't see PUB.
  await new Promise(r => setTimeout(r, 300));
  const privRelay = spawn('python3', ['server/server.py', '--port', '8096'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    const open = async name => {
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(`private ${name}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`private ${name}: console ${m.text()}`); });
      await page.goto(URL_);
      await page.waitForSelector('.mm-title', { timeout: 15000 });
      await page.click('[data-sel="mp"]');
      await page.click('[data-mpk="arena"]');
      await page.fill('#callsign', name);
      return page;
    };
    const intoArena = async page => {
      await page.waitForSelector('[data-a="ready"]', { timeout: 5000 });
      await page.click('[data-a="ready"]');
      await page.waitForFunction(() => !window.__stompy.game.lobby && window.__stompy.game.player.alive, null, { timeout: 5000 });
    };
    const one = await open('ONE');
    await one.setViewportSize({ width: 740, height: 360 });
    const onScreen = async pick => {
      await one.click(`[data-ap="${pick}"]`);
      return one.evaluate(() => { const b = document.querySelector('.mm-launch').getBoundingClientRect(); return b.bottom <= window.innerHeight && b.right <= window.innerWidth ? document.querySelector('.mm-launch').textContent : null; });
    };
    const phone = [await onScreen(2), await onScreen(1)];
    await one.click('[data-am="1"]');   // FREE-FOR-ALL -> TEAM DEATHMATCH
    phone.push(await one.evaluate(() => { const b = document.querySelector('.mm-launch').getBoundingClientRect(); return b.bottom <= window.innerHeight ? document.querySelector('.arena-mode b').textContent : null; }));
    await one.screenshot({ path: 'test-results/smoke-private-phone.png' });
    await one.setViewportSize({ width: 1024, height: 640 });
    await one.click('[data-a="go"]');
    await one.waitForSelector('.lobby-code b', { timeout: 5000 });
    const code = await one.$eval('.lobby-code b', b => b.textContent);
    await one.screenshot({ path: 'test-results/smoke-private-lobby.png' });
    await one.setViewportSize({ width: 740, height: 360 });
    phone.push(await one.evaluate(() => { const b = document.querySelector('[data-a="ready"]').getBoundingClientRect(); return b.bottom <= window.innerHeight ? 'READY' : null; }));
    await one.screenshot({ path: 'test-results/smoke-private-lobby-phone.png' });
    await one.setViewportSize({ width: 1024, height: 640 });
    const pub = await open('PUB');
    await pub.click('[data-ap="0"]');
    await pub.click('[data-a="go"]');
    await intoArena(pub);
    const two = await open('TWO');
    await two.click('[data-ap="2"]');
    await two.fill('#room', code.toLowerCase());
    await two.click('[data-a="go"]');
    await intoArena(two);
    await one.bringToFront();
    await intoArena(one);
    for (const p of [one, two]) await p.waitForFunction(() => window.__stompy.game.mechs.some(m => m.remote && m.netId), null, { timeout: 8000 });
    await pub.waitForTimeout(800);
    const look = await Promise.all([one, two, pub].map(p => p.evaluate(() => { const n = window.__stompy.app.net.Net, G = window.__stompy.game; return { room: n.room, mode: n.mode, pilots: [...n.info.values()].map(p => p.name).sort().join(), remotes: G.mechs.filter(m => m.remote).length }; })));
    console.log(`private: on a phone, JOIN shows ${phone[0]} and PRIVATE ${phone[1]} on screen (mode ${phone[2]}), the lobby ${phone[3]}; ${['ONE', 'TWO', 'PUB'].map((n, i) => `${n} in ${look[i].room} (${look[i].mode}) with ${look[i].pilots}, ${look[i].remotes} other mech`).join('; ')}`);
    if (!(phone[0] === 'JOIN' && phone[1] === 'CREATE' && phone[2] === 'TEAM DEATHMATCH' && phone[3] === 'READY')) { failed = true; console.error('FAIL: the private arena picks pushed the launch button off a phone'); }
    if (!(look[0].room === code && look[1].room === code && look[0].mode === 'tdm' && look[0].pilots === 'ONE,TWO' && look[1].pilots === 'ONE,TWO' && look[0].remotes === 1 && look[1].remotes === 1
      && look[2].room === 'ARENA' && look[2].pilots === 'PUB' && look[2].remotes === 0)) { failed = true; console.error('FAIL: the private arena was not private'); }
    await ctx.close();
  } finally { privRelay.kill(); }
  // Installed and offline (#226): the built game, served on its own port. One
  // online visit caches it all; offline, the page reloads and mission 1 starts
  // with its sounds. Then a new sw.js: the menu says UPDATED · RELOAD, and a
  // tap swaps it in.
  execSync(`"${process.execPath}" scripts/build.mjs`, { stdio: 'ignore' });
  const distServer = spawn(process.execPath, ['scripts/serve.mjs', '8124', 'dist'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 400));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`pwa: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(`pwa: console ${m.text()}`); });
    await page.goto('http://localhost:8124/?debug=1');
    await page.waitForSelector('.mm-title', { timeout: 15000 });
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
    const kit = await page.evaluate(async () => {
      const m = await (await fetch('manifest.webmanifest')).json();
      const icons = await Promise.all(m.icons.map(async i => { const b = await createImageBitmap(await (await fetch(i.src)).blob()); return `${b.width}x${b.height}` === i.sizes; }));
      const cache = await caches.open((await caches.keys()).find(k => k.startsWith('stompy-')));
      return { name: m.name, display: m.display, orientation: m.orientation, icons: icons.every(Boolean), cached: (await cache.keys()).length };
    });
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('.mm-title', { timeout: 10000 });
    await page.click('[data-sel="campaign"]');
    await page.click('[data-a="go"]');
    const offline = await page.waitForFunction(() => window.__stompy.game.state === 'play', null, { timeout: 8000 }).then(() => true).catch(() => false);
    const sounds = await page.evaluate(async () => {   // every sound, offline, through the service worker
      const cache = await caches.open((await caches.keys()).find(k => k.startsWith('stompy-')));
      const urls = (await cache.keys()).map(r => r.url).filter(u => u.includes('/sounds/'));
      return (await Promise.all(urls.map(u => fetch(u).then(r => r.ok && r.headers.get('content-type') !== null, () => false)))).filter(Boolean).length;
    });
    await page.screenshot({ path: 'test-results/smoke-offline.png' });
    // The editor is its own chunk (#246): cached too, so it opens offline.
    const ed = await ctx.newPage();
    ed.on('pageerror', e => errors.push(`pwa editor: ${e.message}`));
    await ed.goto('http://localhost:8124/?edit=1&mission=m06');
    const edOffline = await ed.waitForSelector('.ed-panel', { timeout: 10000 }).then(() => true).catch(() => false);
    await ed.close();
    if (!edOffline) { failed = true; console.error('FAIL: the editor did not open offline from the built game'); }
    await ctx.setOffline(false);
    await page.keyboard.press('F2');
    await page.waitForFunction(() => window.__stompy.game.state === 'menu', null, { timeout: 5000 });
    const sw = readFileSync('dist/sw.js', 'utf8');
    writeFileSync('dist/sw.js', sw.replace(/const VERSION = '[^']*'/, "const VERSION = 'smoketest'"));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    const shown = await page.waitForSelector('.mm-update', { timeout: 10000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: 'test-results/smoke-update.png' });
    if (shown) await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.click('.mm-update')]);
    await page.waitForSelector('.mm-title', { timeout: 10000 });
    const swapped = await page.evaluate(async () => ({ keys: (await caches.keys()).join(), line: !!document.querySelector('.mm-update') }));
    writeFileSync('dist/sw.js', sw);
    console.log(`pwa: manifest ${kit.name} ${kit.display} ${kit.orientation}, icons ${kit.icons}, ${kit.cached} files cached; offline mission 1 ${offline} with ${sounds} sounds; update line ${shown}, then caches ${swapped.keys} (line ${swapped.line ? 'still up' : 'gone'})`);
    if (!(kit.name === 'STOMPY' && kit.display === 'standalone' && kit.orientation === 'landscape' && kit.icons && kit.cached > 40)) { failed = true; console.error('FAIL: the manifest, icons or cache'); }
    if (!(offline && sounds > 20)) { failed = true; console.error('FAIL: mission 1 offline'); }
    if (!(shown && swapped.keys === 'stompy-smoketest' && !swapped.line)) { failed = true; console.error('FAIL: the update did not swap in'); }
    await ctx.close();
  } finally { distServer.kill(); }
  await browser.close();
  if (errors.length) { failed = true; console.error('FAIL: page errors:\n  ' + errors.join('\n  ')); }
} catch (e) {
  failed = true; console.error('FAIL:', e.message);
} finally {
  server.kill();
}
console.log(failed ? 'smoke: FAILED' : 'smoke: OK');
process.exit(failed ? 1 : 0);
