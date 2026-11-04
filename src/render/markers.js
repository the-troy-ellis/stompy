// Flat markers over the overhead view (docs/specs/15-mission-editor.md §
// Shared parts): the grid, the map's edge, routes, wave arrows and a marker
// for every thing, drawn in one pass on the 2D canvas over the 3D one. The
// mission editor uses it now, the command view later; it knows things only
// as { id, kind, x, y, z, ... } and the screen only through `view`.
//
//   view   { W, H, toScreen(x, y, z) → [sx, sy] | null, mpp (metres a pixel) }
//   map    { bound, height(x, z), grid (m) }
//   things [{ id, kind: 'foe'|'start'|'structure'|'turret'|'vehicle'|'nav'|'pad', x, y, z, r, face (bearing°), asleep, label }]
//   routes [{ id, pts: [{ x, y, z }], start }] · waves [{ id, kind: 'bearing'|'nav'|'ring', from: {x, y, z}, to: {x, y, z}, r, label }]
//   sel    a Set of ids · box [x0, y0, x1, y1] or null · pal: a HUD palette (data/colors.js)
//   sight  what one thing sees (sim/sight.js's grid), or null
const FONT = 'bold 11px "Lucida Console", monospace';
const D2R = Math.PI / 180;

// Lines and shapes clipped to the screen (and PAD round it) before they're
// drawn. A point just in front of the camera's plane lands millions of
// pixels away, and an iPhone's canvas dashes a dashed line all the way out
// there: the map's dashed edge, panned and zoomed, ran it out of memory
// (`THE VIEW WENT OUT`). Chrome's canvas clips first; WebKit's doesn't.
const PAD = 64;
let CW = 1e4, CH = 1e4;   // the screen the next lines are clipped to (drawMap, clipTo)
export function clipTo(W, H) { CW = W; CH = H; }
// A point well off the screen: a marker there isn't drawn at all.
export const offScreen = p => !p || p[0] < -4 * PAD || p[1] < -4 * PAD || p[0] > CW + 4 * PAD || p[1] > CH + 4 * PAD;
// The part of the segment a–b inside the screen (Liang–Barsky): t0 and t1
// along it, or null if it misses. Written into T (no garbage).
const T = [0, 1];
function clipT(ax, ay, bx, by) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (let i = 0; i < 4; i++) {
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
    const q = i === 0 ? ax + PAD : i === 1 ? CW + PAD - ax : i === 2 ? ay + PAD : CH + PAD - ay;
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  T[0] = t0; T[1] = t1;
  return T;
}
// A straight line a–b on screen, the part that shows.
export function seg(ctx, a, b) {
  if (!a || !b || !clipT(a[0], a[1], b[0], b[1])) return;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  ctx.moveTo(a[0] + T[0] * dx, a[1] + T[0] * dy); ctx.lineTo(a[0] + T[1] * dx, a[1] + T[1] * dy);
}
// A polygon on screen (points [x, y]), cut to the screen (Sutherland–Hodgman),
// as a closed sub-path; nothing if none of it shows.
export function poly(ctx, pts) {
  let out = pts;
  for (let e = 0; e < 4 && out.length; e++) {
    const inside = q => (e === 0 ? q[0] >= -PAD : e === 1 ? q[0] <= CW + PAD : e === 2 ? q[1] >= -PAD : q[1] <= CH + PAD);
    const cut = (a, b) => {
      const k = e === 0 ? (-PAD - a[0]) / (b[0] - a[0]) : e === 1 ? (CW + PAD - a[0]) / (b[0] - a[0]) : e === 2 ? (-PAD - a[1]) / (b[1] - a[1]) : (CH + PAD - a[1]) / (b[1] - a[1]);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    };
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length], ia = inside(a), ib = inside(b);
      if (ia) next.push(a);
      if (ia !== ib) next.push(cut(a, b));
    }
    out = next;
  }
  if (out.length < 3) return;
  ctx.moveTo(out[0][0], out[0][1]);
  for (let i = 1; i < out.length; i++) ctx.lineTo(out[i][0], out[i][1]);
  ctx.closePath();
}

