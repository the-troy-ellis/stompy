import { RADAR_RANGE, radarOf, fogOf } from '../data/weather.js';
import { TAU, clampN, len, rnd, sub } from '../util/math.js';
import { WEAPONS, CATS, CAT_OF, CAT_LABEL, CAT_KEY } from '../data/weapons.js';
import { MP_COLORS } from '../data/colors.js';
import { center, leadPoint, viewYaw } from '../sim/geom.js';
import { objectivePoint } from '../sim/objectives.js';
import { MELT_MAX, beamMult } from '../sim/beams.js';
import { HEAT, hotFrac, FEEL } from '../data/feel.js';
import { makeSpring, stepSpring } from '../util/spring.js';
import { liveKills, killWords } from '../net/killfeed.js';

const { sin, cos, atan2, min, max, PI, random, hypot, floor } = Math;

// The compass tape's label for a heading in degrees: a cardinal letter on
// the quarters, otherwise the heading in tens (030, 120...) as two digits.
// The objective line (docs/specs/03-objectives.md § Player experience): one
// short line per objective, never more than 24 characters. Pure, for the tests.
export const fmtDist = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export const fmtClock = s => `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;
// The target brackets and enemy chevrons show out to 1.2x what the fog lets
// you see (spec 07); in clear weather that is past the radar anyway.
const FOG_TMP = [0, 0];
export const sightLine = G => (G.pal ? fogOf(G, FOG_TMP)[1] * 1.2 : Infinity);
export function objectiveLine(o) {
  const d = o.def, fit = (head, tail) => `${head.slice(0, 24 - tail.length)}${tail}`.trim();
  switch (d.type) {
    case 'eliminate': return `ELIMINATE ${o.total - o.left}/${o.total}`;
    case 'destroy': return fit(`DESTROY ${d.label || 'TARGETS'}`, ` ${o.done ?? 0}/${o.total ?? o.targets.length}`);
    case 'survive': return `SURVIVE ${fmtClock(o.left ?? d.seconds)}`;
    case 'escort': return fit(`ESCORT ${fmtDist(o.dist ?? 0)}`, o.left != null ? ` ${fmtClock(o.left)}` : '');
    case 'extract': return fit(`EXTRACT ${fmtDist(o.dist ?? 0)}`, o.left != null ? ` ${fmtClock(o.left)}` : '');
    case 'protect': return fit(`PROTECT ${d.label || 'TARGETS'}`, ` ${o.alive ?? o.targets.length}/${o.total ?? o.targets.length}`);
    default: return d.type.toUpperCase().slice(0, 24);
  }
}
// Off-screen markers: the point on the view's edge in the direction of a bearing
// relative to the view (0 ahead, positive to the left), and the arrow's angle.
// Ahead maps to the top edge, behind to the bottom, the sides to the sides.
export function markerEdge(W, top, bottom, m, rel) {
  const a = Math.atan2(Math.sin(rel), Math.cos(rel)), cx = W / 2, cy = (top + bottom) / 2;
  const dx = -Math.sin(a), dy = -Math.cos(a), hx = cx - m, hy = (bottom - top) / 2;
  const k = Math.min(Math.abs(dx) > 1e-6 ? hx / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hy / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dx, -dy) };
}
// The cockpit's and the HUD's vertical sway, in pixels, each a spring chasing
// the camera's drop (G.kick plus the footstep bob) with its own stiffness,
// damping and gain from FEEL.view: the cockpit stiff and a little loose so it
// rattles, the HUD soft so it floats behind and settles.
export const makeSway = () => ({ cockpit: makeSpring(), hud: makeSpring() });
export function stepSway(s, drop, dt, V = FEEL.view) {
  const out = {};
  for (const n of ['cockpit', 'hud']) {
    const sp = s[n], k = V[`${n}K`], z = V[`${n}Zeta`];
    sp.k = k; sp.c = 2 * Math.sqrt(k) * z;
    if (dt > 0) stepSpring(sp, dt, drop);
    out[n] = sp.x * V[`${n}Gain`];
  }
  return out;
}
export const compassLabel = d => ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10).padStart(2, '0'));

// The ?debug=1 label over an enemy: its state, its profile, its group (with
// a star on the flanker), and what it is up to right now.
export function aiLabel(e) {
  const a = e.ai || {}, g = a.group;
  let s = `${(a.state || 'patrol').toUpperCase()} ${a.profile || e.ch?.ai?.profile || 'baseline'}`;
  if (g && g.size > 1) s += ` G${g.id}${g.flank ? '*' : ''}`;
  if (a.cover) s += ' COVER';
  if (a.ridge) s += ' RIDGE';
  if (a.jump) s += ' JUMP';
  if (e.melee) s += ' SWING';
  if (a.hot) s += ' HOT';
  return s;
}

// The cockpit instruments on the 2D canvas over the GL view: crosshair and
// scan rings, target brackets, compass, radar, damage, heat, weapons,
// throttle, messages, the arena board, and the missile camera's IR feed.
export function createHud(app) {
  const G = app.G, ctx = app.ctx;
  const punchBtn = app.root.querySelector('[data-t="punch"]');

  const project = p => {
    const v = G.VP, x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12], y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
    const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
    if (w <= 0.1) return null;
    return [(x / w * 0.5 + 0.5) * app.scene.view.W, (1 - (y / w * 0.5 + 0.5)) * app.scene.view.H];
  };
  const GREEN = '#5f5', DIM = '#2a7a2a', AMBER = '#fc3', RED = '#f44';
  const hpCol = f => (f <= 0 ? '#222' : f > 0.66 ? '#3c3' : f > 0.33 ? '#dd3' : '#e33');

  function mechDiagram(m, x, y, u) {
    const box = (k, rx, ry, rw, rh) => {
      ctx.fillStyle = hpCol(m.hp[k] / m.max[k]);
      ctx.fillRect(x + rx * u, y + ry * u, rw * u - 1, rh * u - 1);
      ctx.strokeStyle = DIM; ctx.strokeRect(x + rx * u + 0.5, y + ry * u + 0.5, rw * u - 2, rh * u - 2);
    };
    box('LA', -3.2, 0.2, 1.4, 3.6); box('T', -1.6, 0, 3.2, 4.2); box('RA', 1.8, 0.2, 1.4, 3.6);
    box('LL', -1.6, 4.4, 1.5, 4); box('RL', 0.1, 4.4, 1.5, 4);
  }

  // An objective marker: a diamond with the distance under it; off-screen (or
  // behind), held at the edge of the view with an arrow pointing the way.
  function drawMarker(L, p, col) {
    const P = G.player, W = app.scene.view.W, top = 72, bottom = L.viewBottom - 16, m = 18;
    const dist = hypot(p[0] - P.x, p[2] - P.z), s = project(p);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.textAlign = 'center';
    if (s && s[0] > m && s[0] < W - m && s[1] > top && s[1] < bottom) {
      ctx.beginPath(); ctx.moveTo(s[0], s[1] - 7); ctx.lineTo(s[0] + 7, s[1]); ctx.lineTo(s[0], s[1] + 7); ctx.lineTo(s[0] - 7, s[1]); ctx.closePath(); ctx.stroke();
      ctx.fillText(fmtDist(dist), s[0], s[1] + 18);
      return;
    }
    const e = edgePoint(W, top, bottom, m, viewYaw(P), P, p);
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.a);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 3); ctx.lineTo(-6, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillText(fmtDist(dist), e.x, e.y + (e.y > (top + bottom) / 2 ? -12 : 20));
  }
  // Where the view edge is crossed going from the centre toward the objective's bearing.
  function edgePoint(W, top, bottom, m, vy, P, p) { return markerEdge(W, top, bottom, m, atan2(p[0] - P.x, p[2] - P.z) - vy); }

  // Where each instrument goes. Desktop: the cockpit dashboard along the
  // bottom. Touch: no dashboard -- the bottom belongs to the thumbs and the
  // controls -- so instruments move to the top corners.
  function hudLayout() {
    if (!G.touchUI) {
      const dash = min(150, app.scene.view.H * 0.27), top = app.scene.view.H - dash + 8, u = min(7, dash / 12);
      return {
        frame: true, dash, viewBottom: app.scene.view.H - dash,
        radar: { x: app.scene.view.W / 2, y: app.scene.view.H - dash / 2 + 4, r: dash * 0.4 },
        bars: { x: app.scene.view.W * 0.1 + 6, y: top, h: dash - 30 },
        diag: { x: app.scene.view.W * 0.1 + 34 + 3.2 * u, y: top + 6, u },
        weapons: { x: app.scene.view.W * 0.62, y: top + 4 },
        throttle: { x: app.scene.view.W * 0.9 - 26, y: top, h: dash - 30 },
        target: { x: app.scene.view.W * 0.1 + 8, y: 48 },
        hostiles: { x: app.scene.view.W * 0.965 - 10, y: 20 },
      };
    }
    const r = clampN(app.scene.view.H * 0.12, 30, 46), u = 5;
    return {
      frame: false, dash: 0, viewBottom: app.scene.view.H,
      radar: { x: app.scene.view.W - r - 14, y: r + 12, r },
      bars: { x: 64, y: 112, h: 70 },
      diag: { x: 100 + 3.2 * u, y: 116, u },
      weapons: { x: app.scene.view.W - 205, y: 2 * r + 34 },
      throttle: { x: 14, y: app.scene.view.H - 196, h: 120 },
      target: { x: 132, y: 10 },   // right of the pause and zoom buttons
      hostiles: { x: app.scene.view.W - 14, y: 2 * r + 34 + 56 },   // under the weapon list, clear of the compass
    };
  }

  // The kill feed (net/killfeed.js): right-aligned at x from y down, newest at
  // the bottom, the names in the pilots' colours, each fading over 6 s.
  function drawKillFeed(x, y) {
    const name = app.net.pilotName, css = id => MP_COLORS[app.net.Net.info.get(id)?.color]?.css || GREEN;
    ctx.textAlign = 'left';
    for (const e of liveKills(app.net.Net.feed, performance.now())) {
      const [k, verb, v] = killWords(e, name), parts = [[k, css(e.killer)], [` ${verb} `, e.killer === app.net.Net.id || e.victim === app.net.Net.id ? AMBER : GREEN], [v, css(e.victim)]];
      const w = parts.reduce((sum, [t]) => sum + ctx.measureText(t).width, 0);
      let px = x - w;
      ctx.globalAlpha = clampN(e.alpha, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(px - 4, y - 9, w + 8, 12);   // a dark band, so a pale name reads against the sky
      for (const [t, c] of parts) { ctx.fillStyle = c; ctx.fillText(t, px, y); px += ctx.measureText(t).width; }
      y += 13;
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'right';
  }
  // Scoreboard, death / respawn, spawn shield, and the round banner.
  function drawArenaHUD(L) {
    const P = G.player;
    const board = app.net.arenaBoard();
    let y = L.hostiles.y + 14;
    const x = L.hostiles.x;
    ctx.textAlign = 'right';
    if (G.touchUI) {
      // Phones: one line -- the full board would sit under the fire buttons.
      // (It's in the menu.)
      const rank = board.findIndex(p => p.id === app.net.Net.id) + 1, me = app.net.Net.info.get(app.net.Net.id), lead = board[0];
      ctx.fillStyle = AMBER;
      ctx.fillText(`#${rank} ${me ? `${me.kills}/${me.deaths}` : ''}${lead && lead.id !== app.net.Net.id ? `  LEAD ${lead.name} ${lead.kills}` : ''}`, x, y);
    } else for (const p of board) {
      ctx.fillStyle = p.id === app.net.Net.id ? AMBER : GREEN;
      ctx.fillText(`${p.name.padEnd(12)} ${String(p.kills).padStart(2)}/${p.deaths}`, x, y);
      ctx.fillStyle = MP_COLORS[p.color]?.css || GREEN;
      ctx.fillRect(x - 128, y - 4, 8, 8);
      y += 14;
    }
    drawKillFeed(x, y + (G.touchUI ? 16 : 6));
    ctx.textAlign = 'center';
    const mid = L.viewBottom * 0.5;
    if (!P.alive) {
      ctx.font = 'bold 22px "Lucida Console", monospace'; ctx.fillStyle = RED;
      ctx.fillText(G.killer ? `DESTROYED BY ${app.net.pilotName(G.killer)}` : 'MECH DESTROYED', app.scene.view.W / 2, mid);
      ctx.font = '14px "Lucida Console", monospace'; ctx.fillStyle = AMBER;
      ctx.fillText(`RESPAWN IN ${Math.ceil(max(0, (G.respawnAt - G.clock) / 1000))}`, app.scene.view.W / 2, mid + 26);
    } else if (P.spawnT > 0) {
      ctx.font = '13px "Lucida Console", monospace'; ctx.fillStyle = '#3cf';
      ctx.fillText('SHIELDED', app.scene.view.W / 2, mid + 40);
    }
    if (G.roundOver && G.banner) {
      ctx.font = 'bold 24px "Arial Black", Arial, sans-serif'; ctx.fillStyle = AMBER;
      ctx.fillText(G.banner.text, app.scene.view.W / 2, L.viewBottom * 0.37);
      ctx.font = '13px "Lucida Console", monospace'; ctx.fillStyle = GREEN;
      ctx.fillText(`NEXT ROUND IN ${Math.ceil(max(0, (G.banner.until - performance.now()) / 1000))}`, app.scene.view.W / 2, L.viewBottom * 0.37 + 24);
    }
    ctx.font = '11px "Lucida Console", monospace';
  }

  // The missile camera: an IR feed, not the cockpit -- scanlines, static,
  // vignette, a reticle, hot targets boxed with their range, and telemetry.
  function drawGuideHUD() {
    const g = G.guide, WHITE = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < app.scene.view.H; y += 3) ctx.fillRect(0, y, app.scene.view.W, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    for (let i = 0; i < 180; i++) ctx.fillRect(random() * app.scene.view.W, random() * app.scene.view.H, 1 + random() * 2, 1);
    const band = (G.time * 90) % (app.scene.view.H + 60) - 30;   // a slow rolling interference band
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(0, band, app.scene.view.W, 18);
    const vg = ctx.createRadialGradient(app.scene.view.W / 2, app.scene.view.H / 2, min(app.scene.view.W, app.scene.view.H) * 0.25, app.scene.view.W / 2, app.scene.view.H / 2, max(app.scene.view.W, app.scene.view.H) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, app.scene.view.W, app.scene.view.H);

    const cx = app.scene.view.W / 2, cy = app.scene.view.H / 2;
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.moveTo(cx + sx * 46, cy + sy * 30 - sy * 12); ctx.lineTo(cx + sx * 46, cy + sy * 30); ctx.lineTo(cx + sx * 46 - sx * 14, cy + sy * 30);
    }
    ctx.moveTo(cx - 10, cy); ctx.lineTo(cx - 3, cy); ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy - 3); ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 10);
    ctx.stroke(); ctx.lineWidth = 1;

    // Hot targets.
    ctx.font = '11px "Lucida Console", "Courier New", monospace'; ctx.textBaseline = 'middle';
    let nearest = Infinity;
    for (const m of G.mechs) {
      if (!m.alive || m === G.player) continue;
      const r = len(sub(center(m), g.pos));
      nearest = min(nearest, r);
      const q = project(center(m));
      if (!q || q[0] < 0 || q[0] > app.scene.view.W || q[1] < 0 || q[1] > app.scene.view.H) continue;
      const k = clampN(900 / max(r, 1), 8, 40);
      ctx.strokeStyle = WHITE; ctx.strokeRect(q[0] - k, q[1] - k * 1.3, k * 2, k * 2.6);
      ctx.fillStyle = WHITE; ctx.textAlign = 'center';
      ctx.fillText(`${m.remote ? app.net.pilotName(m.netId) : m.ch.name} ${Math.round(r)}m`, q[0], q[1] - k * 1.3 - 9);
    }

    ctx.fillStyle = WHITE; ctx.textAlign = 'left';
    const lx = G.touchUI ? 70 : 20;
    ctx.fillText('MSL CAM   IR / WHT-HOT', lx, 22);
    ctx.fillText(`LRM ${g.n}/${WEAPONS.lrm.count}`, lx, 38);
    ctx.textAlign = 'right';
    const rx = G.touchUI ? app.scene.view.W - 120 : app.scene.view.W - 20;
    ctx.fillText(`ALT ${Math.round(g.pos[1] - G.ter.height(g.pos[0], g.pos[2]))}m`, rx, 22);
    ctx.fillText(nearest < Infinity ? `TGT ${Math.round(nearest)}m` : 'TGT ---', rx, 38);
    ctx.fillText(`FUEL ${max(0, g.fuel || 0).toFixed(1)}s`, rx, 54);
    ctx.textAlign = 'center';
    if (g.lost > 0 || !g.n) {
      ctx.font = 'bold 20px "Lucida Console", monospace'; ctx.fillText('SIGNAL LOST', cx, cy - 60);
    } else {
      ctx.fillText(G.touchUI ? 'DRAG TO STEER  ·  LIFT TO DETONATE' : 'STEER WITH THE MOUSE  ·  RELEASE TO DETONATE', cx, G.touchUI ? 66 : app.scene.view.H - 24);
    }
  }

  // The frame-time readout: median and 95th percentile over the last 2 s, draw
  // calls, particles. On with ?debug=1 or the FRAME TIME setting (for playtests
  // on real phones); ?debug=1 adds the seed, the state and the AI overlay.
  const frames = [];
  let lastFrameAt = 0, stopAt = null, rangeMemo = { t: null, r: 0, at: 0, rate: 0 };
  function drawDebug() {
    const now = performance.now();
    if (lastFrameAt) frames.push(now - lastFrameAt);
    lastFrameAt = now;
    while (frames.length > 120) frames.shift();
    const sorted = [...frames].sort((a, b) => a - b), q = f => (sorted.length ? sorted[min(sorted.length - 1, floor(sorted.length * f))] : 0);
    ctx.font = '11px "Lucida Console", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#9f9';
    const full = app.params.has('debug');
    const lines = [`FRAME ${q(0.5).toFixed(1)} ms  P95 ${q(0.95).toFixed(1)} ms`, `DRAWS ${app.R.draws}  CULLED ${app.R.culled || 0}  PARTICLES ${G.parts.length}  MECHS ${G.mechs.length}`];
    if (full) lines.push(`SEED ${G.ter?.seed ?? '-'}  T ${G.time.toFixed(1)}  STATE ${G.state}`);
    lines.forEach((l, i) => ctx.fillText(l, 12, app.scene.view.H * 0.5 + i * 13));
    if (full) drawAIDebug();
  }
  // The enemies' minds (docs/specs/05-ai.md § Debug view): the label over each
  // head, a square where it believes you are with a line to it (red), a line
  // to its cover point (amber) or its ridge (violet), and its patrol waypoint
  // (dim) while unaware.
  function drawAIDebug() {
    if (G.state === 'menu' || !G.VP) return;
    ctx.font = '10px "Lucida Console", monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 1;
    const at = (x, z) => [x, G.ter.height(x, z) + 1, z];
    for (const e of G.mechs) {
      if (e.team === 0 || e.remote || !e.alive) continue;
      const a = e.ai, head = project([e.x, e.y + 9.5 * e.ch.scale, e.z]), foot = project([e.x, e.y + 1, e.z]);
      if (head) { ctx.fillStyle = a.seen && a.aware ? '#f66' : a.aware ? AMBER : '#9f9'; ctx.fillText(aiLabel(e), head[0], head[1]); }
      const line = (p, col) => {
        const q = project(p);
        if (!q || !foot) return null;
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(foot[0], foot[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        return q;
      };
      if (a.aware && a.belief) { const q = line(at(a.belief.x, a.belief.z), 'rgba(255,90,90,0.6)'); if (q) ctx.strokeRect(q[0] - 3, q[1] - 3, 6, 6); }
      if (a.cover) line(at(a.cover.x, a.cover.z), AMBER);
      if (a.ridge) line(at(a.ridge.x, a.ridge.z), '#c8f');
      if (a.wp && (!a.aware || a.state === 'search')) line(at(a.wp[0], a.wp[1]), DIM);
    }
  }
  const sway = makeSway();
  let lastSwayAt = 0;
  function drawHUD() {
    ctx.setTransform(app.scene.view.dpr, 0, 0, app.scene.view.dpr, 0, 0);
    ctx.clearRect(0, 0, app.scene.view.W, app.scene.view.H);
    if (app.params.has('debug') || app.prefs.frameTime) drawDebug();
    if (G.state === 'menu') return;
    if (G.guide) { drawGuideHUD(); return; }
    const P = G.player, L = hudLayout(), dash = L.dash;
    // The cockpit and the HUD each ride their own spring (stepSway): the
    // frame and dashboard are bolted to the mech and rattle, the projected
    // HUD floats and settles. Without a dashboard (touch) the instruments float too.
    const now = performance.now(), sw = stepSway(sway, G.kick + (G.bob ? G.bob.x : 0), lastSwayAt ? min(0.05, (now - lastSwayAt) / 1000) : 0);
    lastSwayAt = now;
    const dpr = app.scene.view.dpr, layer = name => ctx.setTransform(dpr, 0, 0, dpr, 0, (name ? sw[name] : 0) * dpr);
    const instruments = L.frame ? 'cockpit' : 'hud';
    layer('cockpit');
    ctx.font = '11px "Lucida Console", "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    // Cockpit frame: side struts and the dashboard.
    if (L.frame) {
    ctx.fillStyle = '#121416';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(app.scene.view.W * 0.035, 0); ctx.lineTo(app.scene.view.W * 0.1, app.scene.view.H - dash); ctx.lineTo(0, app.scene.view.H - dash * 0.6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(app.scene.view.W, 0); ctx.lineTo(app.scene.view.W * 0.965, 0); ctx.lineTo(app.scene.view.W * 0.9, app.scene.view.H - dash); ctx.lineTo(app.scene.view.W, app.scene.view.H - dash * 0.6); ctx.fill();
    const g = ctx.createLinearGradient(0, app.scene.view.H - dash, 0, app.scene.view.H);
    g.addColorStop(0, '#2a2d30'); g.addColorStop(0.08, '#1a1c1e'); g.addColorStop(1, '#0b0c0d');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, app.scene.view.H); ctx.lineTo(0, app.scene.view.H - dash * 0.6); ctx.lineTo(app.scene.view.W * 0.1, app.scene.view.H - dash); ctx.lineTo(app.scene.view.W * 0.9, app.scene.view.H - dash); ctx.lineTo(app.scene.view.W, app.scene.view.H - dash * 0.6); ctx.lineTo(app.scene.view.W, app.scene.view.H); ctx.fill();
    }

    layer(null);   // full-screen washes stay put
    // Damage flash.
    if (G.flash > 0) { ctx.fillStyle = `rgba(255,40,20,${G.flash * 0.4})`; ctx.fillRect(0, 0, app.scene.view.W, app.scene.view.H); }
    if (G.whiteFlash > 0) { ctx.fillStyle = `rgba(235,215,255,${G.whiteFlash * 0.85})`; ctx.fillRect(0, 0, app.scene.view.W, app.scene.view.H); }

    layer('hud');
    // Crosshair.
    let ch = project(G.aim) || [app.scene.view.W / 2, app.scene.view.H / 2];
    // Hit-stop: the crosshair holds where it was for a beat when your shot lands.
    if (G.hitStop > 0) { if (!stopAt) stopAt = ch; ch = stopAt; } else stopAt = null;
    ctx.strokeStyle = G.aimMech ? RED : GREEN;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(ch[0] + dx * 5, ch[1] + dy * 5); ctx.lineTo(ch[0] + dx * 14, ch[1] + dy * 14); }
    ctx.stroke();
    ctx.strokeRect(ch[0] - 1, ch[1] - 1, 2, 2);
    // Someone is in reach: a fist beside the crosshair, and the touch button wakes up.
    if (punchBtn) punchBtn.classList.toggle('ready', !!G.punchReady);
    if (G.punchReady || (P.melee && P.melee.phase === 'windup')) {
      const fx0 = ch[0] + 24, fy0 = ch[1] + 18, winding = P.melee && P.melee.phase === 'windup';
      ctx.fillStyle = winding ? '#fff' : AMBER;
      ctx.fillRect(fx0, fy0 + 4, 12, 9);                                    // the palm
      for (let i = 0; i < 4; i++) ctx.fillRect(fx0 + i * 3, fy0, 2, 5);     // the knuckles
      ctx.fillRect(fx0 - 3, fy0 + 7, 3, 5);                                 // the thumb
      ctx.textAlign = 'left'; ctx.fillText(winding ? 'SWING' : 'PUNCH', fx0 + 16, fy0 + 9);
    }
    // Fusion scan: a violet ring filling over the scan, a frequency readout
    // that settles as it converges, and LOCK at the end.
    const fs = P.fusion;
    if (fs?.on) {
      const w = P.weapons.find(w => w.def.kind === 'fusion'), p = fs.mech ? min(1, fs.t / w.def.scan) : 0;
      ctx.strokeStyle = 'rgba(200,128,255,0.3)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ch[0], ch[1], 30, 0, TAU); ctx.stroke();
      const slip = fs.slipping && floor(performance.now() / 90) % 2;
      ctx.strokeStyle = slip ? AMBER : '#c8f'; ctx.beginPath(); ctx.arc(ch[0], ch[1], 30, -PI / 2, -PI / 2 + TAU * p); ctx.stroke();
      ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.fillStyle = fs.slipping ? AMBER : '#c8f';
      if (!fs.mech) ctx.fillText('FUSION: NO TARGET', ch[0], ch[1] + 46);
      else if (fs.slipping) ctx.fillText(`LOCK SLIPPING -- ${Math.floor(p * 100)}%`, ch[0], ch[1] + 46);
      else {
        const hz = (37.4 + (fs.mech.netId || 3) * 4.19 + (1 - p) * rnd(-20, 20)).toFixed(2);
        ctx.fillText(`RESONANCE SCAN ${Math.floor(p * 100)}%`, ch[0], ch[1] + 46);
        ctx.fillText(`f ${hz} Hz`, ch[0], ch[1] + 60);
      }
      // The price, always shown -- red if firing now would kill you.
      const cost = Math.round(P.max.T * w.def.feedback), fatal = P.hp.T <= cost;
      ctx.fillStyle = fatal ? (floor(performance.now() / 200) % 2 ? RED : AMBER) : DIM;
      ctx.fillText(fatal ? 'DISCHARGE WILL BREACH YOUR TORSO' : `FEEDBACK -${cost} TORSO`, ch[0], ch[1] + (fs.mech ? 74 : 60));
    }
    if (G.scanWarn && performance.now() - G.scanWarn.at < 300 && floor(performance.now() / 150) % 2) {
      ctx.font = 'bold 15px "Lucida Console", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = RED;
      ctx.fillText(`RESONANCE SCAN -- ${app.net.pilotName(G.scanWarn.by)} ${Math.floor(G.scanWarn.p * 100)}%`, app.scene.view.W / 2, L.viewBottom * 0.22);
      ctx.font = '11px "Lucida Console", "Courier New", monospace';
    }
    // Laser: a ring that fills as the armour under the beam melts (the
    // damage multiplier). Only when the beam is on a mech.
    if (P.beaming && P.beamMech) {
      const mult = beamMult(P), k = (mult - 1) / (MELT_MAX - 1);
      ctx.strokeStyle = 'rgba(92,204,255,0.35)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ch[0], ch[1], 22, 0, TAU); ctx.stroke();
      ctx.strokeStyle = k >= 0.99 ? '#fff' : '#5cf';
      ctx.beginPath(); ctx.arc(ch[0], ch[1], 22, -PI / 2, -PI / 2 + TAU * k); ctx.stroke();
      ctx.lineWidth = 1; ctx.fillStyle = k >= 0.99 ? '#fff' : '#5cf'; ctx.textAlign = 'left';
      ctx.fillText(`x${mult.toFixed(1)}`, ch[0] + 28, ch[1] - 14);
    }
    // Arena hits are applied on the victim's phone; this X says yours landed.
    if (G.hitMark > 0) {
      ctx.strokeStyle = AMBER; ctx.lineWidth = 2; ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(ch[0] + dx * 6, ch[1] + dy * 6); ctx.lineTo(ch[0] + dx * 12, ch[1] + dy * 12); }
      ctx.stroke(); ctx.lineWidth = 1;
    }

    // Target brackets (gone while a bolt has the HUD scrambled).
    const scr = P.scramble > 0, t = scr ? null : G.target, sees = sightLine(G);
    if (t && t.alive && hypot(t.x - P.x, t.z - P.z) < sees) {
      const a = project([t.x, t.y + 8.2 * t.ch.scale, t.z]), b = project([t.x, t.y, t.z]);
      if (a && b) {
        const hgt = max(14, b[1] - a[1]), wdt = hgt * 0.75, x0 = a[0] - wdt / 2, y0 = a[1], k = min(10, wdt / 3);
        ctx.strokeStyle = G.lock ? RED : AMBER; ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [px, py, sx, sy] of [[x0, y0, 1, 1], [x0 + wdt, y0, -1, 1], [x0, y0 + hgt, 1, -1], [x0 + wdt, y0 + hgt, -1, -1]]) {
          ctx.moveTo(px + sx * k, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * k);
        }
        ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = G.lock ? RED : AMBER;
        ctx.textAlign = 'center';
        ctx.fillText(G.lock ? 'LOCK' : t.remote ? app.net.pilotName(t.netId) : t.ch.name, a[0], y0 - 8);
      }
      // Autocannon lead: a small diamond where a shell fired now would meet it, while it is moving and in range.
      const ac = P.weapons.find(w => w.def.kind === 'shell' && !w.dead && (w.ammo == null || w.ammo > 0));
      if (ac && Math.abs(t.speed) > 1 && hypot(t.x - P.x, t.z - P.z) < ac.def.range) {
        const lp = project(leadPoint(G.eye, t, ac.def.speed));
        if (lp) {
          ctx.strokeStyle = AMBER; ctx.beginPath();
          ctx.moveTo(lp[0], lp[1] - 6); ctx.lineTo(lp[0] + 6, lp[1]); ctx.lineTo(lp[0], lp[1] + 6); ctx.lineTo(lp[0] - 6, lp[1]); ctx.closePath(); ctx.stroke();
          ctx.fillStyle = AMBER; ctx.fillRect(lp[0] - 1, lp[1] - 1, 2, 2);
        }
      }
    }
    // Enemy markers in view (small chevrons), so far-off mechs can be found.
    for (const m of G.mechs) {
      if (!m.alive || m.team === 0 || m === t || hypot(m.x - P.x, m.z - P.z) > sees) continue;   // past what the weather lets you see
      const p = project([m.x, m.y + 9 * m.ch.scale, m.z]);
      if (!p || p[1] > L.viewBottom) continue;
      ctx.fillStyle = m.remote ? app.net.pilotCss(m.netId) : RED;
      ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1] - 6); ctx.lineTo(p[0] + 4, p[1] - 6); ctx.lineTo(p[0], p[1]); ctx.fill();
      if (m.remote) { ctx.textAlign = 'center'; ctx.fillText(app.net.pilotName(m.netId), p[0], p[1] - 14); }
    }

    // Compass tape: torso heading, with a mark for where the legs point.
    const tw = min(340, app.scene.view.W * 0.5), tx = app.scene.view.W / 2 - tw / 2, ty = 10;
    ctx.fillStyle = 'rgba(0,20,0,.55)'; ctx.fillRect(tx, ty, tw, 26);
    ctx.strokeStyle = DIM; ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 25);
    const hdg = ((-viewYaw(P) * 180 / PI) % 360 + 360) % 360;
    ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, 26); ctx.clip();
    ctx.textAlign = 'center'; ctx.fillStyle = GREEN; ctx.strokeStyle = GREEN;
    const pxPerDeg = tw / 120;
    for (let dgr = floor((hdg - 70) / 10) * 10; dgr <= hdg + 70; dgr += 10) {
      const x = app.scene.view.W / 2 + (dgr - hdg) * pxPerDeg, d = ((dgr % 360) + 360) % 360;
      ctx.beginPath(); ctx.moveTo(x, ty + 18); ctx.lineTo(x, ty + (d % 30 ? 22 : 15)); ctx.stroke();
      if (d % 30 === 0) ctx.fillText(compassLabel(d), x, ty + 8);
    }
    ctx.restore();
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.moveTo(app.scene.view.W / 2, ty + 26); ctx.lineTo(app.scene.view.W / 2 - 5, ty + 32); ctx.lineTo(app.scene.view.W / 2 + 5, ty + 32); ctx.fill();
    const legX = app.scene.view.W / 2 + clampN(P.twist * 180 / PI, -60, 60) * pxPerDeg;
    ctx.fillStyle = GREEN; ctx.fillRect(legX - 6, ty + 34, 12, 3);
    ctx.fillStyle = DIM; ctx.textAlign = 'left'; ctx.fillText('LEGS', legX + 9, ty + 36);

    layer(instruments);
    // Radar.
    const { x: rx, y: ry, r: rr } = L.radar;
    ctx.fillStyle = '#031203'; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = DIM; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, ry, rr / 2, 0, TAU); ctx.stroke();
    const vy = viewYaw(P), half = (G.zoom ? 0.42 : 1.08) * (app.scene.view.W / max(1, app.scene.view.H)) / 2;
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - sin(half) * rr, ry - cos(half) * rr);
    ctx.moveTo(rx, ry); ctx.lineTo(rx + sin(half) * rr, ry - cos(half) * rr); ctx.stroke();
    const RANGE = Math.round(RADAR_RANGE * radarOf(G) / 10) * 10;   // weather shrinks the radar's reach
    for (const m of G.mechs) {
      if (!m.alive || m === P) continue;
      const dx = m.x - P.x, dz = m.z - P.z, d = hypot(dx, dz);
      if (d > RANGE) continue;
      const ang = atan2(dx, dz) - vy;
      if (scr && random() < 0.4) continue;   // scrambled: blips drop out...
      const jit = scr ? rr * 0.15 : 0;      // ...and jump about
      const px = rx - sin(ang) * (d / RANGE) * rr + (random() - 0.5) * jit, py = ry - cos(ang) * (d / RANGE) * rr + (random() - 0.5) * jit;
      ctx.fillStyle = m === t ? AMBER : m.remote ? app.net.pilotCss(m.netId) : RED;
      ctx.fillRect(px - 2, py - 2, m === t ? 5 : 4, m === t ? 5 : 4);
    }
    ctx.fillStyle = GREEN; ctx.fillRect(rx - 1, ry - 1, 3, 3);
    for (const o of G.objectives || []) {   // objective blips: a hollow diamond, held at the rim when out of range
      const p = !app.net.mp() && objectivePoint(G, o);
      if (!p) continue;
      const dx = p[0] - P.x, dz = p[2] - P.z, f = min(1, hypot(dx, dz) / RANGE), ang = atan2(dx, dz) - vy;
      const bx = rx - sin(ang) * f * rr, by = ry - cos(ang) * f * rr;
      ctx.strokeStyle = o.def.secondary ? GREEN : AMBER; ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx + 4, by); ctx.lineTo(bx, by + 4); ctx.lineTo(bx - 4, by); ctx.closePath(); ctx.stroke();
    }
    if (scr) {   // static across the radar
      ctx.fillStyle = 'rgba(140,200,255,0.35)';
      for (let i = 0; i < 14; i++) ctx.fillRect(rx - rr + random() * rr * 2, ry - rr + random() * rr * 2, random() * rr * 0.6, 1);
    }
    ctx.fillStyle = DIM; ctx.textAlign = 'center'; ctx.fillText(`${RANGE}m`, rx, ry + rr + 9 > app.scene.view.H ? ry + rr - 8 : ry + rr + 8);

    // Left: own damage, heat, jump jets.
    ctx.textAlign = 'left';
    mechDiagram(P, L.diag.x, L.diag.y, L.diag.u);
    const bar = (x, label, f, col, warn) => {
      const bh = L.bars.h, top = L.bars.y;
      ctx.fillStyle = '#031203'; ctx.fillRect(x, top, 10, bh);
      ctx.fillStyle = warn ? (floor(G.time * 6) % 2 ? RED : AMBER) : col; ctx.fillRect(x, top + bh * (1 - clampN(f, 0, 1)), 10, bh * clampN(f, 0, 1));
      ctx.strokeStyle = DIM; ctx.strokeRect(x + 0.5, top + 0.5, 9, bh - 1);
      ctx.fillStyle = DIM; ctx.fillText(label, x - 1, top + bh + 8);
    };
    const lx = L.bars.x;
    // Near shutdown the instruments brown out: the bars flicker harder the hotter it runs.
    const hot = P.shutdown ? 0 : hotFrac(P.heat), browned = hot > 0 && (floor(G.time * 17) % 4 === 0 || (hot > 0.6 && floor(G.time * 23) % 5 === 0));
    if (browned) ctx.globalAlpha = 1 - HEAT.flicker * hot;
    bar(lx, 'HT', P.heat / 100, P.heat > 80 ? RED : P.heat > 55 ? AMBER : GREEN, P.heat > 85);
    bar(lx + 18, 'JJ', P.fuel, '#3cf');
    ctx.globalAlpha = 1;

    // Right: weapons.
    const wx = L.weapons.x;
    let wy = L.weapons.y;
    ctx.textAlign = 'left';
    for (const cat of CATS) {
      const ws = P.weapons.filter(w => CAT_OF[w.type] === cat);
      if (!ws.length) continue;
      const live = ws.filter(w => !w.dead), firingNow = !!G.input?.held[cat];
      ctx.fillStyle = !live.length ? '#622' : firingNow ? AMBER : GREEN;
      ctx.fillText(`${G.touchUI ? '' : CAT_KEY[cat].padEnd(6)}${CAT_LABEL[cat]}`, wx, wy);
      const ammo = live.find(w => w.def.ammo);
      ctx.fillStyle = GREEN;
      if (ammo) ctx.fillText(String(ammo.ammo).padStart(3), wx + 118, wy);
      // One small recharge bar per weapon of this kind (both lasers, say).
      const bw = (40 - (ws.length - 1) * 3) / ws.length;
      ws.forEach((w, i) => {
        const x = wx + 150 + i * (bw + 3);
        ctx.fillStyle = w.dead ? '#622' : '#031203'; ctx.fillRect(x, wy - 3, bw, 6);
        if (w.dead) return;
        if (w.def.kind === 'fusion') {
          const sc = P.fusion?.on && P.fusion.mech ? min(1, P.fusion.t / w.def.scan) : null;
          const f = sc ?? 1 - w.cd / w.def.cd;
          ctx.fillStyle = sc != null ? '#c8f' : f >= 1 ? GREEN : AMBER; ctx.fillRect(x, wy - 3, bw * max(0.04, f), 6);
        } else if (w.def.kind === 'beam') {
          // Beams don't recharge; show how melted the target's armour is.
          const k = P.beaming ? (beamMult(P) - 1) / (MELT_MAX - 1) : 0;
          ctx.fillStyle = P.beaming ? (k >= 0.99 ? '#fff' : '#5cf') : GREEN;
          ctx.fillRect(x, wy - 3, P.beaming ? bw * max(0.08, k) : bw, 6);
        } else { const f = 1 - w.cd / w.def.cd; ctx.fillStyle = f >= 1 ? GREEN : AMBER; ctx.fillRect(x, wy - 3, bw * f, 6); }
      });
      wy += 15;
    }

    // Throttle / speed.
    const thx = L.throttle.x, top = L.throttle.y, bh = L.throttle.h;
    ctx.fillStyle = '#031203'; ctx.fillRect(thx, top, 12, bh);
    const zero = top + bh * (1 / 1.35);
    const spF = P.speed / ((P.maxSpeed ?? P.ch.speed) * 1.35);
    ctx.fillStyle = GREEN;
    if (P.speed >= 0) ctx.fillRect(thx, zero - bh * spF, 12, bh * spF); else ctx.fillRect(thx, zero, 12, -bh * spF);
    ctx.strokeStyle = DIM; ctx.strokeRect(thx + 0.5, top + 0.5, 11, bh - 1);
    ctx.beginPath(); ctx.moveTo(thx - 3, zero); ctx.lineTo(thx + 15, zero); ctx.stroke();
    const thY = zero - bh * (P.throttle / 1.35);
    ctx.fillStyle = AMBER; ctx.beginPath(); ctx.moveTo(thx - 2, thY); ctx.lineTo(thx - 8, thY - 4); ctx.lineTo(thx - 8, thY + 4); ctx.fill();
    ctx.textAlign = L.frame ? 'right' : 'left'; ctx.fillStyle = GREEN;
    ctx.fillText(`${Math.round(P.speed * 5.4)} KPH`, L.frame ? thx - 10 : thx, L.frame ? top + bh + 8 : top - 10);

    layer('hud');
    // Target panel.
    if (t && t.alive) {
      const px = L.target.x, py = L.target.y, pw = 150, ph = 92;
      ctx.fillStyle = 'rgba(0,20,0,.6)'; ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = DIM; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      ctx.textAlign = 'left'; ctx.fillStyle = AMBER;
      ctx.fillText(`TGT ${t.remote ? app.net.pilotName(t.netId) : t.ch.name}`, px + 6, py + 10);
      ctx.fillStyle = GREEN;
      const rng = hypot(t.x - P.x, t.z - P.z);
      // Closing rate, smoothed: the number that tells you whether to lead or to run.
      if (rangeMemo.t !== t || G.time - rangeMemo.at > 1) rangeMemo = { t, r: rng, at: G.time, rate: 0 };
      else if (G.time > rangeMemo.at) { const inst = (rng - rangeMemo.r) / (G.time - rangeMemo.at); rangeMemo.rate += (inst - rangeMemo.rate) * 0.15; rangeMemo.r = rng; rangeMemo.at = G.time; }
      ctx.fillText(`RNG ${Math.round(rng)}m`, px + 6, py + 24);
      ctx.fillText(t.shutdown ? 'SHUTDOWN' : `${Math.round(t.speed * 5.4)} KPH`, px + 6, py + 38);
      const rate = rangeMemo.rate;
      ctx.fillStyle = Math.abs(rate) < 1 ? DIM : GREEN;
      ctx.fillText(Math.abs(rate) < 1 ? 'HOLDING' : `${rate < 0 ? 'CLOSING' : 'OPENING'} ${Math.round(Math.abs(rate))} m/s`, px + 6, py + 52);
      if (t.kind) {   // a structure: one bar of what is left
        const bx = px + pw - 26, by = py + 14, bh = 64, f = Math.max(0, t.hp / t.max);
        ctx.strokeStyle = DIM; ctx.strokeRect(bx + 0.5, by + 0.5, 11, bh);
        ctx.fillStyle = f > 0.5 ? GREEN : f > 0.25 ? AMBER : RED; ctx.fillRect(bx + 2, by + 2 + (bh - 3) * (1 - f), 8, (bh - 3) * f);
      } else mechDiagram(t, px + pw - 32, py + 14, 6);
    }

    // Objectives: a line each under the compass (secondaries dimmer), a marker
    // where each one is (clamped to the edge when off-screen) and a blip on the radar.
    // (A mission with no objectives listed is the old ELIMINATE, which HOSTILES already counts.)
    const objs = !app.net.mp() && G.def?.objectives && G.objectives ? G.objectives.filter(o => o.state === 'active' && (o.def.type !== 'eliminate' || o.total != null)) : [];
    ctx.textAlign = 'center'; ctx.font = '11px "Lucida Console", monospace';
    objs.forEach((o, i) => { ctx.fillStyle = o.def.secondary ? GREEN : AMBER; ctx.fillText(objectiveLine(o), app.scene.view.W / 2, 58 + i * 13); });
    for (const o of objs) {
      const p = objectivePoint(G, o);
      if (p) drawMarker(L, p, o.def.secondary ? GREEN : AMBER);
    }
    // Status lines.
    ctx.textAlign = 'center';
    let my = 64 + objs.length * 13;
    for (const m of G.msgs) {
      ctx.globalAlpha = min(1, m.t);
      ctx.fillStyle = m.col; ctx.fillText(m.text, app.scene.view.W / 2, my); my += 15;
    }
    ctx.globalAlpha = 1;
    layer(null);
    if (P.shutdown) {
      // Power's gone: the instruments go dark under a veil; only the warning stays bright.
      ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, 0, app.scene.view.W, app.scene.view.H);
      ctx.font = 'bold 22px "Lucida Console", monospace';
      ctx.fillStyle = floor(G.time * 3) % 2 ? RED : AMBER;
      ctx.fillText('REACTOR SHUTDOWN', app.scene.view.W / 2, L.viewBottom * 0.4);
    }
    layer('hud');
    if (G.zoom) { ctx.font = '11px "Lucida Console", monospace'; ctx.fillStyle = GREEN; ctx.fillText('ZOOM 2.5x', app.scene.view.W / 2, L.viewBottom - (L.frame ? 10 : 24)); }
    const left = G.mechs.filter(m => m.alive && m.team !== 0).length;
    ctx.font = '11px "Lucida Console", monospace'; ctx.textAlign = 'right'; ctx.fillStyle = DIM;
    ctx.fillText(app.net.mp() ? `PILOTS ${app.net.Net.info.size}  FIRST TO ${app.net.Net.limit}` : `HOSTILES ${left}`, L.hostiles.x, L.hostiles.y);
    if (app.net.mp()) drawArenaHUD(L);
    // Phones held upright get a cramped, stretched view.
    if (G.touchUI && app.scene.view.H > app.scene.view.W) {
      ctx.font = 'bold 16px "Lucida Console", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = AMBER;
      ctx.fillText('TURN YOUR DEVICE SIDEWAYS', app.scene.view.W / 2, app.scene.view.H * 0.3);
    }
  }


  return { draw: drawHUD, hudLayout };
}
