// Screenshots for a PR's NAMING section: a weapon in the air and on a target.
//   node scripts/shoot.mjs <weapon key> [hardpoint id] [chassis]
// Writes test-results/shot-<key>-*.png. Needs playwright-core and the
// preinstalled Chromium (as the smoke test does).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const [key = 'ppc', hp = 'la', chassis = 'kestrel'] = process.argv.slice(2);
const PORT = 8124, server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT), '.'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await page.goto(`http://localhost:${PORT}/?debug=1`);
  await page.waitForSelector('.mm-title');
  // SHOOT_SOLO=1 empties the other hardpoints, so nothing else draws over it.
  await page.evaluate(([c, h, k, solo]) => {
    localStorage.setItem('stompy.mech.chassis', JSON.stringify(c));
    const cur = JSON.parse(localStorage.getItem('stompy.fit.' + c) || 'null') || {};
    const others = solo ? Object.fromEntries(['la', 'ra', 't1', 't2'].map(id => [id, null])) : cur.hp || {};
    localStorage.setItem('stompy.fit.' + c, JSON.stringify({ hp: { ...others, [h]: k }, sys: cur.sys || {} }));
  }, [chassis, hp, key, !!process.env.SHOOT_SOLO]);
  await page.reload();
  await page.waitForSelector('.mm-title');
  await page.click('.feel-panel [data-a="toggle"]');
  await page.click('[data-sel="free"]');
  await page.click('[data-a="go"]');
  await page.waitForFunction(() => window.__stompy?.game?.state === 'play');
  // One frozen enemy SHOOT_DIST (default 120) m ahead, the crosshair on it.
  await page.evaluate(D => {
    const G = window.__stompy.game, P = G.player, e = G.mechs.find(m => m.team);
    for (const m of G.mechs) if (m.team && m !== e) m.alive = false, m.gone = true;
    Object.assign(e, { x: P.x + Math.sin(P.yaw) * D, z: P.z + Math.cos(P.yaw) * D, yaw: P.yaw + Math.PI, shutdown: true, heat: 1000 });
    e.y = G.ter.height(e.x, e.z); e.ai.aware = false;
    P.twist = 0; P.pitch = Math.atan2(e.y + 4.2 * e.ch.scale - (P.y + 7), D);   // the crosshair on its middle
    P.weapons.forEach(w => { w.cd = 0; });
  }, +(process.env.SHOOT_DIST || 120));
  await page.waitForTimeout(400);
  const cat = await page.evaluate(k => ({ ppc: 'Digit1', plaser: 'Digit1', flamer: 'Digit1', gauss: 'Digit2', mg: 'Digit2', srm: 'Space' })[k] || 'Digit1', key);
  // Freeze time just after the shot so the round is in the air for the picture.
  const beam = await page.evaluate(async k => (await import('/src/data/weapons.js')).WEAPONS[k].kind === 'beam', key);
  await page.keyboard.down(cat);
  await page.waitForTimeout(beam ? 1500 : +(process.env.SHOOT_WAIT || 60));   // a beam is held until the armour glows; SHOOT_WAIT catches a fast shell mid-flight
  await page.evaluate(() => window.__stompy.app.ui.pause(true));
  await page.evaluate(() => { document.querySelector('.mech-overlay').hidden = true; });
  await page.screenshot({ path: `test-results/shot-${key}-fire.png` });
  await page.keyboard.up(cat);
  await page.evaluate(() => window.__stompy.app.ui.pause(false));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/shot-${key}-hit.png` });
  // And from the other end: the enemy fires one at you.
  await page.evaluate(async k => {
    const { fire } = await import('/src/sim/combat.js');
    const { applyLoadout } = await import('/src/sim/loadout.js');
    const { center } = await import('/src/sim/geom.js');
    const { CHASSIS } = await import('/src/data/chassis.js');
    const { CAT_OF } = await import('/src/data/weapons.js');
    const G = window.__stompy.game, P = G.player, e = G.mechs.find(m => m.team && m.alive);
    const h = CHASSIS[e.type].hardpoints.find(x => x.cat === CAT_OF[k]);
    if (!h) return;   // this enemy has nowhere to carry it
    applyLoadout(G, e, { hp: { ...e.loadout.hp, [h.id]: k }, sys: e.loadout.sys });
    e.shutdown = false; e.heat = 0;
    const w = e.weapons.find(x => x.type === k); w.cd = 0;
    if (fire(G, e, w, center(P), P)) return;
    // A beam: hold it on you for a moment (the AI would wait for its own reasons).
    const { beamTick } = await import('/src/sim/beams.js');
    const t0 = performance.now();
    const hold = () => { if (performance.now() - t0 < 400) { beamTick(G, e, 1 / 60, center(P)); window.requestAnimationFrame(hold); } };
    hold();
  }, key);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/shot-${key}-incoming.png` });
  console.log(`wrote test-results/shot-${key}-fire.png, -hit.png, -incoming.png`);
} finally { await browser.close(); server.kill(); }