export function drawMap(ctx, view, { map, things = [], routes = [], waves = [], sel = new Set(), box = null, pal, centre = { x: 0, z: 0 }, sight = null }) {
  const S = (x, z, y = map.height(x, z)) => view.toScreen(x, y, z);
  clipTo(view.W, view.H);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.font = FONT; ctx.textBaseline = 'middle';

  // The grid, following the ground, and the map's edge.
  // map.bound: [across, along] (a map needn't be square: docs/specs/35-bigger-maps.md), or one number.
  const g = (map.grid || 100) * (view.mpp > 3 ? 2 : 1), step = Math.max(25, g / 2);   // zoomed far out: every other line
  const BX = Array.isArray(map.bound) ? map.bound[0] : map.bound, BZ = Array.isArray(map.bound) ? map.bound[1] : map.bound;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = -Math.floor(BZ / g) * g; v <= BZ; v += g) line(ctx, S, -BX, v, BX, v, step);
  for (let v = -Math.floor(BX / g) * g; v <= BX; v += g) line(ctx, S, v, -BZ, v, BZ, step);
  ctx.stroke();
  ctx.strokeStyle = pal.warn; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); line(ctx, S, -BX, -BZ, BX, -BZ, step); line(ctx, S, BX, -BZ, BX, BZ, step); line(ctx, S, BX, BZ, -BX, BZ, step); line(ctx, S, -BX, BZ, -BX, -BZ, step); ctx.stroke();
  ctx.setLineDash([]);
  // The map's centre, where every `at` is measured from.
  const c = S(centre.x, centre.z);
  if (!offScreen(c)) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(c[0] - 7, c[1]); ctx.lineTo(c[0] + 7, c[1]); ctx.moveTo(c[0], c[1] - 7); ctx.lineTo(c[0], c[1] + 7); ctx.stroke(); }

  // What one thing can see: a tint on each cell it sees, the rest darkened,
  // and its range. `sight`: { from: {x, z}, range, cell, cells: [{ x, z, seen }] }.
  if (sight) {
    const half = sight.cell / 2;
    for (const cl of sight.cells) {
      const q = [S(cl.x - half, cl.z - half), S(cl.x + half, cl.z - half), S(cl.x + half, cl.z + half), S(cl.x - half, cl.z + half)];
      if (q.some(v => !v)) continue;
      ctx.fillStyle = cl.seen ? 'rgba(255,90,70,0.22)' : 'rgba(0,0,0,0.3)';
      ctx.beginPath(); poly(ctx, q); ctx.fill();
    }
    ctx.strokeStyle = pal.bad; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); ctx.beginPath();
    let prev = null;
    for (let a = 0; a <= 360; a += 6) { const p = S(sight.from.x - Math.sin(a * D2R) * sight.range, sight.from.z + Math.cos(a * D2R) * sight.range); seg(ctx, prev, p); prev = p; }
    ctx.stroke(); ctx.setLineDash([]);
  }

  // Routes: a line through numbered points.
  for (const r of routes) {
    const pts = r.pts.map(p => S(p.x, p.z, p.y));
    ctx.strokeStyle = sel.has(r.id) ? '#fff' : pal.good; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath();
    for (let i = 1; i < pts.length; i++) seg(ctx, pts[i - 1], pts[i]);
    ctx.stroke(); ctx.setLineDash([]);
    pts.forEach((p, i) => {
      if (!p) return;
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, 7); ctx.fill();
      ctx.strokeStyle = sel.has(`${r.id}.${i}`) ? '#fff' : pal.good; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = pal.good; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), p[0], p[1] + 0.5);
    });
  }

  // Waves: where they walk in from.
  for (const w of waves) {
    ctx.strokeStyle = sel.has(w.id) ? '#fff' : pal.bad; ctx.lineWidth = 2;
    if (w.kind === 'ring') {
      ctx.setLineDash([4, 8]); ctx.beginPath();
      for (let a = 0; a <= 360; a += 10) { const p = S(w.from.x - Math.sin(a * D2R) * w.r, w.from.z + Math.cos(a * D2R) * w.r); if (p) (a ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); }
      ctx.stroke(); ctx.setLineDash([]);
      const p = S(w.from.x, w.from.z + w.r);
      if (p) label(ctx, w.label, p[0], p[1] - 12, pal.bad);
      continue;
    }
    const a = S(w.from.x, w.from.z), b = S(w.to.x, w.to.z);
    if (!a || !b) continue;
    arrow(ctx, a, b);
    label(ctx, w.label, a[0], a[1] - 12, pal.bad);
  }

  // Things.
  for (const t of things) {
    const p = S(t.x, t.z, t.y);
    if (offScreen(p)) continue;
    const [x, y] = p, on = sel.has(t.id);
    const facing = t.face == null ? null : facingOnScreen(S, t);
    if (t.kind === 'nav' || t.kind === 'pad') {
      const rr = Math.max(7, (t.r || 14) / view.mpp);
      ctx.strokeStyle = pal.good; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.stroke();
      if (t.kind === 'pad') { ctx.beginPath(); ctx.moveTo(x - rr * 0.6, y); ctx.lineTo(x + rr * 0.6, y); ctx.moveTo(x, y - rr * 0.6); ctx.lineTo(x, y + rr * 0.6); ctx.stroke(); }
      if (on) ring(ctx, x, y, rr + 5);
    } else if (t.kind === 'foe' || t.kind === 'start') {
      const col = t.kind === 'foe' ? pal.bad : pal.good;
      if (facing != null) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(facing) * 18, y + Math.sin(facing) * 18); ctx.stroke(); }
      ctx.beginPath();
      if (t.kind === 'foe') { ctx.moveTo(x, y - 9); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 8, y); }
      else { const f = facing ?? -Math.PI / 2; for (const [r, a] of [[11, 0], [8, 2.4], [3, Math.PI], [8, -2.4]]) ctx.lineTo(x + Math.cos(f + a) * r, y + Math.sin(f + a) * r); }
      ctx.closePath();
      ctx.fillStyle = '#000'; ctx.fill();
      if (!t.asleep && !t.hollow) { ctx.fillStyle = col; ctx.fill(); }   // hollow: a crew mech underground (spec 37)
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      if (on) ring(ctx, x, y, 14);
    } else {
      const s = t.kind === 'vehicle' ? 5 : 7, col = t.kind === 'vehicle' ? pal.good : pal.warn;
      ctx.fillStyle = '#000'; ctx.fillRect(x - s - 1, y - s - 1, 2 * s + 2, 2 * s + 2);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x - s, y - s, 2 * s, 2 * s);
      if (t.kind === 'turret') { ctx.fillStyle = col; ctx.fillRect(x - 2, y - 2, 4, 4); }
      if (t.hp === Infinity) { ctx.beginPath(); ctx.moveTo(x - s, y + s); ctx.lineTo(x + s, y - s); ctx.stroke(); }   // scenery: can't be hurt
      if (on) ring(ctx, x, y, s + 6);
    }
    if (t.label && view.mpp < 4) label(ctx, t.label, x, y + 18, on ? '#fff' : 'rgba(255,255,255,0.75)');
  }

  if (box) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.strokeRect(Math.min(box[0], box[2]) + 0.5, Math.min(box[1], box[3]) + 0.5, Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1]));
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// A compass in the corner: N where bearing 0 is on screen.
export function drawCompass(ctx, x, y, yaw, pal) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-yaw);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.fill();
  ctx.strokeStyle = pal.good; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = pal.good; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(5, -4); ctx.lineTo(-5, -4); ctx.closePath(); ctx.fill();
  ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 0, 7);
  ctx.restore();
}

