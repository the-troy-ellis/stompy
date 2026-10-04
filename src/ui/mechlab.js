import { store } from '../util/store.js';
import { esc } from '../util/dom.js';
import { CHASSIS, SECT_NAME } from '../data/chassis.js';
import { WEAPONS, CAT_LABEL } from '../data/weapons.js';
import { SYSTEMS } from '../data/systems.js';
import { cycleSystem, cycleWeapon, stats, stockLoadout, systemsFor, validate } from '../sim/loadout.js';

// The FIT screen (docs/specs/02-mechlab.md § Player experience): the
// hardpoints and system slots of the chassis on show, each a row you tap (or
// step with the arrows) to cycle, a tonnage bar, and the stats that move as
// you do. No OK button: every change is saved as it happens.

const key = k => 'fit.' + k;
// The saved fit for a chassis, cleaned up (a stale save falls back per hardpoint).
export const fitOf = k => validate(k, store.get(key(k))).loadout;
export const fitOk = k => validate(k, fitOf(k)).ok;

// What the menu's kit line says: the fitted weapons, doubles folded.
export function kitLine(k) {
  const lo = fitOf(k), names = [];
  for (const h of CHASSIS[k].hardpoints) if (lo.hp[h.id]) names.push(WEAPONS[lo.hp[h.id]].name);
  names.push(WEAPONS.fusion.name);
  const counts = names.reduce((a, n) => a.set(n, (a.get(n) || 0) + 1), new Map());
  return [...counts].map(([n, c]) => (c > 1 ? `${c}x ${n}` : n)).join(' · ');
}

export function createMechlab(app) {
  const prefs = app.prefs;
  const fit = { open: false, row: 0 };
  const rows = () => [...CHASSIS[prefs.chassis].hardpoints.map(h => ({ kind: 'hp', id: h.id })), ...systemsFor(prefs.chassis).map(k => ({ kind: 'sys', id: k }))];

  function change(row, d) {
    const k = prefs.chassis, lo = fitOf(k);
    const next = row.kind === 'hp' ? cycleWeapon(k, lo, row.id, d) : cycleSystem(lo, row.id, d, k);
    store.set(key(k), next);
    app.ui.showMech();
    app.ui.renderMenu();
  }
  function reset() { store.set(key(prefs.chassis), stockLoadout(prefs.chassis)); app.ui.showMech(); app.ui.renderMenu(); }
  function open(on) { fit.open = on; fit.row = 0; app.ui.renderMenu(); }

  const bar = (label, f) => `<span>${label}</span><i><b style="width:${Math.round(Math.max(0, Math.min(1, f)) * 100)}%"></b></i>`;
  function html() {
    const k = prefs.chassis, ch = CHASSIS[k], lo = fitOf(k), v = validate(k, lo), st = stats(k, lo);
    const row = (i, label, value, attrs) => `<div class="lab-row${i === fit.row ? ' on' : ''}" data-row="${i}">
      <span>${label}</span><button ${attrs} data-d="-1" aria-label="Previous">◀</button><b ${attrs} data-d="1">${value}</b><button ${attrs} data-d="1" aria-label="Next">▶</button></div>`;
    const hpRows = ch.hardpoints.map((h, i) => row(i, `${SECT_NAME[h.loc].toUpperCase()} · ${CAT_LABEL[h.cat]}`,
      lo.hp[h.id] ? WEAPONS[lo.hp[h.id]].name : 'EMPTY', `data-lab="hp" data-id="${h.id}"`));
    const sysRows = systemsFor(prefs.chassis).map((s, j) => row(ch.hardpoints.length + j, SYSTEMS[s].label, SYSTEMS[s].show(lo.sys[s]), `data-lab="sys" data-id="${s}"`));
    const f = v.tons / ch.tons, col = v.ok ? (f >= 1 ? 'amber' : '') : 'red';
    return `<div class="mm-label">FIT · ${esc(ch.name)}</div>
      <div class="lab">${hpRows.join('')}<div class="lab-gap"></div>${sysRows.join('')}</div>
      <div class="lab-tons ${col}"><i><b style="width:${Math.round(Math.min(1, f) * 100)}%"></b></i><span>${v.tons} / ${ch.tons} t${v.ok ? '' : ' · OVERWEIGHT'}</span></div>
      <div class="mm-stats lab-stats">${bar('FIREPOWER', st.firepower / 25)}${bar('HEAT', (st.heatBalance + 30) / 40)}${bar('SPEED', st.speed / 22)}${bar('ARMOUR', st.armour / 300)}</div>
      <div class="opts lab-actions"><button class="opt" data-lab="reset">RESET</button><button class="opt" data-lab="back">BACK</button></div>`;
  }

  // Clicks inside the FIT block. True when it handled the click.
  function click(e) {
    const el = e.target.closest('[data-lab]');
    if (!el) return false;
    const t = el.dataset.lab;
    if (t === 'back') open(false);
    else if (t === 'reset') reset();
    else change({ kind: t, id: el.dataset.id }, +el.dataset.d || 1);
    return true;
  }
  // Keys while FIT is open: up/down pick a row, left/right cycle it, Esc or Backspace goes back.
  function key_(e) {
    const r = rows();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { fit.row = (fit.row + (e.key === 'ArrowDown' ? 1 : -1) + r.length) % r.length; app.ui.renderMenu(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') change(r[fit.row], e.key === 'ArrowRight' ? 1 : -1);
    else if (e.key === 'Escape' || e.key === 'Backspace') open(false);
    else return false;
    e.preventDefault();
    return true;
  }
  return { fit, open, html, click, key: key_, reset };
}
