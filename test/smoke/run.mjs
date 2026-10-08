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
    // FIT: cycle the left arm, see the preview mech change, go overweight, reset, back.
    await page.click('.feel-panel [data-a="toggle"]');   // fold the ?debug FEEL panel out of the way
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
  await run('touch', URL_ + '&touch=1', async page => {
    // Taps, not clicks: a mouse click would switch the game back to mouse mode.
    await page.tap('.feel-panel [data-a="toggle"]');   // fold the ?debug FEEL panel out of the way, as on desktop
    await page.tap('[data-sel="free"]');
    await page.tap('[data-a="go"]');
    await page.waitForFunction(() => window.__stompy?.game?.state === 'play', null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const ok = await page.evaluate(() => !document.querySelector('.touch-ui').hidden && window.__stompy.game.touchUI === true);
    console.log(`touch: cluster visible ${ok}`);
    if (!ok) { failed = true; console.error('FAIL: touch UI not shown'); }
    // The left side flies the mech, the right side only shoots (input.js).
    // Real touches through CDP: upper left aims (turns the legs, tilts),
    // lower left is the throttle stick (sideways twists the torso), a double
    // tap on the aim side centres the torso, a drag off the buttons on the
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
    await drag(200, 160, 120, 120);
    await page.waitForTimeout(900);
    let a1 = await P();
    const aimOk = a1.yaw - a0.yaw > 0.1 && Math.abs(a1.twist - a0.twist) < 0.05 && a1.pitch !== a0.pitch;
    a0 = a1;
    await drag(200, 480, 160, 420, 500);
    a1 = await P();
    const stickOk = a1.thr > a0.thr + 0.3 && a1.twist - a0.twist > 0.2 && Math.abs(a1.yaw - a0.yaw) < 0.05;
    a0 = a1;
    await drag(760, 200, 640, 140);
    await page.waitForTimeout(300);
    a1 = await P();
    const rightOk = Math.abs(a1.yaw - a0.yaw) < 0.01 && Math.abs(a1.twist - a0.twist) < 0.01 && a1.pitch === a0.pitch;
    await page.evaluate(() => { window.__stompy.game.player.twist = 1.2; });
    // The double tap as one burst: the four events queued at once. Awaited one
    // by one, each dispatch waits for a software-rendered frame, and the two
    // taps landed 220-335 ms apart, past the 300 ms window about one run in ten.
    await Promise.all([touch('touchStart', 200, 150), touch('touchEnd'), touch('touchStart', 200, 150), touch('touchEnd')]);
    await page.waitForTimeout(800);
    const centred = Math.abs((await P()).twist) < 0.1;
    console.log(`touch: aim turns the legs ${aimOk}, stick sets throttle and twists ${stickOk}, right side only buttons ${rightOk}, double tap centres ${centred}`);
    if (!(aimOk && stickOk && rightOk && centred)) { failed = true; console.error('FAIL: the touch layout did not behave'); }
  });
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
      await page.click('.feel-panel [data-a="toggle"]');   // fold the ?debug FEEL panel out of the way
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
      await page.click('.feel-panel [data-a="toggle"]');
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
      await page.click('.feel-panel [data-a="toggle"]');
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
      await page.click('.feel-panel [data-a="toggle"]');
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
    await page.click('.feel-panel [data-a="toggle"]');
    await page.click('[data-sel="campaign"]');
    await page.click('[data-a="go"]');
    const offline = await page.waitForFunction(() => window.__stompy.game.state === 'play', null, { timeout: 8000 }).then(() => true).catch(() => false);
    const sounds = await page.evaluate(async () => {   // every sound, offline, through the service worker
      const cache = await caches.open((await caches.keys()).find(k => k.startsWith('stompy-')));
      const urls = (await cache.keys()).map(r => r.url).filter(u => u.includes('/sounds/'));
      return (await Promise.all(urls.map(u => fetch(u).then(r => r.ok && r.headers.get('content-type') !== null, () => false)))).filter(Boolean).length;
    });
    await page.screenshot({ path: 'test-results/smoke-offline.png' });
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
