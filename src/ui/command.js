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
import { PLACE, PLACE_ORDER, BUILDINGS, CONSTRUCT, RECIPES, PARTS } from '../data/construct.js';
import { footprintAt, placeSite, snapWall, oreRoom, isoRoom, needsRepair } from '../sim/base.js';
import { territory } from '../sim/territory.js';
import { queueMake, bayAt, bayPart, thingsAt } from '../sim/production.js';

// The command view (docs/specs/22-command-view.md): the match from above
// while the world runs on. MAP (Tab) goes up, BACK comes down into the mech
// you left, DRIVE into the one you picked. Tap a crew mech to pick it, drag
// a box round several. Then the order bar: GO, DIG or FOLLOW and a tap on
// the ground (or a digger), or STAY or WORK at once; a bare tap on the
// ground with mechs picked is GO (sim/orders.js), on a site with diggers
// picked BUILD. With nothing picked, BUILD places a construction site
// (docs/specs/23-construction-sites.md): it cycles FACTORY, BAY, WALL and
// off; the footprint follows the pointer (on touch, a tap puts it there and a
// second tap on it puts the site down). Fighters ATTACK a foe and GUARD one
// of your buildings; a bare tap on a foe with fighters picked is ATTACK, on
// a building GUARD. Two fingers (or the right
// button and the wheel) pan, pinch and twist, as in the mission editor,
// and a gamepad works round a crosshair in the middle (`pad`, below),
// whose camera, gestures, picking and markers this reuses. The sim side
// (going up and down) is sim/crew.js; this file is only the page.
export const COMMAND = { across: 400, finger: 28 };   // m of ground across the screen when you go up; px a tap reaches
export const PADCAM = { pan: 0.9, turn: 1.6, zoom: 2.2 };   // a stick at full tilt: screen heights a second, rad/s, x nearer or further a second

const D2R = Math.PI / 180;
// A building's label on the map; a site (docs/specs/23-construction-sites.md) says so, with its ore.
// A structure's name on the map, or its site's progress. Once a site, on its
// middle slab; once a run of built walls, on the slab at one end (spec 23 §
// Snapping walls: runs go end to end, and a label a slab would smear).
const siteLabel = (G, e) => {
  const n = NAMES.buildings[e.tags?.find(t => NAMES.buildings[t])] || '';
  if (e.site) return e.site.parts[e.site.parts.length >> 1] === e ? `${n} SITE · ORE ${Math.floor(e.site.ore)}/${e.site.need}` : '';
  if (!e.tags?.includes('wall')) return Number.isFinite(e.hp) && e.hp < e.max ? `${n} ${Math.ceil(100 * e.hp / e.max)}%` : n;   // damaged: how much is left (spec 33: builders mend it)
  const st = BUILDINGS.wall.radius * 1.9, px = e.x + Math.cos(e.yaw || 0) * st, pz = e.z - Math.sin(e.yaw || 0) * st;
  return G.base?.walls.some(o => o.alive && !o.site && Math.hypot(o.x - px, o.z - pz) < st * 0.6) ? '' : n;
};
export const BAR = ['go', 'dig', 'follow', 'stay', 'work', 'drive', 'build', 'attack', 'guard'];   // the order bar, in order (keys 1–9)
export const MAKE = Object.keys(RECIPES);   // with an assembly line tapped, the bar is these instead (docs/specs/33-production.md), keys 1–3

