import { NAMES } from '../data/names.js';
import { hudPalette } from '../data/colors.js';
import { RADAR_RANGE, radarOf } from '../data/weather.js';
import { BOUND } from '../world/terrain.js';
import { TOP, createTopCamera, camView, groundToScreen, screenToGround, panBy, zoomAt, rotateAbout, settle, metresPerPixel } from '../render/topCamera.js';
import { drawMap, drawCompass } from '../render/markers.js';
import { bindPointer } from '../input/pointer.js';
import { pickNearest, pickInside } from '../sim/pick.js';
import { crewOf, canCommand, commandUp, commandDown } from '../sim/crew.js';
import { give, can } from '../sim/orders.js';

// The command view (docs/specs/22-command-view.md): the match from above
// while the world runs on. MAP (Tab) goes up, BACK comes down into the mech
// you left, DRIVE into the one you picked. Tap a crew mech to pick it, drag
// a box round several. Then the order bar: GO, DIG or FOLLOW and a tap on
// the ground (or a digger), or STAY or WORK at once; a bare tap on the
// ground with mechs picked is GO (sim/orders.js). Two fingers (or the right
// button and the wheel) pan, pinch and twist, as in the mission editor,
// whose camera, gestures, picking and markers this reuses. The sim side
// (going up and down) is sim/crew.js; this file is only the page.
export const COMMAND = { across: 400, finger: 28 };   // m of ground across the screen when you go up; px a tap reaches

const D2R = Math.PI / 180;
// A building's label on the map; a site (docs/specs/23-construction-sites.md) says so, with its ore.
const siteLabel = e => { const n = NAMES.buildings[e.tags?.find(t => NAMES.buildings[t])] || ''; return e.site ? `${n} SITE · ORE ${Math.floor(e.site.ore)}/${e.site.need}` : n; };
export const BAR = ['go', 'dig', 'follow', 'stay', 'work', 'drive'];   // the order bar, in order (keys 1–6)

