// The mission editor (docs/specs/15-mission-editor.md), `?edit=1` and
// optionally `&mission=m06`: a mission from above on its real terrain. This
// part shows it and selects in it; placing, the fields, problems, export and
// PLAY come with the next parts (#247, #248). It is loaded on its own
// (`import()` in main.js), so normal play never downloads it.
//
// The camera, gestures, picking and markers are shared modules that know
// nothing about missions (render/topCamera.js, input/pointer.js,
// sim/pick.js, render/markers.js); this file is what turns a mission into
// things to draw and pick.
import { MISSIONS } from '../data/missions.js';
import { NAMES } from '../data/names.js';
import { toSource, fromSource } from '../data/missionIO.js';
import { hudPalette } from '../data/colors.js';
import { startMatch } from '../sim/state.js';
import { polar } from '../sim/placement.js';
import { pickNearest, pickInside } from '../sim/pick.js';
import { BOUND } from '../world/terrain.js';
import { createTopCamera, camView, groundToScreen, screenToGround, panBy, zoomAt, rotateAbout, settle, metresPerPixel } from '../render/topCamera.js';
import { drawMap, drawCompass } from '../render/markers.js';
import { bindPointer } from '../input/pointer.js';
import { store } from '../util/store.js';
import { esc } from '../util/dom.js';

const MECH_R = 6, FINGER = 22;   // m: a mech, for picking · px: how far a tap reaches
const WAVE_DIST = 520;           // sim/waves.js: a wave's default distance
const fresh = def => fromSource(toSource(def));   // a deep copy that is exactly what export and import give

// Where things are and what they look like, from the mission (and, for a
// foe placed on the ring, from where the game put it).
export function mapThings(def, G) {
  const h = (x, z) => G.ter.height(x, z);
  const things = [], routes = [], waves = [];
  const st = def.start ? polar(def.start) : { x: 0, z: 0 };
  things.push({ id: 'start', kind: 'start', ...st, y: h(st.x, st.z), r: MECH_R, face: def.start?.[2] ?? 0, label: 'START' });
  const foeMechs = G.mechs.filter(m => m.team !== 0);
  (def.foes || []).forEach((f, i) => {
    const s = typeof f === 'string' ? { type: f } : f, m = foeMechs[i];
    const p = s.at ? polar(s.at) : m ? { x: m.x, z: m.z } : { x: 0, z: 0 };
    const face = s.face ?? (m ? -m.yaw * 180 / Math.PI : null);
    things.push({ id: `foes.${i}`, kind: 'foe', ...p, y: h(p.x, p.z), r: MECH_R, face, asleep: s.aware === false, label: NAMES.chassis[s.type] || s.type });
  });
  const ents = def.entities || [], pathsDrawn = new Map();
  ents.forEach((e, i) => {
    if (!e.at) return;
    const p = polar(e.at), kind = e.kind === 'nav' ? (e.mesh === 'pad' ? 'pad' : 'nav') : e.kind || 'structure';
    const r = kind === 'nav' || kind === 'pad' ? e.radius ?? 14 : e.radius ?? (kind === 'vehicle' ? 2.2 : 3);
    things.push({ id: entityId(e, i), kind, ...p, y: h(p.x, p.z), r, hp: e.hp, label: e.label || e.id || '' });
    if (e.kind === 'vehicle' && Array.isArray(e.path) && e.path.length) {
      const key = JSON.stringify(e.path);
      if (!pathsDrawn.has(key)) {
        const pts = e.path.map(q => { const w = polar(q); return { ...w, y: h(w.x, w.z) }; });
        pathsDrawn.set(key, true);
        routes.push({ id: `route.${entityId(e, i)}`, pts });
      }
    }
  });
  const allWaves = [...(def.waves || []).map((w, k) => [w, `waves.${k}`]),
    ...(def.objectives || []).flatMap((o, n) => (o.waves || []).map((w, k) => [w, `objectives.${n}.waves.${k}`]))];
  allWaves.forEach(([w, id], n) => {
    const label = `WAVE ${n + 1}`, dist = w.dist ?? WAVE_DIST, at = { ...st, y: h(st.x, st.z) };
    if (typeof w.from === 'number') {
      const d = polar([w.from, dist]), from = { x: st.x + d.x, z: st.z + d.z };
      waves.push({ id, kind: 'bearing', from: { ...from, y: h(from.x, from.z) }, to: at, label });
    } else if (typeof w.from === 'string' && w.from !== 'ring') {
      const e = ents.find(x => x.id === w.from);
      if (e?.at) { const p = polar(e.at); waves.push({ id, kind: 'nav', from: { ...p, y: h(p.x, p.z) }, to: at, label }); }
    } else waves.push({ id, kind: 'ring', from: at, r: dist, label });
  });
  return { things, routes, waves };
}
const entityId = (e, i) => `entities.${e.id ?? i}`;

