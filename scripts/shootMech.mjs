// Screenshots for a chassis PR's NAMING section: the menu at desktop and
// phone size, and the mech in the field at 25 m, 120 m and 400 m from the
// cockpit; for a fisted chassis, also mid-punch on you.
//   node scripts/shootMech.mjs <chassis key>
// Writes test-results/mech-<key>-*.png. Needs playwright-core and the
// preinstalled Chromium (as the smoke test does).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const [key = 'kestrel'] = process.argv.slice(2);
const PORT = 8125, server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT), '.'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const out = name => `test-results/mech-${key}-${name}.png`;
try {
  // The menu, with this chassis selected, at desktop and phone-sideways size.
  for (const [name, vp] of [['menu', { width: 1024, height: 640 }], ['menu-phone', { width: 740, height: 360 }]]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(k => localStorage.setItem('stompy.mech.chassis', JSON.stringify(k)), key);
    await page.reload();
    await page.waitForSelector('.mm-title');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: out(name) });
    await page.close();
  }
  // In the field, from a KESTREL's cockpit.
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await page.goto(`http://localhost:${PORT}/?debug=1`);
  await page.waitForSelector('.mm-title');
  await page.evaluate(() => localStorage.setItem('stompy.mech.chassis', JSON.stringify('kestrel')));
  await page.reload();
  await page.waitForSelector('.mm-title');
  await page.click('.feel-panel [data-a="toggle"]');
  await page.click('[data-sel="free"]');
  await page.click('[data-a="go"]');
  await page.waitForFunction(() => window.__stompy?.game?.state === 'play');
  await page.evaluate(async k => {
    const { newMech } = await import('/src/sim/state.js');
    const G = window.__stompy.game, P = G.player;
    for (const m of G.mechs) if (m.team) m.alive = false, m.gone = true;
    const e = newMech(G, k, 1, P.x, P.z + 25, P.yaw + Math.PI);
    e.ai.aware = false; e.weapons = e.weapons.filter(w => w.def.kind === 'fusion');   // it stands there and lets you look
    G.mechs.push(e); window.__subject = e;
  }, key);
  for (const d of [25, 120, 400]) {
    await page.evaluate(async D => {
      const { initFeet } = await import('/src/sim/gait.js');
      const G = window.__stompy.game, P = G.player, e = window.__subject;
      Object.assign(e, { x: P.x + Math.sin(P.yaw) * D, z: P.z + Math.cos(P.yaw) * D, yaw: P.yaw + Math.PI + 0.5, throttle: 0, speed: 0 });
      e.y = G.ter.height(e.x, e.z); initFeet(G, e);
      P.twist = 0; P.pitch = Math.atan2(e.y + 4.5 * e.ch.scale - (P.y + 7), D);
      G.zoom = D > 100;
    }, d);
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.querySelector('.mech-overlay').hidden = true; });
    await page.screenshot({ path: out(`${d}m`) });
  }
  // Fists: it walks up and punches you; frozen at the wind-up and just after the hit.
  const fists = await page.evaluate(async () => (await import('/src/data/melee.js')).meleeOf(window.__subject).fists);
  if (fists) {
    await page.evaluate(async () => {
      const { meleePress } = await import('/src/sim/melee.js');
      const { initFeet } = await import('/src/sim/gait.js');
      const { viewYaw } = await import('/src/sim/geom.js');
      const G = window.__stompy.game, P = G.player, e = window.__subject;
      G.zoom = false;
      Object.assign(e, { x: P.x + Math.sin(viewYaw(P)) * 16, z: P.z + Math.cos(viewYaw(P)) * 16, yaw: viewYaw(P) + Math.PI, twist: 0 });
      e.y = G.ter.height(e.x, e.z); initFeet(G, e); P.pitch = 0.08;
      meleePress(G, e);
    });
    await page.waitForTimeout(380);
    await page.evaluate(() => { window.__stompy.app.ui.pause(true); document.querySelector('.mech-overlay').hidden = true; });
    await page.screenshot({ path: out('windup') });
    await page.evaluate(() => window.__stompy.app.ui.pause(false));
    await page.waitForTimeout(160);
    await page.evaluate(() => { window.__stompy.app.ui.pause(true); document.querySelector('.mech-overlay').hidden = true; });
    await page.screenshot({ path: out('punch') });
  }
  console.log(`wrote test-results/mech-${key}-*.png`);
} finally { await browser.close(); server.kill(); }
