import { startWalkView, WALK_PATHS } from '../sim/walkView.js';
import { update, noInput } from '../sim/update.js';
import { geoOf } from '../data/geo.js';
import { BODY } from '../data/walk.js';
import { CHASSIS, PILOTABLE } from '../data/chassis.js';
import { store } from '../util/store.js';
import { add, clampN, norm, sub } from '../util/math.js';

const { sin, cos, PI, max } = Math;

// ?debug=1's walk viewer (docs/specs/19-debug-menu.md § Walk viewer): your
// mech walks on flat ground and you watch it from outside, to settle how the
// gait looks. Its own screen state ('walk'): no cockpit controls, no pointer
// lock. The panel on the left picks the mech, the speed and the path, slows
// or stops time and steps it a frame at a time, and moves the camera; drag
// the view to orbit, wheel or pinch to zoom. TUNING's pages (ui/tuning.js)
// sit under it, so a gait number can change while you watch. The HUD canvas
// gets a ground grid (does a planted foot stay put?) and a strip chart of the
// last 3 s: the hips' height, the lurch and each foot's height. MODEL picks
// the body that rides the legs (data/walk.js BODY), OLD or PENDULUM.
export const WALK_VIEWS = [['side', 'SIDE', PI / 2, 0.06], ['three', '¾', PI / 4, 0.22], ['front', 'FRONT', 0, 0.1], ['back', 'BACK', PI, 0.15], ['cockpit', 'COCKPIT']];
export const WALK_TIMES = [[1, '1×'], [0.5, '½×'], [0.25, '¼×'], [0.1, '⅒×']];
const KEY = 'debug.walk', STEP = 1 / 60, CHART_S = 3;

