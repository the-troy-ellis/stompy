import { TAU, clampN, len, rnd, sub } from '../util/math.js';
import { WEAPONS, CATS, CAT_OF, CAT_LABEL, CAT_KEY } from '../data/weapons.js';
import { MP_COLORS } from '../data/colors.js';
import { center, viewYaw } from '../sim/geom.js';
import { MELT_MAX, beamMult } from '../sim/beams.js';

const { sin, cos, atan2, min, max, PI, random, hypot, floor } = Math;

// The compass tape's label for a heading in degrees: a cardinal letter on
// the quarters, otherwise the heading in tens (030, 120...) as two digits.
export const compassLabel = d => ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10).padStart(2, '0'));

// The ?debug=1 label over an enemy: its state, its profile, its group (with
// a star on the flanker), and what it is up to right now.
export function aiLabel(e) {
  const a = e.ai || {}, g = a.group;
  let s = `${(a.state || 'patrol').toUpperCase()} ${e.ch?.ai?.profile || 'baseline'}`;
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

  // ?debug=1: frame time over the last 2 s, draw calls, particles, the seed.
  const frames = [];
  let lastFrameAt = 0;
  function drawDebug() {
    const now = performance.now();
    if (lastFrameAt) frames.push(now - lastFrameAt);
    lastFrameAt = now;
    while (frames.length > 120) frames.shift();
    const sorted = [...frames].sort((a, b) => a - b), q = f => (sorted.length ? sorted[min(sorted.length - 1, floor(sorted.length * f))] : 0);
    ctx.font = '11px "Lucida Console", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#9f9';
    const lines = [`FRAME ${q(0.5).toFixed(1)} ms  P95 ${q(0.95).toFixed(1)} ms`, `DRAWS ${app.R.draws}  PARTICLES ${G.parts.length}  MECHS ${G.mechs.length}`, `SEED ${G.ter?.seed ?? '-'}  T ${G.time.toFixed(1)}  STATE ${G.state}`];
    lines.forEach((l, i) => ctx.fillText(l, 12, app.scene.view.H * 0.5 + i * 13));
    drawAIDebug();
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
  function drawHUD() {
    ctx.setTransform(app.scene.view.dpr, 0, 0, app.scene.view.dpr, 0, 0);
    ctx.clearRect(0, 0, app.scene.view.W, app.scene.view.H);
    if (app.params.has('debug')) drawDebug();
    if (G.state === 'menu') return;
    if (G.guide) { drawGuideHUD(); return; }
    ctx.translate(0, G.kick * 3);  // the dashboard jolts with each step
    const P = G.player, L = hudLayout(), dash = L.dash;
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

    // Damage flash.
    if (G.flash > 0) { ctx.fillStyle = `rgba(255,40,20,${G.flash * 0.4})`; ctx.fillRect(0, 0, app.scene.view.W, app.scene.view.H); }
    if (G.whiteFlash > 0) { ctx.fillStyle = `rgba(235,215,255,${G.whiteFlash * 0.85})`; ctx.fillRect(0, 0, app.scene.view.W, app.scene.view.H); }

    // Crosshair.
    const ch = project(G.aim) || [app.scene.view.W / 2, app.scene.view.H / 2];
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

    // Target brackets.
    const t = G.target;
    if (t && t.alive) {
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
    }
    // Enemy markers in view (small chevrons), so far-off mechs can be found.
    for (const m of G.mechs) {
      if (!m.alive || m.team === 0 || m === t) continue;
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

    // Radar.
    const { x: rx, y: ry, r: rr } = L.radar;
    ctx.fillStyle = '#031203'; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = DIM; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, ry, rr / 2, 0, TAU); ctx.stroke();
    const vy = viewYaw(P), half = (G.zoom ? 0.42 : 1.08) * (app.scene.view.W / max(1, app.scene.view.H)) / 2;
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - sin(half) * rr, ry - cos(half) * rr);
    ctx.moveTo(rx, ry); ctx.lineTo(rx + sin(half) * rr, ry - cos(half) * rr); ctx.stroke();
    const RANGE = 800;
    for (const m of G.mechs) {
      if (!m.alive || m === P) continue;
      const dx = m.x - P.x, dz = m.z - P.z, d = hypot(dx, dz);
      if (d > RANGE) continue;
      const ang = atan2(dx, dz) - vy;
      const px = rx - sin(ang) * (d / RANGE) * rr, py = ry - cos(ang) * (d / RANGE) * rr;
      ctx.fillStyle = m === t ? AMBER : m.remote ? app.net.pilotCss(m.netId) : RED;
      ctx.fillRect(px - 2, py - 2, m === t ? 5 : 4, m === t ? 5 : 4);
    }
    ctx.fillStyle = GREEN; ctx.fillRect(rx - 1, ry - 1, 3, 3);
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
    bar(lx, 'HT', P.heat / 100, P.heat > 80 ? RED : P.heat > 55 ? AMBER : GREEN, P.heat > 85);
    bar(lx + 18, 'JJ', P.fuel, '#3cf');

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
    const spF = P.speed / (P.ch.speed * 1.35);
    ctx.fillStyle = GREEN;
    if (P.speed >= 0) ctx.fillRect(thx, zero - bh * spF, 12, bh * spF); else ctx.fillRect(thx, zero, 12, -bh * spF);
    ctx.strokeStyle = DIM; ctx.strokeRect(thx + 0.5, top + 0.5, 11, bh - 1);
    ctx.beginPath(); ctx.moveTo(thx - 3, zero); ctx.lineTo(thx + 15, zero); ctx.stroke();
    const thY = zero - bh * (P.throttle / 1.35);
    ctx.fillStyle = AMBER; ctx.beginPath(); ctx.moveTo(thx - 2, thY); ctx.lineTo(thx - 8, thY - 4); ctx.lineTo(thx - 8, thY + 4); ctx.fill();
    ctx.textAlign = L.frame ? 'right' : 'left'; ctx.fillStyle = GREEN;
    ctx.fillText(`${Math.round(P.speed * 5.4)} KPH`, L.frame ? thx - 10 : thx, L.frame ? top + bh + 8 : top - 10);

    // Target panel.
    if (t && t.alive) {
      const px = L.target.x, py = L.target.y, pw = 150, ph = 92;
      ctx.fillStyle = 'rgba(0,20,0,.6)'; ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = DIM; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      ctx.textAlign = 'left'; ctx.fillStyle = AMBER;
      ctx.fillText(`TGT ${t.remote ? app.net.pilotName(t.netId) : t.ch.name}`, px + 6, py + 10);
      ctx.fillStyle = GREEN;
      ctx.fillText(`RNG ${Math.round(hypot(t.x - P.x, t.z - P.z))}m`, px + 6, py + 24);
      ctx.fillText(t.shutdown ? 'SHUTDOWN' : `${Math.round(t.speed * 5.4)} KPH`, px + 6, py + 38);
      mechDiagram(t, px + pw - 32, py + 14, 6);
    }

    // Status lines.
    ctx.textAlign = 'center';
    let my = 64;
    for (const m of G.msgs) {
      ctx.globalAlpha = min(1, m.t);
      ctx.fillStyle = m.col; ctx.fillText(m.text, app.scene.view.W / 2, my); my += 15;
    }
    ctx.globalAlpha = 1;
    if (P.shutdown) {
      // Power's gone: the instruments go dark under a veil; only the warning stays bright.
      ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, 0, app.scene.view.W, app.scene.view.H);
      ctx.font = 'bold 22px "Lucida Console", monospace';
      ctx.fillStyle = floor(G.time * 3) % 2 ? RED : AMBER;
      ctx.fillText('REACTOR SHUTDOWN', app.scene.view.W / 2, L.viewBottom * 0.4);
    }
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
