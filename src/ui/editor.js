// The mission editor (docs/specs/15-mission-editor.md), `?edit=1` and
// optionally `&mission=m06`: a mission from above on its real terrain, where
// you place and move its foes, structures, vehicles, routes and pads, turn
// them, edit their fields, reroll the ground and see what a foe can see.
// Its objectives and waves are lists in the panel, problems show as they
// appear, EXPORT writes the mission as missions.js's JS, and PLAY tries it
// and comes back. The working copy is kept in local storage. It is loaded on
// its own (`import()` in main.js), so normal play never downloads it.
//
// The camera, gestures, picking, markers and line of sight are shared modules
// that know nothing about missions (render/topCamera.js, input/pointer.js,
// sim/pick.js, render/markers.js, sim/sight.js); this file is what turns a
// mission into things to draw and pick, and edits back into the mission.
import { MISSIONS, SHAPES } from '../data/missions.js';
import { NAMES } from '../data/names.js';
import { MECH_ORDER } from '../data/chassis.js';
import { PALS } from '../data/palettes.js';
import { WEATHER } from '../data/weather.js';
import { diffOf } from '../data/ai.js';
import { toSource, fromSource, check } from '../data/missionIO.js';
import { hudPalette } from '../data/colors.js';
import { startMatch } from '../sim/state.js';
import { fitOf } from './mechlab.js';
import { polar, toPolar, roundPolar } from '../sim/placement.js';
import { eyeOf } from '../sim/geom.js';
import { PROFILES } from '../sim/ai/profiles.js';
import { pickNearest, pickInside } from '../sim/pick.js';
import { sightGrid } from '../sim/sight.js';
import { BOUND } from '../world/terrain.js';
import { createTopCamera, camView, groundToScreen, screenToGround, panBy, zoomAt, rotateAbout, settle, metresPerPixel } from '../render/topCamera.js';
import { drawMap, drawCompass } from '../render/markers.js';
import { bindPointer } from '../input/pointer.js';
import { store } from '../util/store.js';
import { esc } from '../util/dom.js';

const MECH_R = 6, FINGER = 22, HANDLE = 34;   // m: a mech, for picking · px: how far a tap reaches · px: the facing handle from its thing
const WAVE_DIST = 520;                        // sim/waves.js: a wave's default distance
const fresh = def => fromSource(toSource(def));   // a deep copy that is exactly what export and import give
const D2R = Math.PI / 180;

