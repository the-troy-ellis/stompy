import { esc } from '../util/dom.js';
import { store } from '../util/store.js';
import { missionDef } from '../data/missions.js';
import { STRIP } from './campaign.js';
import { missionTitle } from './debrief.js';

// The main menu's DEBUG tab (docs/specs/19-debug-menu.md), there only with
// ?debug=1 (and not with &lock, the smoke test's fresh-save menu). Four
// sections: RANGE, CHEATS, JUMP TO, TUNING; the section picked is saved.
// The menu (ui/screens.js) asks it for its page, its GO label, and gives it
// the clicks it doesn't know.
export const SECTIONS = [['range', 'RANGE'], ['cheats', 'CHEATS'], ['jump', 'JUMP TO'], ['tuning', 'TUNING']];
const SEC_KEY = 'debug.sec', SEEN_KEY = 'debug.seen';

export function createDebugMenu(app, ui) {
  const prefs = app.prefs, on = app.params.has('debug') && !app.params.has('lock');
  let sec = store.get(SEC_KEY, 'jump');
  if (!SECTIONS.some(([k]) => k === sec)) sec = 'jump';
  // The first debug run opens the menu on this tab; after that, the last tab, as always.
  if (on && !store.get(SEEN_KEY, false)) { prefs.menuSel = 'debug'; store.set(SEEN_KEY, true); }
  if (!on && prefs.menuSel === 'debug') prefs.menuSel = 'campaign';

  const opt = (k, label) => `<button class="opt${k === sec ? ' on' : ''}" data-dsec="${k}">${label}</button>`;
  const pages = {
    range: () => '<p class="dim">Not built yet.</p>',
    cheats: () => '<p class="dim">Not built yet.</p>',
    tuning: () => '<p class="dim">Not built yet.</p>',
    // Any mission (all open under ?debug=1); GO plays it. The rest go on a tap.
    jump: () => `<div class="mm-pick"><span>MISSION</span><button data-dmis="-1">◀</button><b>${esc(missionTitle(prefs.mission + 1, missionDef(prefs.mission).name))}</b><button data-dmis="1">▶</button></div>
      <div class="opts"><button class="opt" data-dj="editor">EDITOR</button><button class="opt" data-dj="bench">BENCH</button><button class="opt" data-dj="tut">TUTORIAL AGAIN</button></div>`,
  };

  return {
    on,
    detail: () => `<div class="mm-pick mp-kind dbg-secs">${SECTIONS.map(([k, l]) => opt(k, l)).join('')}</div>${pages[sec]()}`,
    goLabel: () => (sec === 'jump' ? 'LAUNCH' : null),
    go() { if (sec === 'jump') { ui.startMission(prefs.mission); ui.launch(); } },
    // A click on the tab: true if it was one of ours.
    click(e) {
      const s = e.target.closest('[data-dsec]'), m = e.target.closest('[data-dmis]'), j = e.target.closest('[data-dj]')?.dataset.dj;
      if (s) { sec = s.dataset.dsec; store.set(SEC_KEY, sec); ui.renderMenu(); return true; }
      if (m) { prefs.mission = (prefs.mission + +m.dataset.dmis + STRIP) % STRIP; ui.renderMenu(); return true; }
      if (j === 'editor') { const q = new URLSearchParams(location.search); q.set('edit', '1'); q.set('debug', '1'); location.search = q.toString(); return true; }
      if (j === 'bench') { app.bench?.start(); return true; }
      if (j === 'tut') { store.set('tut.done', false); ui.startMission(0); ui.launch(); return true; }
      return false;
    },
  };
}