export function createEditor(app) {
  const G = app.G, wrap = app.wrap, params = app.params;
  const missionKeys = MISSIONS.map(m => m.key);
  const key0 = params.get('mission') || store.get('edit.key', 'm01');
  const E = { key: missionKeys.includes(key0) ? key0 : 'm01', def: null, cam: createTopCamera(), sel: new Set(), box: null, map: null };
  app.ov.hidden = true;

  // The page: a surface for the gestures and a panel on the right.
  const root = document.createElement('div');
  root.className = 'ed';
  root.innerHTML = `
    <div class="ed-surface"></div>
    <div class="ed-panel">
      <div class="ed-title">EDITOR</div>
      <select class="ed-mission" aria-label="Mission">${MISSIONS.map(m => `<option value="${m.key}">${m.key.toUpperCase()}${m.name ? ` · ${esc(m.name)}` : ''}</option>`).join('')}</select>
      <div class="ed-sel"></div>
    </div>`;
  wrap.appendChild(root);
  const surface = root.querySelector('.ed-surface'), panel = root.querySelector('.ed-sel'), pick = root.querySelector('.ed-mission');
  pick.value = E.key;
  pick.addEventListener('change', () => load(pick.value));

  function load(key) {
    E.key = key; store.set('edit.key', key);
    E.def = fresh(MISSIONS.find(m => m.key === key));
    E.sel.clear();
    rebuild();
    frame();
  }
  // The world from the working copy: the game's own start, in daylight and
  // clear weather so everything can be seen, and the sim never stepped.
  function rebuild() {
    const view = { ...E.def, time: 'day' };
    delete view.ramp; delete view.weather;
    startMatch(G, view, E.def.seed ?? 7, false, app.prefs.chassis);
    G.state = 'edit'; G.kind = 'edit';
    app.scene.uploadWorld();
    E.map = mapThings(E.def, G);
    showSel();
  }
  // Fit the mission on the screen: every thing and route point in the part
  // of it the panel leaves free, found by halving the distance in or out.
  function frame() {
    const pts = [...E.map.things, ...E.map.routes.flatMap(r => r.pts)];
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
    const { W, H } = size(), free = freeArea(W, H);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const at = d => {   // the middle of the mission in the middle of the free part
      Object.assign(E.cam, { x: cx, z: cz, yaw: 0, dist: d });
      settle(E.cam, BOUND, G.ter.height);
      panBy(E.cam, (free.x0 + free.x1) / 2 - W / 2, (free.y0 + free.y1) / 2 - H / 2, H);
    };
    const fits = () => {
      const VP = camView(E.cam, W / H).VP;
      return pts.every(p => { const s = groundToScreen(E.cam, p, W, H, VP); return s && s[0] >= free.x0 && s[0] <= free.x1 && s[1] >= free.y0 && s[1] <= free.y1; });
    };
    let lo = 100, hi = 3200;
    for (let k = 0; k < 18; k++) { const d = (lo + hi) / 2; at(d); if (fits()) hi = d; else lo = d; }
    at(hi);
  }
  // The screen less the panel and a margin.
  function freeArea(W, H) {
    const r = root.querySelector('.ed-panel').getBoundingClientRect(), wr = wrap.getBoundingClientRect(), m = 28;
    const x1 = r.width && r.left - wr.left > W / 2 ? r.left - wr.left - m : W - m;
    return { x0: m, x1, y0: m, y1: H - m - 16 };   // room for a label under the lowest thing
  }

  const size = () => ({ W: Math.max(1, wrap.clientWidth), H: Math.max(1, wrap.clientHeight) });
  const ground = (sx, sy) => { const { W, H } = size(); return screenToGround(E.cam, sx, sy, W, H, G.ter.height); };
  const mpp = () => metresPerPixel(E.cam, size().H);
  const pickables = () => E.map.things.map(t => ({ id: t.id, x: t.x, z: t.z, r: t.r }));
  const after = () => { settle(E.cam, BOUND, G.ter.height); };

  bindPointer(surface, {
    tap(x, y) {
      const g = ground(x, y), hit = g && pickNearest(pickables(), g.x, g.z, FINGER * mpp());
      E.sel = new Set(hit ? [hit.id] : []);
      showSel();
    },
    dragStart(x, y) { E.box = [x, y, x, y]; },
    drag(x, y) { if (E.box) { E.box[2] = x; E.box[3] = y; } },
    dragEnd() {
      const b = E.box;
      E.box = null;
      if (!b) return;
      const corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => ground(x, y));
      if (corners.some(c => !c)) return;
      E.sel = new Set(pickInside(pickables(), corners.map(c => [c.x, c.z])).map(t => t.id));
      showSel();
    },
    dragCancel() { E.box = null; },
    pan(dx, dy) { panBy(E.cam, dx, dy, size().H); after(); },
    pinch(f, x, y) { zoomAt(E.cam, f, ground(x, y)); after(); },
    twist(a, x, y) { rotateAbout(E.cam, a, ground(x, y)); after(); },   // fingers turned clockwise turn the map clockwise
  });
  addEventListener('keydown', e => {
    if (G.state !== 'edit' || e.target.closest?.('input, select, textarea')) return;
    const turn = { KeyQ: -0.15, KeyE: 0.15 }[e.code], move = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.code];
    if (turn) rotateAbout(E.cam, turn);
    else if (move) panBy(E.cam, move[0], move[1], size().H);
    else if (e.code === 'KeyF') frame();
    else return;
    e.preventDefault(); after();
  });

  // The panel: what is selected, plainly.
  function showSel() {
    const ids = [...E.sel];
    if (!ids.length) { panel.innerHTML = '<p class="ed-hint">TAP A THING. DRAG TO BOX MANY. TWO FINGERS MOVE THE MAP.</p>'; return; }
    if (ids.length > 1) { panel.innerHTML = `<p>${ids.length} THINGS</p><ul>${ids.map(id => `<li>${esc(titleOf(id))}</li>`).join('')}</ul>`; return; }
    const id = ids[0], src = sourceOf(id);
    panel.innerHTML = `<p>${esc(titleOf(id))}</p>${src ? `<dl>${Object.entries(src).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(fieldText(v))}</dd>`).join('')}</dl>` : ''}`;
  }
  const titleOf = id => E.map.things.find(t => t.id === id)?.label || id;
  function sourceOf(id) {
    if (id === 'start') return { start: E.def.start || [0, 0, 0] };
    const [list, k] = id.split('.');
    if (list === 'foes') { const f = E.def.foes[+k]; return typeof f === 'string' ? { type: f } : f; }
    if (list === 'entities') return (E.def.entities || []).find((e, i) => (e.id ?? String(i)) === k) || null;
    return null;
  }
  const fieldText = v => (typeof v === 'string' ? v : Array.isArray(v) && v.length > 6 ? `${v.length} points` : JSON.stringify(v).replace(/null/g, 'Infinity'));

  // A frame: the 3D world from above, then the markers over it.
  function draw() {
    const { W, H } = size(), dpr = app.scene.view.dpr || 1, ctx = app.ctx;
    app.scene.render();
    const VP = camView(E.cam, W / H).VP;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, app.hud.width, app.hud.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = { W, H, mpp: mpp(), toScreen: (x, y, z) => groundToScreen(E.cam, { x, y, z }, W, H, VP) };
    drawMap(ctx, view, { map: { bound: BOUND, height: G.ter.height, grid: 100 }, ...E.map, sel: E.sel, box: E.box, pal: hudPalette(app.prefs.colourMode) });
    drawCompass(ctx, 34, H - 34, E.cam.yaw, hudPalette(app.prefs.colourMode));
  }
  // What the renderer asks for in the editor: the overhead camera.
  app.topView = () => { const { W, H } = size(), v = camView(E.cam, W / H); return { eye: v.eye, dir: v.dir, fov: v.fov, near: v.near, far: v.far }; };

  load(E.key);
  frame();
  // Where a thing is on the screen, for the smoke test (CSS pixels).
  const toScreen = t => { const { W, H } = size(); return groundToScreen(E.cam, t, W, H); };
  const self = { E, draw, load, frame, toScreen, selectIds: ids => { E.sel = new Set(ids); showSel(); } };
  return self;
}