export function createWalkView(app) {
  const G = app.G;
  const st = { chassis: null, view: 'side', time: 0, grid: true, chart: true, tune: false, thr: 0.6, path: 'straight', model: BODY.model, ...store.get(KEY, {}) };
  BODY.model = st.model === 'pendulum' ? 'pendulum' : 'old';   // MODEL: which body rides the legs (data/walk.js); kept for play in this debug session too
  const cam = { a: PI / 2, p: 0.06, d: 1 };   // the orbit: round from the mech's nose, up, and how far (×)
  let paused = false, steps = 0, el = null, drag = null;
  const pinch = new Map();
  const hist = [];   // [t, hips, lurch, ...feet heights], sim time
  const save = () => store.set(KEY, { chassis: st.chassis, view: st.view, time: st.time, grid: st.grid, chart: st.chart, tune: st.tune, thr: st.thr, path: st.path, model: BODY.model });
  const setView = k => {
    st.view = k;
    const v = WALK_VIEWS.find(([x]) => x === k);
    if (v && v[2] != null) { cam.a = v[2]; cam.p = v[3]; cam.d = 1; }
  };

  function start(chassis = st.chassis || app.prefs.chassis) {
    st.chassis = PILOTABLE.includes(chassis) ? chassis : 'kestrel';
    startWalkView(G, st.chassis);
    Object.assign(G.walk, { thr: st.thr, path: st.path });
    G.state = 'walk'; G.paused = false;
    app.scene.uploadWorld();
    app.ui.hideOverlay(); app.input.exitLock(); app.input.syncTouchUI();
    app.audio.Sound.unlock(); app.audio.loadSamples();
    hist.length = 0; paused = false;
    setView(st.view);
    save(); panel(); show(true);
  }
  function exit() { show(false); app.ui.mainMenu('debug'); }

  // The panel, rebuilt on every pick (it's small).
  const btn = (a, label, on, v = '') => `<button class="${on ? 'on' : ''}" data-w="${a}" data-v="${v}">${label}</button>`;
  function panel() {
    if (!el) {
      el = document.createElement('div'); el.className = 'walk-ui'; app.wrap.appendChild(el);
      el.addEventListener('click', click);
      el.addEventListener('input', e => { if (e.target.dataset.w === 'thr') { st.thr = +e.target.value / 100; if (G.walk) G.walk.thr = st.thr; el.querySelector('.walk-thr').textContent = pct(); save(); } else app.tune?.input(e); });
      el.addEventListener('change', e => { app.tune?.change(e); });
      for (const t of ['pointerdown', 'wheel']) el.addEventListener(t, e => e.stopPropagation());
    }
    const W = G.walk || st;
    el.innerHTML = `<div class="walk-row"><b>WALK</b>${btn('mech', '◀', false, -1)}<span class="walk-name">${CHASSIS[st.chassis]?.name || ''}</span>${btn('mech', '▶', false, 1)}</div>
      <div class="walk-row">SPEED <input type="range" min="-35" max="100" step="5" data-w="thr" value="${Math.round(st.thr * 100)}"><span class="walk-thr">${pct()}</span>${btn('go', W.go === false ? 'GO' : 'STOP', W.go === false)}</div>
      <div class="walk-row">MODEL ${btn('model', 'OLD', BODY.model === 'old', 'old')}${btn('model', 'PENDULUM', BODY.model === 'pendulum', 'pendulum')}</div>
      <div class="walk-row">PATH ${WALK_PATHS.map(p => btn('path', p.toUpperCase(), st.path === p, p)).join('')}</div>
      <div class="walk-row">TIME ${WALK_TIMES.map(([, l], i) => btn('time', l, st.time === i && !paused, i)).join('')}${btn('pause', 'II', paused)}${btn('step', 'STEP', false)}</div>
      <div class="walk-row">VIEW ${WALK_VIEWS.map(([k, l]) => btn('view', l, st.view === k, k)).join('')}</div>
      <div class="walk-row">SHOW ${btn('grid', 'GRID', st.grid)}${btn('chart', 'CHART', st.chart)}${btn('tune', 'TUNING', st.tune)}${btn('exit', 'EXIT', false)}</div>
      ${st.tune && app.tune ? app.tune.html() : ''}`;
  }
  const pct = () => `${Math.round(st.thr * 100)}%`;

  function click(e) {
    if (app.tune?.click(e)) return;
    const b = e.target.closest('[data-w]');
    if (!b) return;
    const a = b.dataset.w, v = b.dataset.v;
    if (a === 'mech') { const i = PILOTABLE.indexOf(st.chassis); start(PILOTABLE[(i + +v + PILOTABLE.length) % PILOTABLE.length]); return; }
    if (a === 'exit') { exit(); return; }
    if (a === 'go') G.walk.go = !G.walk.go;
    else if (a === 'path') { st.path = v; G.walk.path = v; }
    else if (a === 'model') BODY.model = v;
    else if (a === 'time') { st.time = +v; paused = false; }
    else if (a === 'pause') paused = !paused;
    else if (a === 'step') { paused = true; steps++; }
    else if (a === 'view') setView(v);
    else if (a === 'grid' || a === 'chart' || a === 'tune') st[a] = !st[a];
    save(); panel();
  }

  // Keys while it's up: Space pauses, . or → steps, 1 to 4 pick the speed, Esc leaves.
  document.addEventListener('keydown', e => {
    if (G.state !== 'walk' || e.target.closest?.('input, textarea')) return;
    const k = e.code;
    if (k === 'Escape') exit();
    else if (k === 'Space') paused = !paused;
    else if (k === 'Period' || k === 'ArrowRight') { paused = true; steps++; }
    else if (/^Digit[1-4]$/.test(k)) { st.time = +k[5] - 1; paused = false; }
    else return;
    e.preventDefault(); save(); panel();
  });
  // Orbit and zoom on the view itself.
  const cv = app.cv;
  cv.addEventListener('pointerdown', e => {
    if (G.state !== 'walk') return;
    pinch.set(e.pointerId, [e.clientX, e.clientY]);
    drag = { x: e.clientX, y: e.clientY, d: pinchGap() };
    try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
  });
  cv.addEventListener('pointermove', e => {
    if (G.state !== 'walk' || st.view === 'cockpit' || !drag || !pinch.has(e.pointerId)) return;
    pinch.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.size > 1) { const g = pinchGap(); if (drag.d) cam.d = clampN(cam.d * drag.d / g, 0.3, 4); drag.d = g; return; }
    cam.a -= (e.clientX - drag.x) * 0.008; cam.p = clampN(cam.p + (e.clientY - drag.y) * 0.006, -0.3, 1.4);
    drag.x = e.clientX; drag.y = e.clientY;
    if (st.view !== 'free') { st.view = 'free'; save(); panel(); }   // off the presets
  });
  const lift = e => { pinch.delete(e.pointerId); if (!pinch.size) drag = null; else { const [p] = pinch.values(); drag = { x: p[0], y: p[1], d: 0 }; } };
  cv.addEventListener('pointerup', lift); cv.addEventListener('pointercancel', lift);
  cv.addEventListener('wheel', e => { if (G.state !== 'walk') return; e.preventDefault(); cam.d = clampN(cam.d * Math.exp(e.deltaY * 0.001), 0.3, 4); }, { passive: false });
  function pinchGap() { const p = [...pinch.values()]; return p.length > 1 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1 : 0; }

  // One display frame: the sim at the picked speed (or a single step), and the chart's samples.
  function tick(dt) {
    const n = paused ? Math.min(steps, 1) : 1;
    if (paused) steps = Math.max(0, steps - n);
    for (let i = 0; i < n; i++) {
      update(G, noInput(), paused ? STEP : dt * WALK_TIMES[st.time][0]);
      sample();
    }
  }
  function sample() {
    const P = G.player, s = P.ch.scale, ground = G.ter.groundBelow(P.x, P.y + 20, P.z);
    hist.push([G.time, (P.y - ground) + (P.bob || 0), (P.surge || 0) * s, (P.y - ground) + (P.bob || 0) + (P.torsoDrop || 0) * s, ...P.feet.map(f => f.pos[1] - G.ter.groundBelow(f.pos[0], f.pos[1] + 5, f.pos[2]))]);
    while (hist.length && hist[0][0] < G.time - CHART_S) hist.shift();
    if (hist.length > 1 && hist[hist.length - 2][0] > G.time) hist.length = 0;   // a fresh start
  }

  // The camera (render/scene.js asks): round the mech from its nose by
  // cam.a, up by cam.p, back far enough for its height, and aimed a little
  // to its left on a wide screen so it stands clear of the panel. Null: the cockpit.
  function camera() {
    if (st.view === 'cockpit' || !G.player) return null;
    const P = G.player, h = geoOf(P).height * P.ch.scale, a = P.yaw + cam.a;
    const c = [P.x, P.y + h * 0.45, P.z], d = h * 3.2 * cam.d;
    const eye = add(c, [sin(a) * cos(cam.p) * d, sin(cam.p) * d, cos(a) * cos(cam.p) * d]);
    const wide = app.scene.view.W > app.scene.view.H * 1.3 ? d * 0.18 : 0, at = add(c, [-cos(a) * wide, 0, sin(a) * wide]);
    return { eye, dir: norm(sub(at, eye)), fov: 0.75 };
  }

  // On the HUD canvas (render/hud.js), in its units: the grid and the chart.
  function draw(ctx, W, H, project) {
    const P = G.player;
    if (!P) return;
    if (st.grid) {
      const step = 4 * P.ch.scale, n = 6, cx = Math.round(P.x / step) * step, cz = Math.round(P.z / step) * step, y = (x, z) => G.ter.groundBelow(x, P.y + 20, z) + 0.02;
      ctx.strokeStyle = 'rgba(200,255,200,0.6)'; ctx.lineWidth = 1.5;
      // A small cross at each corner (lines would hide the legs they're there to judge).
      const k = step * 0.15;
      ctx.beginPath();
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const x = cx + i * step, z = cz + j * step, gy = y(x, z);
        for (const [ax, az, bx, bz] of [[x - k, z, x + k, z], [x, z - k, x, z + k]]) {
          const p = project([ax, gy, az]), q = project([bx, gy, bz]);
          if (p && q) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        }
      }
      ctx.stroke();
    }
    if (st.chart && hist.length > 1) chart(ctx, W, H);
  }
  // The last 3 s, newest on the right: hips (yellow), torso (orange: the
  // hips plus its lag, the same under OLD), lurch (cyan, about its own zero), and each foot's height (green, one line a foot). Ticks on the
  // bottom are footfalls (a foot reaching the ground).
  function chart(ctx, W, H) {
    const w = Math.min(360, W * 0.45), h = 90, x0 = W - w - 10, y0 = H - h - 10, t1 = hist[hist.length - 1][0];
    const P = G.player, span = geoOf(P).hip * P.ch.scale * 0.25;   // the vertical scale: a quarter of the hip's height fills half the box
    const X = t => x0 + w - (t1 - t) / CHART_S * w;
    ctx.fillStyle = 'rgba(0,10,0,0.88)'; ctx.fillRect(x0, y0, w, h);
    const line = (col, f) => { ctx.strokeStyle = col; ctx.beginPath(); hist.forEach((r, i) => { const y = clampN(f(r), y0, y0 + h); i ? ctx.lineTo(X(r[0]), y) : ctx.moveTo(X(r[0]), y); }); ctx.stroke(); };
    ctx.lineWidth = 1.5;
    line('#fc3', r => y0 + h * 0.3 - r[1] / span * h * 0.5);
    line('#3cf', r => y0 + h * 0.3 - r[2] / span * h * 0.5);
    line('#f83', r => y0 + h * 0.3 - r[3] / span * h * 0.5);
    for (let k = 4; k < hist[0].length; k++) line('#5f5', r => y0 + h - 4 - r[k] / (span * 2) * h * 0.6);
    ctx.fillStyle = '#9f9'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    const last = hist[hist.length - 1];
    ctx.fillText(`HIPS ${last[1].toFixed(2)}  TORSO  LURCH ${last[2].toFixed(2)}  FEET   ${max(0, P.speed).toFixed(1)} m/s`, x0 + 4, y0 + 11);
  }

  let shown = false;
  function show(v) { if (v === shown) return; shown = v; if (el) el.hidden = !v; }

  return { start, exit, tick, camera, draw, show, showsMech: () => st.view !== 'cockpit', cam, st };
}
