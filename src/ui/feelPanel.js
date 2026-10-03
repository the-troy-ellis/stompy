import { FEEL, FEEL_EVENTS, FEEL_COLS } from '../data/feel.js';

// ?debug=1: the feel table as live inputs. Edit a number and the next footfall
// or hit uses it; COPY puts the whole table on the clipboard as JSON (or in
// the box below it) to paste back into src/data/feel.js once it feels right.
export function createFeelPanel(app) {
  const el = document.createElement('div');
  el.className = 'feel-panel';
  const rows = FEEL_EVENTS.map(ev => `<tr><th>${ev}</th>${FEEL_COLS.map(c => `<td><input type="number" step="0.05" data-ev="${ev}" data-col="${c}" value="${FEEL[ev][c]}"></td>`).join('')}</tr>`).join('');
  const extra = ['view', 'spring'].map(g => `<tr><th>${g}</th><td colspan="${FEEL_COLS.length}">${Object.keys(FEEL[g]).map(k => `${k} <input type="number" step="0.05" data-ev="${g}" data-col="${k}" value="${FEEL[g][k]}">`).join(' ')}</td></tr>`).join('');
  el.innerHTML = `<div class="feel-head"><b>FEEL</b> <button data-a="toggle">hide</button> <button data-a="copy">COPY</button></div>
    <div class="feel-body"><table><tr><th></th>${FEEL_COLS.map(c => `<th>${c}</th>`).join('')}</tr>${rows}${extra}</table><textarea class="feel-out" hidden></textarea></div>`;
  el.addEventListener('input', e => {
    const i = e.target; if (!i.dataset.ev) return;
    const v = parseFloat(i.value); if (Number.isFinite(v)) FEEL[i.dataset.ev][i.dataset.col] = v;
  });
  el.addEventListener('click', e => {
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
