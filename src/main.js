// Stompy -- a standalone 3D mech sim in the spirit of the mid-90s
// classics. Original code and art: raw WebGL, flat-shaded, no libraries.
//
// Legs and torso turn independently (A/D steer the legs, the mouse twists the
// torso), heat builds as you fire, damage is tracked per section, and a
// computer voice reads out the bad news.
//
// This file only boots the game: it builds the page, creates the state
// (src/sim), the renderer and HUD (src/render), audio (src/audio), input
// (src/input), the screens (src/ui) and the arena client (src/net), wires
// them together through one `app` object, and runs the frame loop.

import { $ } from './util/dom.js';
import { store } from './util/store.js';
import { MP_COLORS } from './data/colors.js';
import { MECH_ORDER } from './data/chassis.js';
import { createGame } from './sim/state.js';
import { update } from './sim/update.js';
import { destroy } from './sim/combat.js';
import { createRenderer } from './render/gl.js';
import { createScene } from './render/scene.js';
import { createHud } from './render/hud.js';
import { createAudio } from './audio/sound.js';
import { createInput } from './input/input.js';
import { createUi } from './ui/screens.js';
import { createNet } from './net/client.js';
import { createFeelPanel } from './ui/feelPanel.js';
import { DIFF } from './data/ai.js';
import { SETTINGS, SETTING_KEYS, readSetting } from './data/settings.js';
import { createMechlab } from './ui/mechlab.js';

// Settings and progress, from localStorage. Each screen writes back the key
// it owns (store.set) when the player changes something.
function loadPrefs() {
  return {
    sound: store.get('sound', true),
    voice: store.get('mech.voice', true),
    invert: store.get('mech.invert', false),
    mission: store.get('mech.mission', 0),
    chassis: MECH_ORDER.includes(store.get('mech.chassis')) ? store.get('mech.chassis') : 'kestrel',
    menuSel: store.get('menu.sel', 'campaign'),
    fpMap: store.get('fp.map', 0), fpFoes: store.get('fp.foes', 3), fpMix: store.get('fp.mix', 0),
    diff: DIFF[store.get('diff')] ? store.get('diff') : 'normal',
    frameTime: store.get('debug.frametime', false),
    ...Object.fromEntries(SETTING_KEYS.map(k => [k, readSetting(k, store.get(SETTINGS[k].key))])),
    mpName: store.get('mp.name', ''), mpColor: store.get('mp.color', Math.floor(Math.random() * MP_COLORS.length)),
    reducedMotion: store.get('motion.reduced', false), haptics: store.get('haptics', true),
  };
}

function start(root) {
  root.innerHTML = `
    <div class="mech-wrap" tabindex="-1">
      <canvas class="mech-gl"></canvas><canvas class="mech-hud"></canvas>
      <div class="touch-ui" hidden>
        <div class="stick" hidden><div class="knob"></div></div>
        <button class="tbtn tpause" data-t="pause" aria-label="Pause">II</button>
        <button class="tbtn tzoom" data-t="zoom">ZOOM</button>
        <button class="tbtn tstop" data-t="stop">STOP</button>
        <div class="tcluster">
          <button class="tbtn" data-t="jump">JUMP</button>
          <button class="tbtn" data-t="tgt">TGT</button>
          <button class="tbtn tfire t-fusion" data-t="fusion">FUSION</button>
          <button class="tbtn tfire t-missile" data-t="missile">MISSILE</button>
          <button class="tbtn tfire t-energy" data-t="energy">ENERGY</button>
          <button class="tbtn tfire t-ballistic" data-t="ballistic">BALLISTIC</button>
          <button class="tbtn tfire t-punch" data-t="punch">PUNCH</button>
        </div>
      </div>
      <div class="mech-overlay"></div>
    </div>`;
  const wrap = $('.mech-wrap', root), cv = $('.mech-gl', root), hud = $('.mech-hud', root), ov = $('.mech-overlay', root);
  const R = createRenderer(cv);
  if (!R) {
    ov.innerHTML = '<div class="panel">Stompy needs WebGL, which this browser has turned off or does not support.</div>';
    return;
  }
  const params = new URLSearchParams(location.search);
  const prefs = loadPrefs();
  // Everything the page-side modules share. The sim only ever sees `G`.
  const app = { root, wrap, cv, hud, ov, ctx: hud.getContext('2d'), R, prefs, params };
  app.G = createGame({ touchUI: params.has('touch') || matchMedia('(pointer: coarse)').matches });
  const G = app.G;
  G.reducedMotion = prefs.reducedMotion;   // the sim reads a flag, never the prefs
  app.audio = createAudio(app);
  app.scene = createScene(app);
  app.hud = createHud(app);
  app.input = createInput(app);
  app.net = createNet(app);
  app.mechlab = createMechlab(app);
  app.ui = createUi(app);
  // The sim's effects sink: voice, sounds, the scan tone and arena messages.
  G.fx = { say: app.audio.say, sfx: app.audio.sfx, fusionSound: app.audio.fusionSound, netSend: app.net.send, thump: app.audio.thump };
  G.hooks.debrief = app.ui.debrief;
  G.hooks.arenaDeath = () => app.net.sendState();
  // ?debug=1 exposes the state for the smoke test and for poking at in the console.
  if (params.has('debug')) { window.__stompy = { game: G, app, kill: m => destroy(G, m, G.player) }; createFeelPanel(app); }

  const quiet = () => { for (const k of Object.keys(app.audio.loops)) app.audio.loopSet(k, 0); app.audio.beamSound(false, 1); app.audio.fusionSound(false, 0); };
  let last = 0, lastAudioCheck = 0;
  const loop = ts => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    if (document.hidden) { quiet(); return; }
    if (ts - lastAudioCheck > 1000) {
      lastAudioCheck = ts;
      const c = app.audio.Sound.ctx;
      if (c && prefs.sound && c.state !== 'running' && c.state !== 'closed') { try { c.resume()?.catch?.(() => {}); } catch { /* next tap */ } }
    }
    if (G.state === 'play' && !document.hasFocus() && !G.paused) app.ui.pause(true);
    G.clock = performance.now();
    if (G.state === 'menu') app.ui.menuTick(dt);
    if ((G.state === 'play' && (!G.paused || app.net.mp())) || G.state === 'over') {
      update(G, app.input.snapshot(), dt);
      app.net.tick(dt);
      app.audio.tick();
    } else quiet();
    app.scene.render();
    app.hud.draw();
  };

  app.ui.mainMenu();
  requestAnimationFrame(loop);
  setTimeout(() => wrap.focus(), 0);
}

document.addEventListener('DOMContentLoaded', () => start(document.getElementById('app')));