// The palette: what the next tap places. ROUTE stays on until it is tapped again.
const TOOLS = ['FOE', 'STRUCTURE', 'TURRET', 'VEHICLE', 'NAV', 'PAD', 'ROUTE'];
const NEW_ID = { structure: 'relay', turret: 'launcher', vehicle: 'truck', nav: 'nav', pad: 'lz' };
const MESHES = [...new Set(Object.values(SHAPES).map(s => s.mesh))];

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
    const face = s.face ?? (m ? -m.yaw / D2R : null);
    things.push({ id: `foes.${i}`, kind: 'foe', ...p, y: h(p.x, p.z), r: MECH_R, face, asleep: s.aware === false, label: NAMES.chassis[s.type] || s.type });
  });
  const ents = def.entities || [], pathsDrawn = new Set();
  ents.forEach((e, i) => {
    if (!e.at) return;
    const p = polar(e.at), kind = entityKind(e);
    const r = kind === 'nav' || kind === 'pad' ? e.radius ?? 14 : e.radius ?? (kind === 'vehicle' ? 2.2 : 3);
    things.push({ id: entityId(e, i), kind, ...p, y: h(p.x, p.z), r, hp: e.hp, label: e.label || e.id || '' });
    if (e.kind === 'vehicle' && Array.isArray(e.path) && e.path.length) {
      const key = JSON.stringify(e.path);
      if (pathsDrawn.has(key)) return;
      pathsDrawn.add(key);
      routes.push({ id: `route.${entityId(e, i)}`, owner: entityId(e, i), pts: e.path.map(q => { const w = polar(q); return { ...w, y: h(w.x, w.z) }; }) });
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
const entityKind = e => (e.kind === 'nav' ? (e.mesh === 'pad' ? 'pad' : 'nav') : e.kind || 'structure');

// ---- Edits on the mission itself: plain functions on the definition, so
// they are tested headlessly (test/editorEdits.test.js). `id`s are the ones
// mapThings gives. ----

// The mission's object behind an id: { list, index, item } (start: the array).
export function findSource(def, id) {
  if (id === 'start') return { list: 'start', item: def.start || null };
  const [list, k] = id.split('.');
  if (list === 'foes') { const i = +k; return def.foes?.[i] != null ? { list, index: i, item: def.foes[i] } : null; }
  if (list === 'entities') {
    const i = (def.entities || []).findIndex((e, j) => String(e.id ?? j) === k);
    return i < 0 ? null : { list, index: i, item: def.entities[i] };
  }
  return null;
}
// Put a thing at (x, z) on the ground, rounded as the spec says a moved thing is.
export function moveTo(def, id, x, z) {
  const at = roundPolar(toPolar(x, z));
  if (id === 'start') { def.start = [at[0], at[1], def.start?.[2] ?? 0]; return; }
  const s = findSource(def, id);
  if (!s) return;
  if (s.list === 'foes' && typeof s.item === 'string') def.foes[s.index] = { type: s.item, at };
  else s.item.at = at;
}
// Point a foe or the start at a bearing, in 5° steps.
export function faceTo(def, id, bearing) {
  const f = ((Math.round(bearing / 5) * 5) % 360 + 360) % 360;
  if (id === 'start') { def.start = [...(def.start || [0, 0]).slice(0, 2), f]; return; }
  const s = findSource(def, id);
  if (s?.list !== 'foes') return;
  if (typeof s.item === 'string') def.foes[s.index] = { type: s.item, face: f };
  else s.item.face = f;
}
// A new thing at (x, z): what the palette's button makes. Returns its id.
export function place(def, tool, x, z) {
  const at = roundPolar(toPolar(x, z));
  def.foes = def.foes || [];
  if (tool === 'FOE') { def.foes.push({ type: 'jackal', at }); return `foes.${def.foes.length - 1}`; }
  const kind = { STRUCTURE: 'structure', TURRET: 'turret', VEHICLE: 'vehicle', NAV: 'nav', PAD: 'pad' }[tool];
  if (!kind) return null;
  const ents = def.entities = def.entities || [], base = NEW_ID[kind];
  let n = 1;
  while (ents.some(e => e.id === `${base}${n}`)) n++;
  const id = `${base}${n}`;
  const shape = { structure: SHAPES.RELAY, turret: SHAPES.LAUNCHER, vehicle: SHAPES.TRUCK, pad: SHAPES.PAD, nav: { kind: 'nav' } }[kind];
  const e = { ...JSON.parse(JSON.stringify(shape)), id, at };   // the shapes it uses have no Infinity in them
  if (kind === 'vehicle') e.path = [[...at], [at[0], at[1] + 200]];
  ents.push(e);
  return `entities.${id}`;
}
// Take things out. The start goes back to the map's centre.
export function remove(def, ids) {
  const foes = ids.filter(id => id.startsWith('foes.')).map(id => +id.split('.')[1]).sort((a, b) => b - a);
  for (const i of foes) def.foes.splice(i, 1);
  const gone = new Set(ids.filter(id => id.startsWith('entities.')).map(id => findSource(def, id)?.item).filter(Boolean));
  if (def.entities) def.entities = def.entities.filter(e => !gone.has(e));
  if (ids.includes('start')) delete def.start;
}
// A vehicle's route, and every vehicle that drives the same one (a convoy).
export function routeOf(def, id) {
  const s = findSource(def, id);
  if (s?.item?.kind !== 'vehicle' || !Array.isArray(s.item.path)) return null;
  const key = JSON.stringify(s.item.path);
  return { path: s.item.path, vehicles: def.entities.filter(e => e.kind === 'vehicle' && JSON.stringify(e.path) === key) };
}
export function setRoute(def, id, path) {
  const r = routeOf(def, id);
  if (r) for (const v of r.vehicles) v.path = path.map(p => [...p]);
}

export function createEditor(app) {
  const G = app.G, wrap = app.wrap, params = app.params;
  const missionKeys = MISSIONS.map(m => m.key);
  const key0 = params.get('mission') || store.get('edit.key', 'm01');
  const E = { key: missionKeys.includes(key0) ? key0 : 'm01', def: null, cam: createTopCamera(), sel: new Set(), box: null, map: null, tool: null, drag: null, sight: null, note: '' };
  app.ov.hidden = true;

  // The page: a surface for the gestures, the panel on the right and the palette along the bottom.
  const root = document.createElement('div');
  root.className = 'ed';
  root.innerHTML = `
    <div class="ed-surface"></div>
    <div class="ed-panel">
      <div class="ed-title">EDITOR</div>
      <div class="ed-acts"><button data-act="play">PLAY</button><button data-act="export">EXPORT</button><button data-act="import">IMPORT</button></div>
      <select class="ed-mission" aria-label="Mission">${MISSIONS.map(m => `<option value="${m.key}">${m.key.toUpperCase()}${m.name ? ` · ${esc(m.name)}` : ''}</option>`).join('')}<option value="new">NEW MISSION</option></select>
      <div class="ed-sel"></div>
      <div class="ed-mis"></div>
      <div class="ed-objs"></div>
      <div class="ed-waves"></div>
    </div>
    <div class="ed-problems"></div>
    <div class="ed-io" hidden>
      <p class="ed-head ed-io-title"></p>
      <textarea class="ed-io-text" spellcheck="false" aria-label="Mission source"></textarea>
      <p class="ed-io-msg"></p>
      <div class="ed-row"><button data-io="copy">COPY</button><button data-io="import">IMPORT</button><button data-io="close">CLOSE</button></div>
    </div>
    <div class="ed-tools">${TOOLS.map(t => `<button class="ed-tool" data-tool="${t}">${t}</button>`).join('')}<button class="ed-tool ed-del" data-act="delete">DELETE</button></div>`;
  wrap.appendChild(root);
  const surface = root.querySelector('.ed-surface'), selBox = root.querySelector('.ed-sel'), misBox = root.querySelector('.ed-mis'), pick = root.querySelector('.ed-mission');
  const toolBar = root.querySelector('.ed-tools'), objBox = root.querySelector('.ed-objs'), waveBox = root.querySelector('.ed-waves');
  const probBox = root.querySelector('.ed-problems'), io = root.querySelector('.ed-io'), ioText = io.querySelector('.ed-io-text'), ioMsg = io.querySelector('.ed-io-msg');
  pick.addEventListener('change', () => load(pick.value));
  root.querySelector('.ed-acts').addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'play') play();
    else if (a === 'export') openIO('export');
    else if (a === 'import') openIO('import');
  });
  toolBar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'delete') { deleteSel(); return; }
    E.tool = E.tool === b.dataset.tool ? null : b.dataset.tool;
    if (E.tool === 'ROUTE' && !selectedRoute()) { E.tool = null; E.note = 'SELECT A VEHICLE FIRST.'; }
    else E.note = '';
    showSel();
  });

  // A mission from missions.js, or a new one, as the working copy.
  function load(key) {
    useDef(key === 'new' ? blankMission() : fresh(MISSIONS.find(m => m.key === key)));
  }
  function useDef(def) {
    E.def = def; E.key = def.key || 'new';
    store.set('edit.key', E.key);
    pick.value = missionKeys.includes(E.key) ? E.key : 'new';
    E.sel.clear(); E.tool = null; E.sight = null; E.note = '';
    save(); rebuild(); frame();
  }
  // A new mission: the next free key, a random seed, one foe to stomp.
  function blankMission() {
    let n = MISSIONS.length + 1;
    while (missionKeys.includes(`m${n}`)) n++;
    return { key: `m${n}`, pal: 'dusk', seed: 1 + Math.floor(Math.random() * 99999), foes: [{ type: 'jackal', at: [0, 500] }], objectives: [{ type: 'eliminate' }], intel: '' };
  }
  // The working copy survives a reload (and PLAY): kept as its export text.
  const save = () => store.set('edit.work', { key: E.def.key, src: toSource(E.def) });
  function restore() {
    const w = store.get('edit.work', null), want = params.get('mission');
    if (!w?.src || (want && want !== w.key)) return null;
    try { return fromSource(w.src); } catch { return null; }
  }
  // The world from the working copy: the game's own start, in daylight and
  // clear weather so everything can be seen, and the sim never stepped.
  function rebuild() {
    const view = { ...E.def, time: 'day' };
    delete view.ramp; delete view.weather;
    G.diff = app.prefs.diff;
    startMatch(G, view, E.def.seed ?? 7, false, app.prefs.chassis);
    G.state = 'edit'; G.kind = 'edit';
    app.scene.uploadWorld();
    E.map = mapThings(E.def, G);
    for (const id of [...E.sel]) if (!E.map.things.some(t => t.id === id)) E.sel.delete(id);
    showSel(); showMission(); showLists(); showProblems();
  }
  // After an edit: the world again, keeping the camera where it is.
  const edited = () => { E.sight = null; save(); rebuild(); };

  // Fit the mission on the screen: every thing and route point in the part
  // of it the panel and the palette leave free, found by halving the distance.
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
  // The screen less the panel, the palette and a margin.
  function freeArea(W, H) {
    const wr = wrap.getBoundingClientRect(), r = root.querySelector('.ed-panel').getBoundingClientRect(), tb = toolBar.getBoundingClientRect(), m = 28;
    const x1 = r.width && r.left - wr.left > W / 2 ? r.left - wr.left - m : W - m;
    const y1 = tb.height ? tb.top - wr.top - m : H - m - 16;
    return { x0: m, x1, y0: m, y1 };
  }

  const size = () => ({ W: Math.max(1, wrap.clientWidth), H: Math.max(1, wrap.clientHeight) });
  const ground = (sx, sy) => { const { W, H } = size(); return screenToGround(E.cam, sx, sy, W, H, G.ter.height); };
  const mpp = () => metresPerPixel(E.cam, size().H);
  const toScreen = t => { const { W, H } = size(); return groundToScreen(E.cam, { x: t.x, y: t.y ?? G.ter.height(t.x, t.z), z: t.z }, W, H); };
  const pickables = () => E.map.things.map(t => ({ id: t.id, x: t.x, z: t.z, r: t.r }));
  const thingAt = (x, y) => { const g = ground(x, y); return g && pickNearest(pickables(), g.x, g.z, FINGER * mpp()); };
  const after = () => { settle(E.cam, BOUND, G.ter.height); };
  const one = () => (E.sel.size === 1 ? E.map.things.find(t => t.id === [...E.sel][0]) : null);
  // The selected vehicle's route on the map, if a vehicle is selected.
  function selectedRoute() {
    const t = one(), mine = t?.kind === 'vehicle' && routeOf(E.def, t.id);
    return mine ? E.map.routes.find(r => JSON.stringify(routeOf(E.def, r.owner)?.path) === JSON.stringify(mine.path)) : null;
  }
  // The facing handle of the selected foe or start, on the screen.
  function handle() {
    const t = one();
    if (!t || (t.kind !== 'foe' && t.kind !== 'start') || t.face == null) return null;
    const a = toScreen(t), b = toScreen({ x: t.x - Math.sin(t.face * D2R) * 10, z: t.z + Math.cos(t.face * D2R) * 10 });
    if (!a || !b) return null;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return { t, at: a, x: a[0] + Math.cos(ang) * HANDLE, y: a[1] + Math.sin(ang) * HANDLE };
  }
  const routePointAt = (r, x, y) => r.pts.findIndex(p => { const s = toScreen(p); return s && Math.hypot(s[0] - x, s[1] - y) < FINGER; });

  bindPointer(surface, {
    tap(x, y) {
      const g = ground(x, y);
      if (!g) return;
      if (E.tool === 'ROUTE') {
        const r = selectedRoute();
        if (!r) { E.tool = null; showSel(); return; }
        const path = routeOf(E.def, r.owner).path.map(p => [...p]), k = routePointAt(r, x, y);
        if (k >= 0) { if (path.length > 1) path.splice(k, 1); }
        else path.push(roundPolar(toPolar(g.x, g.z)));
        setRoute(E.def, r.owner, path);
        edited();
        return;
      }
      if (E.tool) {
        const id = place(E.def, E.tool, g.x, g.z);
        E.tool = null;
        E.sel = new Set(id ? [id] : []);
        edited();
        return;
      }
      const hit = thingAt(x, y);
      E.sel = new Set(hit ? [hit.id] : []);
      E.note = '';
      showSel();
    },
    dragStart(x, y) {
      const hd = handle();
      if (hd && Math.hypot(hd.x - x, hd.y - y) < FINGER) { E.drag = { kind: 'face', id: hd.t.id }; return; }
      const r = E.tool === 'ROUTE' && selectedRoute(), k = r ? routePointAt(r, x, y) : -1;
      if (k >= 0) { E.drag = { kind: 'point', route: r, k }; return; }
      const hit = thingAt(x, y), g = ground(x, y);
      if (hit && g) {
        if (!E.sel.has(hit.id)) { E.sel = new Set([hit.id]); showSel(); }
        const moving = E.map.things.filter(t => E.sel.has(t.id));
        E.drag = { kind: 'move', from: g, orig: moving.map(t => ({ t, x: t.x, z: t.z })) };
        return;
      }
      E.box = [x, y, x, y];
    },
    drag(x, y) {
      const d = E.drag, g = ground(x, y);
      if (E.box) { E.box[2] = x; E.box[3] = y; return; }
      if (!d || !g) return;
      if (d.kind === 'move') for (const o of d.orig) { o.t.x = o.x + g.x - d.from.x; o.t.z = o.z + g.z - d.from.z; o.t.y = G.ter.height(o.t.x, o.t.z); }
      else if (d.kind === 'face') { const t = E.map.things.find(q => q.id === d.id); t.face = toPolar(g.x - t.x, g.z - t.z)[0]; }
      else if (d.kind === 'point') Object.assign(d.route.pts[d.k], { x: g.x, z: g.z, y: G.ter.height(g.x, g.z) });
    },
    dragEnd() {
      const b = E.box, d = E.drag;
      E.box = null; E.drag = null;
      if (b) {
        const corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => ground(x, y));
        if (corners.some(c => !c)) return;
        E.sel = new Set(pickInside(pickables(), corners.map(c => [c.x, c.z])).map(t => t.id));
        showSel();
        return;
      }
      if (!d) return;
      if (d.kind === 'move') for (const o of d.orig) moveTo(E.def, o.t.id, o.t.x, o.t.z);
      else if (d.kind === 'face') { const t = E.map.things.find(q => q.id === d.id); faceTo(E.def, d.id, t.face); }
      else if (d.kind === 'point') {
        const path = routeOf(E.def, d.route.owner).path.map(p => [...p]), p = d.route.pts[d.k];
        path[d.k] = roundPolar(toPolar(p.x, p.z));
        setRoute(E.def, d.route.owner, path);
      }
      edited();
    },
    dragCancel() { E.box = null; if (E.drag) { E.drag = null; E.map = mapThings(E.def, G); } },
    longPress(x, y) { const hit = thingAt(x, y); if (hit?.id.startsWith('foes.')) { E.sel = new Set([hit.id]); showSel(); showSight(hit.id); } },
    longEnd() { E.sight = null; },
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
    else if (e.code === 'KeyL') { const t = one(); if (E.sight) E.sight = null; else if (t?.kind === 'foe') showSight(t.id); }
    else if (e.code === 'Delete' || e.code === 'Backspace') deleteSel();
    else if (e.code === 'Escape') { E.tool = null; E.sel.clear(); E.sight = null; showSel(); }
    else return;
    e.preventDefault(); after();
  });

  // What a foe sees from where it stands: the AI's own test, out to its sight
  // range at this difficulty, in daylight.
  function showSight(id) {
    const i = +id.split('.')[1], m = G.mechs.filter(x => x.team !== 0)[i];
    if (!m) return;
    const range = diffOf(G).sight, cell = 30;
    E.sight = { id, range, cell, from: { x: m.x, z: m.z }, cells: sightGrid(G, eyeOf(m), range, { cell }) };
  }
  function deleteSel() {
    if (!E.sel.size) return;
    remove(E.def, [...E.sel]);
    E.sel.clear();
    edited();
  }

  // ---- The panel ----

  // A field: [key, label, kind ('text', 'num', 'sel'), options]. Setting one
  // edits the mission and rebuilds the world.
  const FOE_FIELDS = [
    ['type', 'MECH', 'sel', MECH_ORDER.map(k => [k, NAMES.chassis[k]])],
    ['profile', 'STYLE', 'sel', [['', 'ITS OWN'], ...Object.keys(PROFILES).map(k => [k, k.toUpperCase()])]],
    ['aware', 'AWAKE', 'sel', [['', 'MAYBE'], ['true', 'YES'], ['false', 'NO']]],
    ['face', 'FACING °', 'num'],
  ];
  const ENTITY_FIELDS = [
    ['id', 'ID', 'text'], ['label', 'LABEL', 'text'], ['tags', 'TAGS', 'text'],
    ['kind', 'KIND', 'sel', [['structure', 'STRUCTURE'], ['turret', 'TURRET'], ['vehicle', 'VEHICLE'], ['nav', 'NAV']]],
    ['mesh', 'LOOK', 'sel', [['', 'NONE'], ...MESHES.map(m => [m, m.toUpperCase()])]],
    ['height', 'HEIGHT', 'num'], ['radius', 'RADIUS', 'num'], ['hp', 'HP', 'text'], ['pad', 'FLAT PAD', 'num'],
  ];
  const VEHICLE_FIELDS = [['speed', 'SPEED', 'num']];
  const START_FIELDS = [['face', 'FACING °', 'num']];
  function fieldRow([k, label, kind, opts], v) {
    const val = v == null ? '' : Array.isArray(v) ? v.join(', ') : v === Infinity ? 'Infinity' : String(v);
    const input = kind === 'sel'
      ? `<select data-f="${k}">${opts.map(([o, l]) => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input data-f="${k}" ${kind === 'num' ? 'inputmode="decimal"' : ''} value="${esc(val)}">`;
    return `<label><span>${label}</span>${input}</label>`;
  }
  // A field's text back into the mission: blank removes it.
  function setField(item, k, kind, text) {
    const t = text.trim();
    if (t === '') { delete item[k]; return; }
    if (k === 'tags') item.tags = t.split(/[,\s]+/).filter(Boolean);
    else if (k === 'aware') item.aware = t === 'true';
    else if (k === 'hp') { const v = /^inf/i.test(t) ? Infinity : +t; if (!Number.isNaN(v)) item.hp = v; }
    else if (kind === 'num') { if (Number.isFinite(+t)) item[k] = +t; }
    else item[k] = t;
  }
  function showSel() {
    for (const b of toolBar.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === E.tool);
    toolBar.querySelector('.ed-del').disabled = !E.sel.size;
    const ids = [...E.sel];
    let html = E.note ? `<p class="ed-note">${esc(E.note)}</p>` : '';
    if (E.tool === 'ROUTE') html += '<p class="ed-hint">TAP TO ADD A POINT. TAP A POINT TO TAKE IT AWAY. DRAG A POINT TO MOVE IT.</p>';
    else if (E.tool) html += `<p class="ed-hint">TAP THE GROUND. A NEW ${E.tool} GOES THERE.</p>`;
    if (!ids.length) { selBox.innerHTML = html + (E.tool ? '' : '<p class="ed-hint">TAP A THING. DRAG IT TO MOVE IT. DRAG THE GROUND TO BOX MANY. TWO FINGERS MOVE THE MAP. HOLD A FOE TO SEE WHAT IT SEES.</p>'); return; }
    if (ids.length > 1) { selBox.innerHTML = html + `<p>${ids.length} THINGS</p><ul>${ids.map(id => `<li>${esc(titleOf(id))}</li>`).join('')}</ul>`; return; }
    const id = ids[0], src = findSource(E.def, id), t = one();
    let fields = [];
    if (id === 'start') fields = START_FIELDS;
    else if (src?.list === 'foes') fields = FOE_FIELDS;
    else if (src?.list === 'entities') fields = [...ENTITY_FIELDS, ...(src.item.kind === 'vehicle' ? VEHICLE_FIELDS : [])];
    const item = id === 'start' ? { face: E.def.start?.[2] } : typeof src?.item === 'string' ? { type: src.item } : src?.item || {};
    const at = id === 'start' ? E.def.start : item.at;
    html += `<p>${esc(titleOf(id))}${at ? ` <span class="ed-at">${at[0]}° ${at[1]} m</span>` : ''}</p><div class="ed-fields" data-for="${esc(id)}">${fields.map(f => fieldRow(f, item[f[0]])).join('')}</div>`;
    if (t?.kind === 'vehicle') html += `<p class="ed-hint">ITS ROUTE HAS ${routeOf(E.def, id)?.path.length || 0} POINTS. ROUTE CHANGES IT.</p>`;
    if (t?.kind === 'foe') html += '<p class="ed-hint">HOLD IT (OR L) TO SEE WHAT IT SEES.</p>';
    selBox.innerHTML = html;
  }
  selBox.addEventListener('change', e => {
    const f = e.target.closest('[data-f]'), box = e.target.closest('[data-for]');
    if (!f || !box) return;
    const id = box.dataset.for, k = f.dataset.f, spec = [...FOE_FIELDS, ...ENTITY_FIELDS, ...VEHICLE_FIELDS].find(x => x[0] === k);
    if (id === 'start') { if (k === 'face') faceTo(E.def, 'start', +f.value || 0); }
    else {
      const s = findSource(E.def, id);
      if (!s) return;
      if (s.list === 'foes' && typeof s.item === 'string') { E.def.foes[s.index] = { type: s.item }; s.item = E.def.foes[s.index]; }
      setField(s.item, k, spec?.[2] || 'text', f.value);
      if (k === 'id' && s.list === 'entities') E.sel = new Set([entityId(s.item, s.index)]);
    }
    edited();
  });

  // The mission's own fields: the ground, the look and the words.
  const PAL_KEYS = Object.keys(PALS), WX = ['', ...Object.keys(WEATHER).filter(k => k !== 'clear')], TIMES = [['', 'ITS OWN'], ['night', 'NIGHT'], ['dawn', 'DAWN']];
  function showMission() {
    const d = E.def, sel = (k, opts, v) => `<select data-m="${k}">${opts.map(([o, l]) => `<option value="${o}"${o === (v ?? '') ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    misBox.innerHTML = `<p class="ed-head">MISSION</p>
      <label><span>KEY</span><input data-m="key" value="${esc(d.key || '')}"></label>
      <label><span>SEED</span><span class="ed-row"><input data-m="seed" inputmode="numeric" value="${esc(d.seed ?? '')}"><button data-m="reroll">REROLL</button></span></label>
      <label><span>MAP</span>${sel('pal', PAL_KEYS.map(k => [k, k.toUpperCase()]), d.pal)}</label>
      <label><span>WEATHER</span>${sel('weather', WX.map(k => [k, k ? k.toUpperCase() : 'CLEAR']), d.weather)}</label>
      <label><span>TIME</span>${sel('time', TIMES, d.time)}</label>
      <label><span>GETS DARK</span>${sel('rampTo', [['', 'NO'], ['night', 'TO NIGHT'], ['dawn', 'TO DAWN']], d.ramp?.[1])}</label>
      <label><span>OVER (S)</span><input data-m="rampSecs" inputmode="numeric" value="${esc(d.ramp?.[2] ?? '')}"></label>
      <label><span>INTEL</span><textarea data-m="intel" rows="3">${esc(d.intel || '')}</textarea></label>`;
  }
  misBox.addEventListener('change', e => {
    const f = e.target.closest('[data-m]');
    if (!f || f.tagName === 'BUTTON') return;
    const d = E.def, v = f.value.trim(), k = f.dataset.m;
    if (k === 'seed') { if (Number.isFinite(+v) && v !== '') d.seed = Math.round(+v); }
    else if (k === 'key') { if (/^[a-z0-9_]+$/i.test(v)) d.key = v; }
    else if (k === 'rampTo' || k === 'rampSecs') {
      const to = k === 'rampTo' ? v : d.ramp?.[1], secs = k === 'rampSecs' ? +v : d.ramp?.[2] ?? 240;
      if (to) d.ramp = [d.ramp?.[0] || d.time || 'dusk', to, Number.isFinite(secs) && secs > 0 ? secs : 240]; else delete d.ramp;
    } else if (v) d[k] = v; else delete d[k];
    edited();
  });
  misBox.addEventListener('click', e => {
    if (e.target.dataset?.m !== 'reroll') return;
    E.def.seed = 1 + Math.floor(Math.random() * 99999);
    edited();
  });
  // ---- Objectives and waves: ordered lists, each item its own fields ----

  // A field by its path in the mission ('objectives.1.waves.0.from'), with
  // how to read the text back: [key, label, kind, options].
  const OBJ_TYPES = ['eliminate', 'destroy', 'protect', 'survive', 'extract', 'escort'];
  const ids = () => (E.def.entities || []).filter(e => e.id != null).map(e => [e.id, e.id]);
  const objFields = o => [
    ['type', 'TYPE', 'sel', OBJ_TYPES.map(t => [t, t.toUpperCase()])],
    ['label', 'LABEL', 'text'],
    ...(o.type === 'destroy' || o.type === 'protect' ? [['targets', 'TAGS', 'list']] : []),
    ...(o.type === 'protect' || o.type === 'escort' ? [['minAlive', 'KEEP', 'num']] : []),
    ...(o.type === 'survive' ? [['seconds', 'SECONDS', 'num']] : []),
    ...(o.type === 'extract' ? [['at', 'PAD', 'sel', [['', '-'], ...ids()]], ['within', 'IN (S)', 'num']] : []),
    ...(o.type === 'escort' ? [['convoy', 'CONVOY TAG', 'text'], ['to', 'TO', 'sel', [['', '-'], ...ids()]]] : []),
    ['after', 'AFTER OBJ', 'obj'],
    ['secondary', 'OPTIONAL', 'sel', [['', 'NO'], ['true', 'YES']]],
  ];
  const WAVE_FIELDS = [['at', 'AT (S)', 'num'], ['when', 'AFTER OBJ', 'when'], ['done', 'WHEN DONE', 'done'], ['foes', 'MECHS', 'list'], ['from', 'FROM', 'from'], ['dist', 'DIST', 'num'], ['reveal', 'REVEAL', 'num']];
  // What a field shows: objective numbers count from 1 on the screen.
  function shown(item, [k, , kind]) {
    if (kind === 'obj') return item.after == null ? '' : item.after + 1;
    if (kind === 'when') return item.when ? item.when.obj + 1 : '';
    if (kind === 'done') return item.when?.done ?? '';
    return item[k];
  }
  function row(path, item, f) {
    const [k, label, kind, opts] = f, v = shown(item, f), val = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    const input = kind === 'sel'
      ? `<select data-p="${path}" data-k="${k}" data-kind="sel">${opts.map(([o, l]) => `<option value="${esc(o)}"${String(o) === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input data-p="${path}" data-k="${k}" data-kind="${kind}" value="${esc(val)}"${kind === 'text' || kind === 'list' || kind === 'from' ? '' : ' inputmode="decimal"'}>`;
    return `<label><span>${label}</span>${input}</label>`;
  }
  const itemBar = (path, n, len) => `<span class="ed-item-bar"><button data-move="${path}" data-d="-1"${n ? '' : ' disabled'} aria-label="Up">▲</button><button data-move="${path}" data-d="1"${n < len - 1 ? '' : ' disabled'} aria-label="Down">▼</button><button data-drop="${path}" aria-label="Remove">✕</button></span>`;
  const waveBlock = (w, path, n, len) => `<div class="ed-item" data-anchor="${path}"><p>WAVE ${n + 1}${itemBar(path, n, len)}</p><div class="ed-fields">${WAVE_FIELDS.map(f => row(path, w, f)).join('')}</div></div>`;
  function showLists() {
    const objs = E.def.objectives || [], waves = E.def.waves || [];
    objBox.innerHTML = `<p class="ed-head">OBJECTIVES</p>${objs.map((o, n) => {
      const path = `objectives.${n}`, inner = o.type === 'survive' ? (o.waves || []).map((w, k) => waveBlock(w, `${path}.waves.${k}`, k, o.waves.length)).join('') + `<button class="ed-add" data-add="${path}.waves">ADD A WAVE</button>` : '';
      return `<div class="ed-item" data-anchor="${path}"><p>${n + 1}. ${esc(o.type.toUpperCase())}${itemBar(path, n, objs.length)}</p><div class="ed-fields">${objFields(o).map(f => row(path, o, f)).join('')}</div>${inner}</div>`;
    }).join('')}<button class="ed-add" data-add="objectives">ADD AN OBJECTIVE</button>`;
    waveBox.innerHTML = `<p class="ed-head">WAVES</p>${waves.map((w, k) => waveBlock(w, `waves.${k}`, k, waves.length)).join('')}<button class="ed-add" data-add="waves">ADD A WAVE</button>`;
  }
  // The list a path names, and the index in it: 'objectives.0.waves.2' → [the waves, 2].
  function listAt(path) {
    const parts = path.split('.'), last = +parts.pop();
    let o = E.def;
    for (const p of parts) o = o?.[p];
    return [o, last];
  }
  function itemAt(path) { const [list, i] = listAt(path); return list?.[i]; }
  // A field's text back into an objective or a wave: blank removes it.
  function setPath(item, k, kind, text) {
    const t = text.trim();
    if (kind === 'when' || kind === 'done') {
      const obj = kind === 'when' ? +t - 1 : item.when?.obj ?? 0, done = kind === 'done' ? +t : item.when?.done ?? 1;
      if (kind === 'when' && t === '') delete item.when;
      else if (Number.isFinite(obj) && Number.isFinite(done)) { item.when = { obj, done }; delete item.at; }
      return;
    }
    if (t === '') { delete item[k]; return; }
    if (kind === 'obj') { if (Number.isFinite(+t) && +t >= 1) item.after = +t - 1; }
    else if (kind === 'list') item[k] = t.split(/[,\s]+/).filter(Boolean);
    else if (kind === 'from') item.from = Number.isFinite(+t) ? +t : t;
    else if (kind === 'num') { if (Number.isFinite(+t)) { item[k] = +t; if (k === 'at') delete item.when; } }
    else if (k === 'secondary') item.secondary = true;
    else item[k] = t;
  }
  for (const box of [objBox, waveBox]) {
    box.addEventListener('change', e => {
      const f = e.target.closest('[data-p]');
      if (!f) return;
      const item = itemAt(f.dataset.p);
      if (!item) return;
      setPath(item, f.dataset.k, f.dataset.kind, f.value);
      edited();
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.add) {
        const parts = b.dataset.add.split('.'), key = parts.pop();
        let o = E.def;
        for (const p of parts) o = o[p];
        o[key] = o[key] || [];
        o[key].push(key === 'objectives' ? { type: 'eliminate' } : { at: 30, foes: ['jackal'], from: 0 });
      } else if (b.dataset.move) {
        const [list, i] = listAt(b.dataset.move), j = i + +b.dataset.d;
        if (!list || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
      } else if (b.dataset.drop) {
        const [list, i] = listAt(b.dataset.drop);
        list?.splice(i, 1);
      } else return;
      edited();
    });
  }

  // ---- Problems: in plain words, as they appear; a tap shows what it is about ----
  function showProblems() {
    const ps = check(E.def);
    probBox.hidden = !ps.length;
    probBox.innerHTML = ps.length ? `<p class="ed-head">PROBLEMS</p>${ps.map(p => `<button data-pid="${esc(p.id)}">${esc(p.text)}</button>`).join('')}` : '';
  }
  probBox.addEventListener('click', e => {
    const id = e.target.closest('[data-pid]')?.dataset.pid;
    if (!id) return;
    if (id === 'start' || id.startsWith('foes.') || id.startsWith('entities.')) { E.sel = new Set([id]); showSel(); return; }
    const el = id === 'key' ? misBox.querySelector('[data-m="key"]') : root.querySelector(`[data-anchor="${id}"]`) || root.querySelector(`[data-anchor="${id.split('.').slice(0, 2).join('.')}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('ed-flash');
    setTimeout(() => el.classList.remove('ed-flash'), 900);
    if (el.tagName === 'INPUT') el.focus();
  });

  // ---- Export and import: missions.js's own JS, in a box for phones with no clipboard ----
  function openIO(mode) {
    io.hidden = false; io.dataset.mode = mode;
    io.querySelector('.ed-io-title').textContent = mode === 'export' ? 'EXPORT' : 'IMPORT';
    io.querySelector('[data-io="copy"]').hidden = mode !== 'export';
    io.querySelector('[data-io="import"]').hidden = mode !== 'import';
    ioMsg.textContent = '';
    if (mode === 'export') {
      ioText.value = toSource(E.def);
      const ps = check(E.def);
      ioMsg.textContent = ps.length ? `${ps.length === 1 ? 'ONE PROBLEM' : `${ps.length} PROBLEMS`}. IT STILL EXPORTS.` : 'PASTE IT INTO MISSIONS.JS.';
      copy();
    } else { ioText.value = ''; ioText.focus(); }
  }
  function copy() {
    ioText.select();
    navigator.clipboard?.writeText(ioText.value).then(() => { ioMsg.textContent = `COPIED. ${ioMsg.textContent}`; }, () => {});
  }
  io.addEventListener('click', e => {
    const a = e.target.closest('[data-io]')?.dataset.io;
    if (a === 'close') io.hidden = true;
    else if (a === 'copy') copy();
    else if (a === 'import') {
      try { useDef(fromSource(ioText.value)); io.hidden = true; } catch (err) { ioMsg.textContent = err.message.toUpperCase(); }
    }
  });

  // ---- PLAY and back: the mission as the campaign would start it, in single player ----
  function play() {
    save();
    const def = { ...fresh(E.def), name: NAMES.missions[E.def.key] || String(E.def.key || 'NEW').toUpperCase() };
    G.diff = app.prefs.diff;
    startMatch(G, def, def.seed ?? 7, false, app.prefs.chassis, { loadout: fitOf(app.prefs.chassis) });
    G.kind = 'edit'; G.mode = 'sp';
    app.scene.uploadWorld();
    root.hidden = true; io.hidden = true;
    app.ui.launch();
  }
  // From the pause menu, the debrief or F2: the editor as it was.
  function back() {
    app.input.exitLock();
    app.ov.hidden = true;
    G.paused = false; G.guide = null; G.tut = null;
    root.hidden = false;
    rebuild();
    app.input.syncTouchUI();
  }

  const titleOf = id => E.map.things.find(t => t.id === id)?.label || id;

  // A frame: the 3D world from above, then the markers over it.
  function draw() {
    const { W, H } = size(), dpr = app.scene.view.dpr || 1, ctx = app.ctx, pal = hudPalette(app.prefs.colourMode);
    app.scene.render();
    const VP = camView(E.cam, W / H).VP;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = { W, H, mpp: mpp(), toScreen: (x, y, z) => groundToScreen(E.cam, { x, y, z }, W, H, VP) };
    const sel = new Set(E.sel), r = E.tool === 'ROUTE' && selectedRoute();
    if (r) sel.add(r.id);
    drawMap(ctx, view, { map: { bound: BOUND, height: G.ter.height, grid: 100 }, ...E.map, sel, box: E.box, pal, sight: E.sight });
    const hd = handle();
    if (hd) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hd.at[0], hd.at[1]); ctx.lineTo(hd.x, hd.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hd.x, hd.y, 6, 0, 7); ctx.fill();
    }
    drawCompass(ctx, 34, freeArea(W, H).y1 - 6, E.cam.yaw, pal);
  }
  // What the renderer asks for in the editor: the overhead camera.
  app.topView = () => { const { W, H } = size(), v = camView(E.cam, W / H); return { eye: v.eye, dir: v.dir, fov: v.fov, near: v.near, far: v.far }; };

  const kept = restore();
  if (kept) useDef(kept); else load(E.key);
  return { E, draw, load, frame, toScreen, handle, play, back, selectIds: ids => { E.sel = new Set(ids); showSel(); } };
}
