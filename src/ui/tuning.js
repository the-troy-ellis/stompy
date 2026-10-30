import { FEEL, FEEL_EVENTS, FEEL_COLS } from '../data/feel.js';
import { GAIT } from '../data/walk.js';
import { LOOK_KEY, LOOK_PRESETS } from '../render/look.js';
import { store } from '../util/store.js';

// The DEBUG tab's TUNING (docs/specs/19-debug-menu.md § Tuning and overlays),
// also in the pause menu's DEBUG block: four pages.
// - FEEL: the feel table (data/feel.js) as live inputs. Edit a number and the
//   next footfall or hit uses it.
// - GAIT: the gaits by class (data/walk.js GAIT, spec 16), live the same way.
//   COPY, on either page, puts both on the clipboard as JSON (or in the box
//   under it) to paste back into the data files once they feel right.
// - LOOK: the 3D view's resolution (render/look.js): how many lines tall it
//   renders, and antialiasing (which reloads the page). Saved; ?lines=240&aa=0
//   in the URL shares a setting.
// - OVERLAYS: switches, saved, drawn on the HUD (render/hud.js). DIGS AND
//   FALLS turns on sim/dig.js's log (G.digLog), which is null while it is off.
// This was the floating FEEL panel (ui/feelPanel.js) until #299.
export const TUNE_PAGES = [['feel', 'FEEL'], ['gait', 'GAIT'], ['look', 'LOOK'], ['overlays', 'OVERLAYS']];
export const OVERLAYS = [['frame', 'FRAME TIME'], ['ai', 'AI LABELS'], ['nav', 'NAV'], ['digs', 'DIGS AND FALLS']];
const PAGE_KEY = 'debug.tune', OVERLAY_KEY = 'debug.overlays';