export function createCommand(app) {
  const G = app.G, wrap = app.wrap;
  const root = document.createElement('div');
  root.className = 'cmd'; root.hidden = true;
  root.innerHTML = `
    <div class="cmd-surface"></div>
    <button class="cmd-btn cmd-back" data-c="back">BACK</button>
    <div class="cmd-bar">${BAR.map(k => `<button class="cmd-btn" data-c="${k}" hidden>${k.toUpperCase()}</button>`).join('')}${MAKE.map(k => `<button class="cmd-btn" data-m="${k}" hidden>${NAMES.chassis[k]}</button>`).join('')}</div>`;
  wrap.insertBefore(root, app.ov);
  const surface = root.querySelector('.cmd-surface'), btn = Object.fromEntries(BAR.map(k => [k, root.querySelector(`[data-c="${k}"]`)])), mk = Object.fromEntries(MAKE.map(k => [k, root.querySelector(`[data-m="${k}"]`)]));
  const C = { cam: null, picked: new Set(), box: null, order: null, place: null, ghost: null, padAt: 0, make: null };   // make: the assembly line tapped, its MAKE bar up   // order: GO, DIG, FOLLOW or BUILD chosen, waiting for its tap; place: the kind of site BUILD puts down, ghost: where; padAt: the bar's button a gamepad has lit

  const size = () => ({ W: Math.max(1, wrap.clientWidth), H: Math.max(1, wrap.clientHeight) });
  const mpp = () => metresPerPixel(C.cam, size().H);
  const ground = (sx, sy) => { const { W, H } = size(); return screenToGround(C.cam, sx, sy, W, H, G.ter.height); };
  const after = () => settle(C.cam, BOUND, G.ter.height);
  const live = () => crewOf(G).filter(m => m.alive);
  const crewAt = (sx, sy) => {
    const g = ground(sx, sy);
    return g && pickNearest(live().map(m => ({ id: m, x: m.x, z: m.z, r: 4 * m.ch.scale })), g.x, g.z, COMMAND.finger * mpp())?.id;
  };
  // A foe the map shows (in your crew's radar reach), or one of your built buildings, at a tap.
  const foes = () => { const reach = RADAR_RANGE * radarOf(G), crew = live(); return G.mechs.filter(f => f.alive && f.team !== 0 && crew.some(m => Math.hypot(f.x - m.x, f.z - m.z) < reach)); };
  const foeAt = (sx, sy) => { const g = ground(sx, sy); return g && pickNearest(foes().map(f => ({ id: f, x: f.x, z: f.z, r: 4 * f.ch.scale })), g.x, g.z, COMMAND.finger * mpp())?.id; };
  const buildingAt = (sx, sy) => {
    const g = ground(sx, sy), ours = G.entities.filter(e => e.alive && e.team === 0 && e.kind === 'structure' && !e.site);
    return g && pickNearest(ours.map(e => ({ id: e, x: e.x, z: e.z, r: e.radius })), g.x, g.z, COMMAND.finger * mpp())?.id;
  };
  const siteAt = (sx, sy) => {
    const g = ground(sx, sy), parts = (G.base?.sites || []).flatMap(s => s.parts.filter(e => e.alive));
    return g && pickNearest(parts.map(e => ({ id: e, x: e.x, z: e.z, r: e.radius })), g.x, g.z, COMMAND.finger * mpp())?.id;
  };
  // The order bar shows what the picked mechs can do; DRIVE with exactly one;
  // BUILD with diggers picked (the order), or with none (placing a site).
  const sync = () => {
    for (const m of C.picked) if (!m.alive) C.picked.delete(m);
    const p = [...C.picked];
    if (p.length) C.place = C.ghost = null;
    if (p.length || C.place || !C.make?.alive) C.make = null;
    for (const k of MAKE) {   // the line tapped: what it makes, and how many of each are waiting
      const b = mk[k], n = C.make ? C.make.queue.filter(q => q === k).length : 0, label = `${NAMES.chassis[k]}${n ? ` +${n}` : ''}`;
      if (b.hidden !== !C.make) b.hidden = !C.make;
      if (b.textContent !== label) b.textContent = label;
    }
    for (const k of BAR) {
      const b = btn[k], show = C.make ? false : k === 'drive' ? p.length === 1 : k === 'build' && !p.length ? !!G.base : p.some(m => can(m, k));
      if (b.hidden !== !show) b.hidden = !show;
      b.classList.toggle('on', C.order === k || (k === 'build' && !!C.place));
    }
    const label = C.place ? `BUILD ${NAMES.buildings[C.place]}` : 'BUILD';
    if (btn.build.textContent !== label) btn.build.textContent = label;
    if (C.order && btn[C.order].hidden) C.order = null;
    const shown = BAR.filter(k => !btn[k].hidden), lit = G.padActive && shown.length ? shown[C.padAt % shown.length] : null;
    for (const k of BAR) btn[k].classList.toggle('pad-focus', k === lit);
  };
  // A site where the ghost is, facing away from the silo, if it fits; a wall
  // near another wall's free end snaps on to it.
  const ghostPrint = () => {
    const s = G.base?.silo, g = C.ghost, yaw = s ? Math.atan2(g.x - s.x, g.z - s.z) : C.cam.yaw;
    const w = C.place === 'wall' && snapWall(G, g.x, g.z);
    return w ? footprintAt(G, w.x, w.z, w.yaw, 'wall') : footprintAt(G, g.x, g.z, yaw, C.place);
  };
  const order = o => { give(G, [...C.picked], o); C.order = null; sync(); };
  // The bar's buttons (and keys 1–6, in the bar's order).
  function press(k) {
    if (btn[k].hidden) return;
    if (k === 'build' && !C.picked.size) {   // placing: FACTORY, BAY, WALL, then off
      const i = C.place ? PLACE_ORDER.indexOf(C.place) + 1 : 0;
      C.place = PLACE_ORDER[i] || null;
      if (!C.place) C.ghost = null;
      sync();
      return;
    }
    if (k === 'drive') { if (C.picked.size === 1) close([...C.picked][0]); return; }
    if (k === 'stay' || k === 'work') return order({ kind: k });
    C.order = C.order === k ? null : k;   // GO, DIG, FOLLOW: now tap where (or whom)
    sync();
  }
  // MAKE: one of `kind` into the tapped line's queue (sim/production.js).
  function make(kind) {
    if (!C.make) return;
    if (queueMake(G, C.make, kind)) G.fx.say('Making.');
    else app.audio.sfx.beep();
    sync();
  }
  // Keys 1–9: the bar's nth button (MAKE's, with a line tapped).
  const key = n => (C.make ? MAKE[n] && make(MAKE[n]) : BAR[n] && press(BAR[n]));
  // A tap: with an order chosen, where it goes; else a crew mech picks it,
  // and the ground, with mechs picked, is GO.
  function tapAt(x, y) {
    if (C.place) return placeAt(x, y);
    const m = crewAt(x, y), g = ground(x, y), hurt = buildingAt(x, y), e = siteAt(x, y) || (needsRepair(hurt) ? hurt : null);   // a site, or a building to mend (spec 33)
    if (C.order === 'follow') { if (m) order({ kind: 'follow', target: m }); return; }
    if (C.order === 'build') { if (e) order({ kind: 'build', target: e }); return; }
    if (C.order === 'attack') { const f = foeAt(x, y); if (f) order({ kind: 'attack', target: f }); return; }
    if (C.order === 'guard') { const b = buildingAt(x, y); if (b) order({ kind: 'guard', target: b }); return; }
    const fighters = [...C.picked].some(p => can(p, 'attack'));
    if (!C.order && !m && e && [...C.picked].some(p => can(p, 'build'))) return order({ kind: 'build', target: e });
    if (!C.order && !m && fighters) {   // a bare tap on a foe is ATTACK, on a building of yours GUARD
      const f = foeAt(x, y), b = !f && buildingAt(x, y);
      if (f) return order({ kind: 'attack', target: f });
      if (b) return order({ kind: 'guard', target: b });
    }
    if (C.order && g) return order({ kind: C.order, x: g.x, z: g.z });
    if (m) { C.picked = new Set([m]); sync(); return; }
    if (g && C.picked.size) return order({ kind: 'go', x: g.x, z: g.z });
    if (!C.order) { const b = buildingAt(x, y); C.make = b?.tags.includes('line') && C.make !== b ? b : null; sync(); }   // nothing picked: a tap on an assembly line brings up MAKE, anywhere else puts it away
  }

  // Placing: a tap on the ghost (or where the pointer put it) puts the site
  // down if it fits; a tap anywhere else moves the ghost there. After a wall,
  // BUILD WALL stays on for the next.
  function placeAt(x, y) {
    const g = ground(x, y);
    if (!g) return;
    if (!C.ghost || Math.hypot(g.x - C.ghost.x, g.z - C.ghost.z) > Math.max(PLACE[C.place].w, PLACE[C.place].d) / 2) { C.ghost = g; return; }
    const f = ghostPrint();
    if (f.why) { app.audio.sfx.beep(); return; }
    placeSite(G, f);
    app.audio.sfx.beep();
    if (C.place !== 'wall') C.place = null;   // walls stay picked, to lay the next one on
    C.ghost = null;
    sync();
  }
  surface.addEventListener('mousemove', e => { if (C.place) { const r = surface.getBoundingClientRect(), g = ground(e.clientX - r.left, e.clientY - r.top); if (g) C.ghost = g; } });

  // Up: the camera over the mech you were in, COMMAND.across metres of ground across the screen.
  function open() {
    if (!commandUp(G)) return false;
    const { W, H } = size(), m = G.command.from;
    C.cam = createTopCamera({ x: m.x, z: m.z, dist: COMMAND.across * H / (W * 2 * Math.tan(TOP.fov / 2)), yaw: m.yaw });
    after();
    C.picked = new Set(); C.box = null; C.order = null; C.place = C.ghost = null;
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
    const m = e.target.closest('[data-m]');
    if (m) { make(m.dataset.m); return; }
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
    for (const e of G.entities) if (e.alive && e.team === 0 && e.kind !== 'nav') things.push({ id: e, kind: 'structure', x: e.x, y: e.y, z: e.z, label: siteLabel(G, e) });
    for (const t of G.base?.things || []) if (!t.at && !t.by) things.push({ id: t, kind: 'structure', x: t.x, y: G.ter.height(t.x, t.z), z: t.z, label: t.part === 'core' ? 'CORE' : 'PART' });   // loose on the ground: a wreck's core (spec 33)
    for (const h of G.base?.heaps || []) if (h.alive) things.push({ id: h, kind: 'structure', x: h.x, y: h.y, z: h.z, label: `ORE ${Math.floor(h.ore)}` });   // a fallen silo's spill (spec 33)
    for (const f of G.mechs) if (f.alive && f.team !== 0 && crew.some(m => Math.hypot(f.x - m.x, f.z - m.z) < reach)) things.push({ id: f, kind: 'foe', x: f.x, y: f.y, z: f.z, face: -f.yaw / D2R });
    drawLand(ctx, view, pal);
    drawMap(ctx, view, { map: { bound: BOUND, height: G.ter.height, grid: 100 }, things, sel: C.picked, box: C.box, pal });
    drawExposed(ctx, view, pal);
    drawProduction(ctx, view, pal);
    drawOrders(ctx, view, crew, pal);
    if (C.place && C.ghost) drawGhost(ctx, view, pal);
    // The base, as the cockpit's panel has it.
    ctx.font = 'bold 11px "Lucida Console", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (G.base) { ctx.fillStyle = pal.good; ctx.fillText(`ORE ${Math.floor(G.base.ore)}/${oreRoom(G)}${G.base.iso || G.base.plants.length ? `  ISO ${G.base.iso}/${isoRoom(G)}` : ''}  SALVAGE ${G.base.salvage}`, 14, 22); }
    drawCompass(ctx, 34, H - 34, C.cam.yaw, pal);
    if (G.padActive) drawPadAim(ctx, W, H, pal);
  }

  // Territory (docs/specs/33-production.md § Beacons and territory): each
  // link a thin line, each triangle a sparse dot screen in the crew's colour
  // (a dither, not a see-through fill). With BUILD SILO or BEACON's ghost
  // out, the links and triangles it would add, dashed.
  const dots = new Map();   // a dot pattern a colour, made once
  function dotsOf(ctx, col) {
    if (!dots.has(col)) {
      const c = document.createElement('canvas'); c.width = c.height = 6;
      const k = c.getContext('2d'); k.fillStyle = col; k.fillRect(0, 0, 1, 1); k.fillRect(3, 3, 1, 1);
      dots.set(col, ctx.createPattern(c, 'repeat'));
    }
    return dots.get(col);
  }
  function drawLand(ctx, view, pal) {
    const land = G.base?.land;
    if (!land) return;
    const S = n => view.toScreen(n.x, G.ter.height(n.x, n.z), n.z);
    ctx.save();
    const tri = (a, b, c) => { const p = [S(a), S(b), S(c)]; if (p.some(q => !q)) return; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.closePath(); ctx.fill(); };
    const line = (a, b) => { const p = S(a), q = S(b); if (!p || !q) return; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
    ctx.fillStyle = dotsOf(ctx, pal.good); ctx.strokeStyle = pal.good; ctx.lineWidth = 1;
    for (const [i, j, k] of land.tris) tri(land.nodes[i], land.nodes[j], land.nodes[k]);
    for (const [i, j] of land.links) line(land.nodes[i], land.nodes[j]);
    const g = (C.place === 'beacon' || C.place === 'silo') && C.ghost && ghostPrint();
    if (g && !g.why) {   // what this one would add
      const nodes = [...land.nodes, { x: g.x, z: g.z }], t = territory(nodes, CONSTRUCT.link), n = nodes.length - 1;
      ctx.setLineDash([5, 4]);
      for (const [i, j, k] of t.tris) if (k === n) tri(nodes[i], nodes[j], nodes[k]);
      for (const [i, j] of t.links) if (j === n) line(nodes[i], nodes[j]);
    }
    ctx.restore();
  }
  // A building of yours outside the territory, once there is one: a small red
  // open padlock under it, and EXPOSED when near enough to read.
  function drawExposed(ctx, view, pal) {
    if (!G.base?.land?.tris.length) return;
    ctx.save(); ctx.strokeStyle = ctx.fillStyle = pal.bad; ctx.lineWidth = 1.5;
    ctx.font = 'bold 9px "Lucida Console", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const e of G.entities) {
      if (!e.exposed || !e.alive || e.team !== 0) continue;
      const p = view.toScreen(e.x, e.y, e.z);
      if (!p) continue;
      const x = p[0], y = p[1] + 26;   // under its label
      ctx.strokeRect(x - 4, y + 4, 8, 6);
      ctx.beginPath(); ctx.arc(x - 1, y + 3, 3, Math.PI, 2 * Math.PI); ctx.stroke();   // the shackle, open
      if (view.mpp < 4) ctx.fillText('EXPOSED', x, y + 12);
    }
    ctx.restore();
  }

  // Production (docs/specs/33-production.md): under each machine shop what's
  // on its pile; at each bay of an assembly line, the part it waits for; the
  // line tapped ringed, with how many are waiting, or CREW FULL. Near enough
  // to read only.
  const WORD = { legs: 'LEGS', body: 'A BODY', core: 'A CORE', arms: 'ARMS' }, PLURAL = { legs: 'LEGS', body: 'BODIES', arms: 'ARMS' };
  function drawProduction(ctx, view, pal) {
    const b = G.base;
    if (!b?.lines.length && !b?.shops.length && !b?.plants.length) return;
    ctx.save(); ctx.font = 'bold 9px "Lucida Console", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const S = (x, z) => view.toScreen(x, G.ter.height(x, z), z);
    if (view.mpp < 4) for (const s of b.shops) {
      if (!s.alive || s.site) continue;
      const p = S(s.x, s.z), n = { legs: 0, body: 0, arms: 0 };
      if (!p) continue;
      for (const t of thingsAt(G, s)) n[PARTS[t.part].kind]++;
      ctx.fillStyle = pal.good; ctx.fillText(Object.keys(n).map(k => `${PLURAL[k]} ${n[k]}`).join(' · '), p[0], p[1] + 26);
    }
    if (view.mpp < 4) for (const pl of b.plants) {   // the isotope plant: its cores
      const p = !pl.site && pl.alive && S(pl.x, pl.z);
      if (p) { ctx.fillStyle = pal.good; ctx.fillText(`CORES ${thingsAt(G, pl).length}${pl.brew ? ' +1' : ''}`, p[0], p[1] + 26); }
    }
    for (const line of b.lines) {
      if (!line.alive || line.site) continue;
      const p = S(line.x, line.z);
      if (line === C.make && p) { ctx.strokeStyle = pal.good; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p[0], p[1], 22, 0, 7); ctx.stroke(); }
      if (p && (line.queue.length || line.full)) { ctx.fillStyle = line.full ? pal.bad : pal.good; ctx.fillText(line.full ? 'CREW FULL' : `${line.queue.length} WAITING`, p[0], p[1] + 26); }
      if (view.mpp >= 4) continue;
      line.bays.forEach((j, i) => {
        const part = j && !j.has && bayPart(j.kind, i), q = part && S(...bayAt(line, i));
        if (q) { ctx.fillStyle = pal.bad; ctx.fillText(`NEEDS ${WORD[PARTS[part].kind]}`, q[0], q[1] - 14); }
      });
    }
    ctx.restore();
  }

  // With a gamepad: the crosshair a press of A taps at, and the buttons.
  function drawPadAim(ctx, W, H, pal) {
    const x = W / 2, y = H / 2;
    ctx.save(); ctx.strokeStyle = pal.good; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 12); ctx.stroke();
    const hint = 'A: TAP. X: NEXT MECH. ◀ ▶ AND Y: ORDERS. B: LET GO.';
    ctx.textAlign = 'center'; ctx.font = 'bold 11px "Lucida Console", monospace';
    const w = ctx.measureText(hint).width;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - w / 2 - 6, 13, w + 12, 17);   // a dark band, so it reads on pale ground
    ctx.fillStyle = pal.good; ctx.fillText(hint, x, 22);
    ctx.restore();
  }

  // Each crew mech's order, from it: a line to a GO flag, to where a DIG
  // stands with a tick toward the face, or dashed to the digger a FOLLOW trails.
  function drawOrders(ctx, view, crew, pal) {
    const S = p => view.toScreen(p.x, p.y ?? G.ter.height(p.x, p.z), p.z);
    ctx.save(); ctx.lineWidth = 1.5;
    for (const m of crew) {
      const o = m.order, a = S(m);
      if (!o || o.kind === 'stay' || !a) continue;
      const b = S(o.target || o);
      if (!b) continue;
      ctx.strokeStyle = ctx.fillStyle = o.kind === 'attack' ? pal.bad : pal.good;   // ATTACK in the foes' red
      ctx.setLineDash(o.kind === 'follow' || o.kind === 'guard' ? [4, 5] : []);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.setLineDash([]);
      if (o.kind === 'go') { ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - 16); ctx.stroke(); ctx.fillRect(b[0], b[1] - 16, 9, 6); }
      else if (o.kind === 'dig') {
        const f = S({ x: o.x + Math.sin(o.yaw) * 8, z: o.z + Math.cos(o.yaw) * 8 });
        if (f) { ctx.beginPath(); ctx.arc(b[0], b[1], 4, 0, 7); ctx.moveTo(b[0], b[1]); ctx.lineTo(f[0], f[1]); ctx.stroke(); }
      } else if (o.kind === 'attack') { ctx.beginPath(); ctx.arc(b[0], b[1], 13, 0, 7); ctx.stroke(); }   // crosshairs on it
      else if (o.kind === 'guard') { ctx.beginPath(); ctx.arc(b[0], b[1], 16, 0, 7); ctx.stroke(); }
    }
    ctx.restore();
  }

  // The site BUILD would put down, at the ghost: green where it fits, red where
  // not, with what and its price, or why not.
  function drawGhost(ctx, view, pal) {
    const f = ghostPrint(), hw = f.w / 2, hd = f.d / 2, s = Math.sin(f.yaw), c = Math.cos(f.yaw);
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => { const x = f.x + u * c + v * s, z = f.z - u * s + v * c; return view.toScreen(x, G.ter.height(x, z) + 0.5, z); });
    if (pts.some(p => !p)) return;
    const col = f.why ? pal.bad : pal.good, mid = view.toScreen(f.x, G.ter.height(f.x, f.z), f.z);
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.font = 'bold 11px "Lucida Console", monospace';
    if (mid) ctx.fillText(f.why === 'room' ? 'NO ROOM' : f.why === 'built' ? 'BUILT' : `${NAMES.buildings[f.kind]} · ${PLACE[f.kind].ore} ORE`, mid[0], mid[1]);
    ctx.restore();
  }

  // A gamepad up here: the left stick pans and the right stick turns and
  // zooms, round a crosshair in the middle of the screen. A taps at the
  // crosshair (so a site's ghost sits on it), X picks the next crew mech and
  // looks at it, the D-pad's left and right walk the order bar and Y presses
  // the lit button, B lets go: the order waiting for its tap or the site,
  // then the picks. View (BACK) comes down; input/input.js routes the pad here.
  function pad(p, dt) {
    const { W, H } = size(), a = p.axes, k = p.pressed, mid = () => ground(W / 2, H / 2);
    if (a.turn || a.thr) panBy(C.cam, a.turn * PADCAM.pan * H * dt, a.thr * PADCAM.pan * H * dt, H);
    if (a.twist) rotateAbout(C.cam, a.twist * PADCAM.turn * dt, mid());
    if (a.pitch) zoomAt(C.cam, Math.pow(PADCAM.zoom, -a.pitch * dt), mid());
    after();
    if (C.place) { const g = mid(); if (g) C.ghost = g; }
    if (k.back) { close(); return; }
    if (k.a) tapAt(W / 2, H / 2);
    if (k.x) {
      const crew = live(), now = C.picked.size === 1 ? crew.indexOf([...C.picked][0]) : -1, m = crew[(now + 1) % crew.length];
      if (m) { C.picked = new Set([m]); C.cam.x = m.x; C.cam.z = m.z; after(); }
    }
    const shown = BAR.filter(b => !btn[b].hidden), n = shown.length;
    if (n) C.padAt = (C.padAt % n + (k.right ? 1 : k.left ? n - 1 : 0)) % n;
    if (k.y && n) press(shown[C.padAt]);
    if (k.b) { if (C.order) C.order = null; else if (C.place) C.place = C.ghost = null; else C.picked = new Set(); }
    sync();
  }

  const screenOf = m => { const { W, H } = size(); return C.cam && groundToScreen(C.cam, { x: m.x, y: m.y ?? G.ter.height(m.x, m.z), z: m.z }, W, H); };   // where a mech (or a ground point) is on the screen (the smoke test taps it)
  const ghost = () => (C.place && C.ghost ? ghostPrint() : null);   // the site BUILD would put down, and why not (the smoke test looks for room)
  return { C, open, close, toggle, press, key, make, pad, draw, view, screenOf, ghost, can: () => canCommand(G) };
}
