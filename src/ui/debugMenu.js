import { esc } from '../util/dom.js';
import { store } from '../util/store.js';
import { missionDef, BASE_MISSION, FP_MIXES, FP_WEATHER, FP_TIMES, fpWeather, pickFoes } from '../data/missions.js';
import { CHASSIS, MECH_ORDER } from '../data/chassis.js';
import { RANGE_GROUNDS, RANGE_FOES, RANGE_MAX, RANGE_CREW, RANGE_BASE, rangeDef } from '../data/range.js';
import { startMatch } from '../sim/state.js';
import { fitOf } from './mechlab.js';
import { CHEATS } from '../data/debug.js';
import { STRIP } from './campaign.js';
import { missionTitle } from './debrief.js';

// The main menu's DEBUG tab (docs/specs/19-debug-menu.md), there only with
// ?debug=1 (and not with &lock, the smoke test's fresh-save menu). Four
// sections: RANGE, CHEATS, JUMP TO, TUNING; the section picked is saved.
// The menu (ui/screens.js) asks it for its page, its GO label, and gives it
// the clicks it doesn't know.
export const SECTIONS = [['range', 'RANGE'], ['cheats', 'CHEATS'], ['jump', 'JUMP TO'], ['tuning', 'TUNING']];
const SEC_KEY = 'debug.sec', SEEN_KEY = 'debug.seen', RANGE_KEY = 'debug.range', CHEATS_KEY = 'debug.cheats';
const WHICH = ['mix', ...MECH_ORDER];   // MIX is Free Play's mixed bag
const TIME_NAMES = { day: 'NORMAL', dawn: 'DAWN', night: 'NIGHT' };

