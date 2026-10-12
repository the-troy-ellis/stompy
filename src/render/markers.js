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

export function drawMap(ctx, view, { map, things = [], routes = [], waves = [], sel = new Set(), box = null, pal, centre = { x: 0, z: 0 }, sight = null }) {
  const S = (x, z, y = map.height(x, z)) => view.toScreen(x, y, z);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.font = FONT; ctx.textBaseline = 'middle';

  // The grid, following the ground, and the map's edge.
  const g = (map.grid || 100) * (view.mpp > 3 ? 2 : 1), B = map.bound, step = Math.max(25, g / 2);   // zoomed far out: every other line
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = -Math.floor(B / g) * g; v <= B; v += g) { line(ctx, S, -B, v, B, v, step); line(ctx, S, v, -B, v, B, step); }
  ctx.stroke();
  ctx.strokeStyle = pal.warn; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  ctx.beginPath(); line(ctx, S, -B, -B, B, -B, step); line(ctx, S, B, -B, B, B, step); line(ctx, S, B, B, -B, B, step); line(ctx, S, -B, B, -B, -B, step); ctx.stroke();
  ctx.setLineDash([]);
  // The map's centre, where every `at` is measured from.
  const c = S(centre.x, centre.z);
  if (c) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(c[0] - 7, c[1]); ctx.lineTo(c[0] + 7, c[1]); ctx.moveTo(c[0], c[1] - 7); ctx.lineTo(c[0], c[1] + 7); ctx.stroke(); }

  // What one thing can see: a tint on each cell it sees, the rest darkened,
  // and its range. `sight`: { from: {x, z}, range, cell, cells: [{ x, z, seen }] }.
  if (sight) {
    const half = sight.cell / 2;
    for (const cl of sight.cells) {
      const q = [S(cl.x - half, cl.z - half), S(cl.x + half, cl.z - half), S(cl.x + half, cl.z + half), S(cl.x - half, cl.z + half)];
      if (q.some(v => !v)) continue;
      ctx.fillStyle = cl.seen ? 'rgba(255,90,70,0.22)' : 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = pal.bad; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); ctx.beginPath();
    for (let a = 0; a <= 360; a += 6) { const p = S(sight.from.x - Math.sin(a * D2R) * sight.range, sight.from.z + Math.cos(a * D2R) * sight.range); if (p) (a ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); }
    ctx.stroke(); ctx.setLineDash([]);
  }

  // Routes: a line through numbered points.
  for (const r of routes) {
    const pts = r.pts.map(p => S(p.x, p.z, p.y));
    ctx.strokeStyle = sel.has(r.id) ? '#fff' : pal.good; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath();
    pts.forEach((p, i) => p && (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
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
    if (!p) continue;
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
      if (!t.asleep) { ctx.fillStyle = col; ctx.fill(); }
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
function line(ctx, S, x0, z0, x1, z1, step) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
  let pen = false;
  for (let i = 0; i <= n; i++) {
    const p = S(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
    if (!p) { pen = false; continue; }
    if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    pen = true;
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