// A thing's facing as a screen angle, through a point 10 m ahead of it.
function facingOnScreen(S, t) {
  const b = t.face * D2R, a = S(t.x, t.z), q = S(t.x - Math.sin(b) * 10, t.z + Math.cos(b) * 10);
  return a && q ? Math.atan2(q[1] - a[1], q[0] - a[0]) : null;
}
// A ground line from (x0, z0) to (x1, z1), bent to the terrain every `step` m.
// Each piece is clipped to the screen; one that runs on from the last piece
// carries on the same sub-path, so a dash pattern runs on unbroken.
function line(ctx, S, x0, z0, x1, z1, step) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
  let have = false, pen = false, px = 0, py = 0;   // have: the last point projected; pen: the path is at it
  for (let i = 0; i <= n; i++) {
    const p = S(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
    if (!p) { have = pen = false; continue; }
    if (have && clipT(px, py, p[0], p[1])) {
      const dx = p[0] - px, dy = p[1] - py;
      if (!(pen && T[0] === 0)) ctx.moveTo(px + T[0] * dx, py + T[0] * dy);
      ctx.lineTo(px + T[1] * dx, py + T[1] * dy);
      pen = T[1] === 1;
    } else pen = false;
    px = p[0]; py = p[1]; have = true;
  }
}
function arrow(ctx, a, b) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.min(60, Math.hypot(b[0] - a[0], b[1] - a[1]));
  const e = [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]);
  ctx.moveTo(e[0] - Math.cos(ang - 0.5) * 10, e[1] - Math.sin(ang - 0.5) * 10); ctx.lineTo(e[0], e[1]); ctx.lineTo(e[0] - Math.cos(ang + 0.5) * 10, e[1] - Math.sin(ang + 0.5) * 10);
  ctx.stroke();
}
function ring(ctx, x, y, r) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
function label(ctx, s, x, y, col) {
  if (!s) return;
  ctx.textAlign = 'center';
  const w = ctx.measureText(s).width + 6;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2, y - 7, w, 14);
  ctx.fillStyle = col; ctx.fillText(s, x, y + 0.5);
}