export function createTuning(app) {
  let page = store.get(PAGE_KEY, 'feel');
  if (!TUNE_PAGES.some(([k]) => k === page)) page = 'feel';
  const ov = (app.overlays = { frame: true, ai: true, nav: false, digs: false, ...store.get(OVERLAY_KEY, {}) });
  const syncLog = () => { app.G.digLog = ov.digs ? app.G.digLog || [] : null; };
  syncLog();

  const num = (attrs, v) => `<input type="number" step="0.05" ${attrs} value="${v}">`;
  const copy = '<div class="dbg-tune-row"><button data-tune-a="copy">COPY</button> <span class="dim">FEEL and GAIT, as JSON</span></div><textarea class="dbg-tune-out" hidden></textarea>';
  const feel = () => {
    const rows = FEEL_EVENTS.map(ev => `<tr><th>${ev}</th>${FEEL_COLS.map(c => `<td>${num(`data-ev="${ev}" data-col="${c}"`, FEEL[ev][c])}</td>`).join('')}</tr>`).join('');
    const extra = ['view', 'spring', 'knock', 'inertia', 'dig', 'sound'].map(g => `<tr><th>${g}</th><td colspan="${FEEL_COLS.length}">${Object.keys(FEEL[g]).map(k => `${k} ${num(`data-ev="${g}" data-col="${k}"`, FEEL[g][k])}`).join(' ')}</td></tr>`).join('');
    return `<div class="dbg-tune-scroll"><table><tr><th></th>${FEEL_COLS.map(c => `<th>${c}</th>`).join('')}</tr>${rows}${extra}</table></div>${copy}`;
  };
  // A row per leg type; `lift` is two numbers.
  const gait = () => `<div class="dbg-tune-scroll"><table>${Object.entries(GAIT).map(([plan, row]) => `<tr><th>${plan}</th><td>${Object.entries(row).map(([k, v]) =>
    Array.isArray(v) ? `${k} ${v.map((x, i) => num(`data-gait="${plan}" data-col="${k}" data-idx="${i}"`, x)).join(' ')}` : `${k} ${num(`data-gait="${plan}" data-col="${k}"`, v)}`).join(' ')}</td></tr>`).join('')}</table></div>${copy}`;
  const look = () => {
    const L = app.R.look;
    return `<div class="dbg-tune-look">lines <input type="range" min="0" max="720" step="10" data-look="lines" value="${L.lines}">
      <input type="number" min="0" max="2160" step="10" data-look="lines" value="${L.lines}"> <span class="dbg-tune-res">${resText()}</span><br>
      ${LOOK_PRESETS.map(n => `<button data-lines="${n}">${n || 'NATIVE'}</button>`).join('')}
      <label><input type="checkbox" data-look="aa" ${L.aa ? 'checked' : ''}> antialias (reloads)</label></div>`;
  };
  const overlays = () => `<div class="opts">${OVERLAYS.map(([k, l]) => `<button class="opt${ov[k] ? ' on' : ''}" data-tov="${k}">${l}: ${ov[k] ? 'ON' : 'OFF'}</button>`).join('')}</div>`;
  const pages = { feel, gait, look, overlays };
  const resText = () => `${app.cv.width}×${app.cv.height}${app.R.look.lines ? '' : ' (native)'}`;
  const inner = () => `<div class="mm-pick mp-kind dbg-tune-pages">${TUNE_PAGES.map(([k, l]) => `<button class="opt${k === page ? ' on' : ''}" data-tune="${k}">${l}</button>`).join('')}</div>${pages[page]()}`;
  // The block, wherever it sits (the tab or the pause menu): it redraws itself in place.
  const html = () => `<div class="dbg-tune">${inner()}</div>`;
  const redraw = el => { el.closest('.dbg-tune').innerHTML = inner(); };

  const setLines = (el, n) => {
    const L = app.R.look;
    L.lines = Math.max(0, Math.round(n) || 0);
    for (const i of el.closest('.dbg-tune').querySelectorAll('[data-look="lines"]')) if (+i.value !== L.lines) i.value = L.lines;
    store.set(LOOK_KEY, L);
    requestAnimationFrame(() => requestAnimationFrame(() => { const r = document.querySelector('.dbg-tune-res'); if (r) r.textContent = resText(); }));   // after the scene resizes the canvas
  };

  return {
    html,
    // A click inside the block: true, so the pause menu doesn't take it for "click to resume".
    click(e) {
      const t = e.target;
      if (!t.closest('.dbg-tune')) return false;
      const p = t.closest('[data-tune]'), o = t.closest('[data-tov]'), a = t.closest('[data-tune-a]')?.dataset.tuneA;
      if (p) { page = p.dataset.tune; store.set(PAGE_KEY, page); redraw(t); }
      else if (o) {
        const k = o.dataset.tov, v = (ov[k] = !ov[k]);
        store.set(OVERLAY_KEY, ov); syncLog();
        o.classList.toggle('on', v); o.textContent = `${OVERLAYS.find(([x]) => x === k)[1]}: ${v ? 'ON' : 'OFF'}`;
      } else if (t.dataset.lines != null) setLines(t, +t.dataset.lines);
      else if (a === 'copy') {
        const text = JSON.stringify({ ...FEEL, GAIT }, null, 2);   // GAIT goes back into src/data/walk.js
        const out = t.closest('.dbg-tune').querySelector('.dbg-tune-out'); out.hidden = false; out.value = text;
        try { navigator.clipboard?.writeText(text); } catch { /* the box is there */ }
      }
      return true;
    },
    // An edit: it takes effect at once.
    input(e) {
      const i = e.target;
      if (!i.closest?.('.dbg-tune')) return false;
      if (i.dataset.look === 'lines') { setLines(i, parseFloat(i.value)); return true; }
      const v = parseFloat(i.value);
      if (!Number.isFinite(v)) return true;
      if (i.dataset.gait) { const row = GAIT[i.dataset.gait]; if (i.dataset.idx != null) row[i.dataset.col][+i.dataset.idx] = v; else row[i.dataset.col] = v; }
      else if (i.dataset.ev) FEEL[i.dataset.ev][i.dataset.col] = v;
      return true;
    },
    change(e) {
      if (e.target.dataset?.look !== 'aa') return false;
      app.R.look.aa = e.target.checked; store.set(LOOK_KEY, app.R.look);
      location.reload();   // the GL context's antialiasing is fixed when it is made
      return true;
    },
  };
}
