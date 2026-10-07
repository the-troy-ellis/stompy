// The prop sheet for a props PR (spec 07 § Props): every scenery prop in a
// row across the view at about 130 m, by day on each biome and at night on
// the volcanic map (the lava vent glows), then the same row at 400 m zoomed;
// then a map's own scattered scenery round an outpost, in play.
//   node scripts/shootProps.mjs
// Writes test-results/props-*.png. Needs playwright-core and the
// preinstalled Chromium (as the smoke test does).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

// key, radius, height: about the sizes #162 will place them at.
const ROW = [['bunker', 6, 5], ['pipe', 6, 6], ['wall', 6, 5], ['mast', 4, 30], ['crates', 4, 4], ['deadTree', 3, 12], ['vent', 9, 6], ['spire', 6, 22]];
const SHOTS = [['dusk', 'day', 130], ['ice', 'day', 130], ['volcanic', 'day', 130], ['volcanic', 'night', 130], ['dusk', 'day', 400]];

const PORT = 8126, server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT), '.'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await page.goto(`http://localhost:${PORT}/?debug=1&unlock`);
  await page.waitForSelector('.mm-title');
  await page.click('.feel-panel [data-a="toggle"]');
  for (const [pal, time, D] of SHOTS) {
    await page.evaluate(async ([pal, time, D, ROW]) => {
      const { startMatch } = await import('/src/sim/state.js');
      const { addEntity } = await import('/src/sim/entities.js');
      const G = window.__stompy.game, app = window.__stompy.app;
      startMatch(G, { name: 'Props', pal, time, weather: 'clear', foes: ['jackal'], intel: '', props: false }, 77, false, 'kestrel');
      G.kind = 'free';
      app.scene.uploadWorld(); app.ui.launch();
      for (const m of G.mechs) if (m.team) m.alive = false, m.gone = true;
      // Look the way the ground least gets in the line of sight.
      const P = G.player, eyeY = P.y + 7, clear = yaw => {
        const tx = P.x + Math.sin(yaw) * D, tz = P.z + Math.cos(yaw) * D, ty = G.ter.height(tx, tz) + 4;
        let worst = -Infinity;
        for (let t = 0.05; t < 0.95; t += 0.05) worst = Math.max(worst, G.ter.height(P.x + (tx - P.x) * t, P.z + (tz - P.z) * t) - (eyeY + (ty - eyeY) * t));
        return worst;
      };
      P.yaw = Array.from({ length: 16 }, (_, i) => i * Math.PI / 8).reduce((a, b) => clear(b) < clear(a) ? b : a);
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), gap = D > 200 ? 34 : 22;
      ROW.forEach(([mesh, radius, height], i) => {
        const s = (i - (ROW.length - 1) / 2) * gap;
        addEntity(G, { mesh, radius, height, hp: Infinity, x: P.x + fx * D + fz * s, z: P.z + fz * D - fx * s, yaw: P.yaw + Math.PI + 0.6 });
      });
      P.twist = 0; P.pitch = Math.atan2(G.ter.height(P.x + fx * D, P.z + fz * D) + 6 - (P.y + 7), D);
      G.zoom = D > 200;
    }, [pal, time, D, ROW]);
    await page.waitForTimeout(900);
    await page.evaluate(() => { document.querySelector('.mech-overlay').hidden = true; });
    await page.screenshot({ path: `test-results/props-${pal}-${time}-${D}m.png` });
  }
  // In play (#162): a Free Play map's own scenery, from 180 m off an outpost
  // looking at it, on each biome; volcanic also at night for the vents.
  for (const [pal, time] of [['dusk', 'day'], ['ice', 'day'], ['volcanic', 'day'], ['volcanic', 'night']]) {
    await page.evaluate(async ([pal, time]) => {
      const { startMatch } = await import('/src/sim/state.js');
      const { outpostSites } = await import('/src/world/props.js');
      const { initFeet } = await import('/src/sim/gait.js');
      const G = window.__stompy.game, app = window.__stompy.app;
      startMatch(G, { name: 'Props', pal, time, weather: 'clear', foes: ['jackal'], intel: '' }, 4242, false, 'kestrel');
      G.kind = 'free';
      app.scene.uploadWorld(); app.ui.launch();
      for (const m of G.mechs) if (m.team) m.alive = false, m.gone = true;
      // From whichever side of whichever outpost the ground least hides it.
      const P = G.player, H = G.ter.height, D = 180;
      const block = (ox, oz, a) => {
        const x = ox + Math.sin(a) * D, z = oz + Math.cos(a) * D, ey = H(x, z) + 7, ty = H(ox, oz) + 5;
        let worst = -Infinity;
        for (let t = 0.05; t < 0.9; t += 0.05) worst = Math.max(worst, H(x + (ox - x) * t, z + (oz - z) * t) - (ey + (ty - ey) * t));
        return worst;
      };
      let best = null;
      for (const [ox, oz] of outpostSites(G.ter.seed)) for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, b = block(ox, oz, a); if (!best || b < best.b) best = { ox, oz, a, b }; }
      const { ox, oz, a } = best;
      P.x = ox + Math.sin(a) * D; P.z = oz + Math.cos(a) * D; P.y = H(P.x, P.z); initFeet(G, P);
      P.yaw = Math.atan2(ox - P.x, oz - P.z); P.twist = 0; P.pitch = Math.atan2(H(ox, oz) + 8 - (P.y + 7), D);
      G.zoom = false;
    }, [pal, time]);
    await page.waitForTimeout(900);
    await page.evaluate(() => { document.querySelector('.mech-overlay').hidden = true; });
    await page.screenshot({ path: `test-results/props-play-${pal}-${time}.png` });
  }
  console.log('wrote test-results/props-*.png');
} finally { await browser.close(); server.kill(); }