export function createCommand(app) {
  const G = app.G, wrap = app.wrap;
  const root = document.createElement('div');
  root.className = 'cmd'; root.hidden = true;
  root.innerHTML = `
    <div class="cmd-surface"></div>
    <button class="cmd-btn cmd-back" data-c="back">BACK</button>
    <div class="cmd-bar">${BAR.map(k => `<button class="cmd-btn" data-c="${k}" hidden>${k.toUpperCase()}</button>`).join('')}</div>`;
  wrap.insertBefore(root, app.ov);
  const surface = root.querySelector('.cmd-surface'), btn = Object.fromEntries(BAR.map(k => [k, root.querySelector(`[data-c="${k}"]`)]));
  const C = { cam: null, picked: new Set(), box: null, order: null };   // order: GO, DIG or FOLLOW chosen, waiting for its tap

  const size = () => ({ W: Math.max(1, wrap.clientWidth), H: Math.max(1, wrap.clientHeight) });
  const mpp = () => metresPerPixel(C.cam, size().H);
  const ground = (sx, sy) => { const { W, H } = size(); return screenToGround(C.cam, sx, sy, W, H, G.ter.height); };
  const after = () => settle(C.cam, BOUND, G.ter.height);
  const live = () => crewOf(G).filter(m => m.alive);
  const crewAt = (sx, sy) => {
    const g = ground(sx, sy);
    return g && pickNearest(live().map(m => ({ id: m, x: m.x, z: m.z, r: 4 * m.ch.scale })), g.x, g.z, COMMAND.finger * mpp())?.id;
  };
  // The order bar shows what the picked mechs can do; DRIVE with exactly one.
  const sync = () => {
    for (const m of C.picked) if (!m.alive) C.picked.delete(m);
    const p = [...C.picked];
    for (const k of BAR) {
      const b = btn[k], show = k === 'drive' ? p.length === 1 : p.some(m => can(m, k));
      if (b.hidden !== !show) b.hidden = !show;
      b.classList.toggle('on', C.order === k);
    }
    if (C.order && btn[C.order].hidden) C.order = null;
  };
  const order = o => { give(G, [...C.picked], o); C.order = null; sync(); };
  // The bar's buttons (and keys 1–6, in the bar's order).
  function press(k) {
    if (btn[k].hidden) return;
    if (k === 'drive') { if (C.picked.size === 1) close([...C.picked][0]); return; }
    if (k === 'stay' || k === 'work') return order({ kind: k });
    C.order = C.order === k ? null : k;   // GO, DIG, FOLLOW: now tap where (or whom)
    sync();
  }
  // A tap: with an order chosen, where it goes; else a crew mech picks it,
  // and the ground, with mechs picked, is GO.
  function tapAt(x, y) {
    const m = crewAt(x, y), g = ground(x, y);
    if (C.order === 'follow') { if (m) order({ kind: 'follow', target: m }); return; }
    if (C.order && g) return order({ kind: C.order, x: g.x, z: g.z });
    if (m) { C.picked = new Set([m]); sync(); return; }
    if (g && C.picked.size) order({ kind: 'go', x: g.x, z: g.z });
  }

  // Up: the camera over the mech you were in, COMMAND.across metres of ground across the screen.
  function open() {
    if (!commandUp(G)) return false;
    const { W, H } = size(), m = G.command.from;
    C.cam = createTopCamera({ x: m.x, z: m.z, dist: COMMAND.across * H / (W * 2 * Math.tan(TOP.fov / 2)), yaw: m.yaw });
    after();
    C.picked = new Set(); C.box = null; C.order = null;
    app.input.releaseFingers(); app.input.clearHeld();
    app.input.exitLock();
    root.hidden = false;
    sync();
    app.input.syncTouchUI();
    app.audio.sfx.beep();
    return true;
  }
  // Down into `m`, or the mech you came up from.
  function close(m) {
    if (!commandDown(G, m)) return false;
    root.hidden = true;
    app.input.syncTouchUI(); app.input.syncWeaponButtons();
    app.input.lockPointer();
    return true;
  }
  const toggle = () => (G.command ? close() : open());

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    if (b.dataset.c === 'back') close();
    else press(b.dataset.c);
  });

  bindPointer(surface, {
    tap(x, y) { tapAt(x, y); },
    dragStart(x, y) { C.box = [x, y, x, y]; },
    drag(x, y) { if (C.box) { C.box[2] = x; C.box[3] = y; } },
    dragEnd(x, y, x0, y0) {
      C.box = null;
      const poly = [[x0, y0], [x, y0], [x, y], [x0, y]].map(([sx, sy]) => ground(sx, sy));
      if (poly.some(p => !p)) return;
      C.picked = new Set(pickInside(live().map(m => ({ id: m, x: m.x, z: m.z })), poly.map(p => [p.x, p.z])).map(t => t.id));
      sync();
    },
    dragCancel() { C.box = null; },
    pan(dx, dy) { panBy(C.cam, dx, dy, size().H); after(); },
    pinch(f, x, y) { zoomAt(C.cam, f, ground(x, y)); after(); },
    twist(a, x, y) { rotateAbout(C.cam, a, ground(x, y)); after(); },
  });

  // What the renderer asks for while you're up: the overhead camera.
  function view() {
    if (!C.cam) return null;
    const { W, H } = size(), v = camView(C.cam, W / H);
    return { eye: v.eye, dir: v.dir, fov: v.fov, near: v.near, far: v.far };
  }

  // A frame's markers over the world from above: the crew (what each is up
  // to), the base's buildings, and foes where the radar would show them.
  function draw() {
    if (!G.command || !C.cam) return;
    sync();
    const { W, H } = size(), dpr = app.scene.view.dpr || 1, ctx = app.ctx, pal = hudPalette(app.prefs.colourMode);
    const VP = camView(C.cam, W / H).VP;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = { W, H, mpp: mpp(), toScreen: (x, y, z) => groundToScreen(C.cam, { x, y, z }, W, H, VP) };
    const crew = live(), reach = RADAR_RANGE * radarOf(G), things = [];
    for (const m of crew) things.push({ id: m, kind: 'start', x: m.x, y: m.y, z: m.z, face: -m.yaw / D2R, label: `${m === G.command.from ? '▶ ' : ''}${m.ch.name}${m.job ? ` · ${m.job}` : ''}` });
    for (const e of G.entities) if (e.alive && e.team === 0 && e.kind !== 'nav') things.push({ id: e, kind: 'structure', x: e.x, y: e.y, z: e.z, label: siteLabel(e) });
    for (const f of G.mechs) if (f.alive && f.team !== 0 && crew.some(m => Math.hypot(f.x - m.x, f.z - m.z) < reach)) things.push({ id: f, kind: 'foe', x: f.x, y: f.y, z: f.z, face: -f.yaw / D2R });
    drawMap(ctx, view, { map: { bound: BOUND, height: G.ter.height, grid: 100 }, things, sel: C.picked, box: C.box, pal });
    drawOrders(ctx, view, crew, pal);
    // The base, as the cockpit's panel has it.
    ctx.font = 'bold 11px "Lucida Console", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (G.base) { ctx.fillStyle = pal.good; ctx.fillText(`ORE ${G.base.ore}  SALVAGE ${G.base.salvage}`, 14, 22); }
    drawCompass(ctx, 34, H - 34, C.cam.yaw, pal);
  }

  // Each crew mech's order, from it: a line to a GO flag, to where a DIG
  // stands with a tick toward the face, or dashed to the digger a FOLLOW trails.
  function drawOrders(ctx, view, crew, pal) {
    const S = p => view.toScreen(p.x, p.y ?? G.ter.height(p.x, p.z), p.z);
    ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = pal.good;
    for (const m of crew) {
      const o = m.order, a = S(m);
      if (!o || o.kind === 'stay' || !a) continue;
      const b = S(o.kind === 'follow' ? o.target : o);
      if (!b) continue;
      ctx.setLineDash(o.kind === 'follow' ? [4, 5] : []);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.setLineDash([]);
      if (o.kind === 'go') { ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - 16); ctx.stroke(); ctx.fillRect(b[0], b[1] - 16, 9, 6); }
      else if (o.kind === 'dig') {
        const f = S({ x: o.x + Math.sin(o.yaw) * 8, z: o.z + Math.cos(o.yaw) * 8 });
        if (f) { ctx.beginPath(); ctx.arc(b[0], b[1], 4, 0, 7); ctx.moveTo(b[0], b[1]); ctx.lineTo(f[0], f[1]); ctx.stroke(); }
      }
    }
    ctx.restore();
  }

  const screenOf = m => { const { W, H } = size(); return C.cam && groundToScreen(C.cam, { x: m.x, y: m.y, z: m.z }, W, H); };   // where a mech is on the screen (the smoke test taps it)
  return { C, open, close, toggle, press, draw, view, screenOf, can: () => canCommand(G) };
}
