import { FEEL, FEEL_EVENTS, FEEL_COLS } from '../data/feel.js';
import { LOOK_KEY, LOOK_PRESETS } from '../render/look.js';
import { store } from '../util/store.js';

// ?debug=1: the feel table as live inputs. Edit a number and the next footfall
// or hit uses it; COPY puts the whole table on the clipboard as JSON (or in
// the box below it) to paste back into src/data/feel.js once it feels right.
// The LOOK row above the table tunes the 3D view's resolution (render/look.js):
// how many lines tall it renders, and antialiasing (which reloads the page).
// It is saved, and ?lines=240&aa=0 in the URL shares a setting.
export function createFeelPanel(app) {
  const el = document.createElement('div');
  el.className = 'feel-panel';
  const rows = FEEL_EVENTS.map(ev => `<tr><th>${ev}</th>${FEEL_COLS.map(c => `<td><input type="number" step="0.05" data-ev="${ev}" data-col="${c}" value="${FEEL[ev][c]}"></td>`).join('')}</tr>`).join('');
  const extra = ['view', 'spring', 'knock'].map(g => `<tr><th>${g}</th><td colspan="${FEEL_COLS.length}">${Object.keys(FEEL[g]).map(k => `${k} <input type="number" step="0.05" data-ev="${g}" data-col="${k}" value="${FEEL[g][k]}">`).join(' ')}</td></tr>`).join('');
  const look = app.R.look;
  const presets = LOOK_PRESETS.map(n => `<button data-lines="${n}">${n || 'NATIVE'}</button>`).join('');
  el.innerHTML = `<div class="feel-head"><b>FEEL</b> <button data-a="toggle">hide</button> <button data-a="copy">COPY</button></div>
    <div class="feel-body"><div class="feel-look"><b>LOOK</b> lines <input type="range" min="0" max="720" step="10" data-look="lines" value="${look.lines}">
      <input type="number" min="0" max="2160" step="10" data-look="lines" value="${look.lines}"> <span class="feel-res"></span><br>${presets}
      <label><input type="checkbox" data-look="aa" ${look.aa ? 'checked' : ''}> antialias (reloads)</label></div><table><tr><th></th>${FEEL_COLS.map(c => `<th>${c}</th>`).join('')}</tr>${rows}${extra}</table><textarea class="feel-out" hidden></textarea></div>`;
  const res = el.querySelector('.feel-res');
  const showRes = () => { res.textContent = `${app.cv.width}×${app.cv.height}${look.lines ? '' : ' (native)'}`; };
  const setLines = n => {
    look.lines = Math.max(0, Math.round(n) || 0);
    for (const i of el.querySelectorAll('[data-look="lines"]')) if (+i.value !== look.lines) i.value = look.lines;
    store.set(LOOK_KEY, look);
    requestAnimationFrame(() => requestAnimationFrame(showRes));   // after the scene resizes the canvas
  };
  requestAnimationFrame(() => requestAnimationFrame(showRes));
  el.addEventListener('change', e => {
    if (e.target.dataset.look !== 'aa') return;
    look.aa = e.target.checked; store.set(LOOK_KEY, look);
    location.reload();   // the GL context's antialiasing is fixed when it is made
  });
  el.addEventListener('input', e => {
    if (e.target.dataset.look === 'lines') return setLines(parseFloat(e.target.value));
    const i = e.target; if (!i.dataset.ev) return;
    const v = parseFloat(i.value); if (Number.isFinite(v)) FEEL[i.dataset.ev][i.dataset.col] = v;
  });
  el.addEventListener('click', e => {
    if (e.target.dataset.lines != null) return setLines(+e.target.dataset.lines);
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'toggle') { const b = el.querySelector('.feel-body'); b.hidden = !b.hidden; e.target.textContent = b.hidden ? 'show' : 'hide'; }
    if (a === 'copy') {
      const text = JSON.stringify(FEEL, null, 2);
      const out = el.querySelector('.feel-out'); out.hidden = false; out.value = text;
      try { navigator.clipboard?.writeText(text); } catch { /* the box is there */ }
    }
  });
  // Keys typed into the panel must not drive the mech.
  el.addEventListener('keydown', e => e.stopPropagation());
  el.addEventListener('pointerdown', e => e.stopPropagation());
  app.wrap.appendChild(el);
  return el;
}