export function createDebugMenu(app, ui) {
  const prefs = app.prefs, on = app.params.has('debug') && !app.params.has('lock');
  let sec = store.get(SEC_KEY, 'jump');
  if (!SECTIONS.some(([k]) => k === sec)) sec = 'jump';
  // The first debug run opens the menu on this tab; after that, the last tab, as always.
  if (on && !store.get(SEEN_KEY, false)) { prefs.menuSel = 'debug'; store.set(SEEN_KEY, true); }
  if (!on && prefs.menuSel === 'debug') prefs.menuSel = 'campaign';
  // The cheats (sim/cheats.js), saved; the FEEL panel's old INVINCIBLE switch carries over.
  app.G.cheats = on ? { god: !!store.get('debug.invincible', false), ...store.get(CHEATS_KEY, {}) } : {};
  const cheatsHTML = () => `<div class="opts">${CHEATS.map(([k, l]) => `<button class="opt${app.G.cheats[k] ? ' on' : ''}" data-dch="${k}">${l}: ${app.G.cheats[k] ? 'ON' : 'OFF'}</button>`).join('')}</div>`;

  // The range's picks, saved: indices into their lists, and how many foes.
  const rg = { ground: 1, foes: 0, n: 1, which: 0, time: 0, weather: 0, crew: 0, base: 0, ...store.get(RANGE_KEY, {}) };
  const LISTS = { ground: RANGE_GROUNDS.length, foes: RANGE_FOES.length, which: WHICH.length, time: FP_TIMES.length, weather: FP_WEATHER.length, crew: RANGE_CREW.length, base: RANGE_BASE.length };
  const pick = (k, label, value) => `<div class="mm-pick"><span>${label}</span><button data-drg="${k}" data-d="-1">◀</button><b>${value}</b><button data-drg="${k}" data-d="1">▶</button></div>`;
  function startRange() {
    const G = app.G, w = WHICH[rg.which], R = Math.random;
    const foes = w === 'mix' ? pickFoes(FP_MIXES[0], rg.n, R) : Array(rg.n).fill(w);
    const def = rangeDef({ ground: RANGE_GROUNDS[rg.ground].key, foes, mode: RANGE_FOES[rg.foes][0], weather: fpWeather(FP_WEATHER[rg.weather], 'dusk', R), time: FP_TIMES[rg.time], crew: RANGE_CREW[rg.crew], base: RANGE_BASE[rg.base][0] });
    G.diff = prefs.diff;
    startMatch(G, def, 1 + Math.floor(R() * 1e5), false, prefs.chassis, { terrainOpts: { flat: true }, loadout: fitOf(prefs.chassis) });
    G.kind = 'range';
    app.scene.uploadWorld();
    ui.launch();
  }

  const opt = (k, label) => `<button class="opt${k === sec ? ' on' : ''}" data-dsec="${k}">${label}</button>`;
  const pages = {
    range: () => `<p class="dbg-blurb">A flat field. Pick a thing to break. Pick who shows up.</p>
      <div class="fp-picks dbg-range">${pick('ground', 'GROUND', RANGE_GROUNDS[rg.ground].label)}${pick('foes', 'FOES', RANGE_FOES[rg.foes][1])}${rg.foes ? pick('n', 'HOW MANY', rg.n) + pick('which', 'WHICH', WHICH[rg.which] === 'mix' ? 'MIX' : CHASSIS[WHICH[rg.which]].name) : ''}
      ${pick('time', 'TIME', TIME_NAMES[FP_TIMES[rg.time]])}${pick('weather', 'WEATHER', FP_WEATHER[rg.weather].toUpperCase())}${pick('crew', 'CREW', RANGE_CREW[rg.crew] === 'none' ? 'JUST YOU' : `+ ${CHASSIS[RANGE_CREW[rg.crew]].name}`)}${pick('base', 'BASE', RANGE_BASE[rg.base][1])}</div>`,
    cheats: () => `<p>Single player only. The arena does not care.</p>${cheatsHTML()}`,
    tuning: () => '<p class="dim">Not built yet.</p>',
    // Any mission (all open under ?debug=1); GO plays it. The rest go on a tap.
    jump: () => `<div class="mm-pick"><span>MISSION</span><button data-dmis="-1">◀</button><b>${esc(missionTitle(prefs.mission + 1, missionDef(prefs.mission).name))}</b><button data-dmis="1">▶</button></div>
      <div class="opts"><button class="opt" data-dj="editor">EDITOR</button><button class="opt" data-dj="bench">BENCH</button><button class="opt" data-dj="tut">TUTORIAL AGAIN</button><button class="opt" data-dj="base">${esc(BASE_MISSION.name)}</button></div>`,
  };

  return {
    on,
    // The pause menu's DEBUG block in a debug run: the cheats, switched as you play.
    pauseHTML: () => (on ? `<div class="panel dbg-pause"><div class="k">DEBUG</div>${cheatsHTML()}</div>` : ''),
    // A cheat switch, in the tab or the pause menu: true if it was one.
    cheatClick(e) {
      const c = e.target.closest('[data-dch]');
      if (!on || !c) return false;
      const k = c.dataset.dch, v = (app.G.cheats[k] = !app.G.cheats[k]);
      store.set(CHEATS_KEY, app.G.cheats);
      c.classList.toggle('on', v); c.textContent = `${CHEATS.find(([x]) => x === k)[1]}: ${v ? 'ON' : 'OFF'}`;
      if (k === 'weight' && app.G.state === 'menu') ui.renderMenu();   // LAUNCH and the tonnage bar change with it
      return true;
    },
    detail: () => `<div class="mm-pick mp-kind dbg-secs">${SECTIONS.map(([k, l]) => opt(k, l)).join('')}</div>${pages[sec]()}`,
    goLabel: () => (sec === 'jump' || sec === 'range' ? 'LAUNCH' : null),
    go() { if (sec === 'jump') { ui.startMission(prefs.mission); ui.launch(); } else if (sec === 'range') startRange(); },
    again: startRange,   // the debrief's AGAIN after a range: the same picks, a fresh field
    // A click on the tab: true if it was one of ours.
    click(e) {
      const s = e.target.closest('[data-dsec]'), m = e.target.closest('[data-dmis]'), j = e.target.closest('[data-dj]')?.dataset.dj;
      if (s) { sec = s.dataset.dsec; store.set(SEC_KEY, sec); ui.renderMenu(); return true; }
      const r = e.target.closest('[data-drg]');
      if (r) {
        const k = r.dataset.drg, d = +r.dataset.d;
        rg[k] = k === 'n' ? Math.max(1, Math.min(RANGE_MAX, rg.n + d)) : (rg[k] + d + LISTS[k]) % LISTS[k];
        store.set(RANGE_KEY, rg); ui.renderMenu(); return true;
      }
      if (m) { prefs.mission = (prefs.mission + +m.dataset.dmis + STRIP) % STRIP; ui.renderMenu(); return true; }
      if (j === 'editor') { const q = new URLSearchParams(location.search); q.set('edit', '1'); q.set('debug', '1'); location.search = q.toString(); return true; }
      if (j === 'bench') { app.bench?.start(); return true; }
      if (j === 'base') { ui.startBase(); ui.launch(); return true; }   // spec 20's mission
      if (j === 'tut') { store.set('tut.done', false); ui.startMission(0); ui.launch(); return true; }
      return false;
    },
  };
}
