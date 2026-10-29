import { VERSION } from '../util/version.js';
const VERSION_LINE = `v${VERSION}`;   // made once: the readout runs every frame
import { CHEATS } from '../data/debug.js';
import { CONSTRUCT, PLACE, PLACE_ORDER } from '../data/construct.js';
import { NAMES } from '../data/names.js';
import { SWAP_WIPE } from '../sim/crew.js';
import { RADAR_RANGE, radarOf, fogOf } from '../data/weather.js';
import { TAU, clampN, len, rnd, sub } from '../util/math.js';
import { WEAPONS, CATS, CAT_OF, CAT_LABEL, CAT_KEY } from '../data/weapons.js';
import { MP_COLORS, hudPalette } from '../data/colors.js';
import { HUD_SCALES } from '../data/settings.js';
import { center, leadPoint, viewYaw } from '../sim/geom.js';
import { objectivePoint } from '../sim/objectives.js';
import { navOf, SQ } from '../sim/ai/nav.js';
import { DIG_LOG_S } from '../sim/dig.js';
import { MELT_MAX, beamMult } from '../sim/beams.js';
import { HEAT, hotFrac, FEEL } from '../data/feel.js';
import { makeSpring, stepSpring } from '../util/spring.js';
import { liveKills, killWords } from '../net/killfeed.js';
import { teamCss, teamName } from '../net/teams.js';
import { TUT } from '../data/tutorial.js';

const LAG_MS = 200;   // a round trip to the relay past this shows LAG (docs/specs/10-internet-play.md § Latency)

const { sin, cos, atan2, min, max, PI, random, hypot, floor } = Math;
const NO_CATS = [];
const FUSION_NO_TARGET = `${WEAPONS.fusion.name}: NO TARGET`;   // made once

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
    case 'keep': return fit(`KEEP ${d.label || 'TARGETS'} UP`, '');
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
const COMPASS = Array.from({ length: 36 }, (_, i) => ({ 0: 'N', 9: 'E', 18: 'S', 27: 'W' }[i] || String(i).padStart(2, '0')));   // made once: the tape draws a dozen a frame
export const compassLabel = d => COMPASS[(d / 10) | 0];

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

  const project = p => {
    const v = G.VP, x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12], y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
    const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
    if (w <= 0.1) return null;
    return [(x / w * 0.5 + 0.5) * V.W, (1 - (y / w * 0.5 + 0.5)) * V.H];
  };
  // The colour set (COLOURS) and the size (HUD SCALE), read every frame. The
  // HUD is drawn in V's units: the screen over the scale, so one canvas scale
  // grows every instrument, font and gap together.
  let GREEN, DIM, AMBER, RED, HP;
  const V = { W: 0, H: 0, s: 1 };
  const setLook = () => {
    const pal = hudPalette(app.prefs.colourMode);
    ({ good: GREEN, dim: DIM, warn: AMBER, bad: RED, hp: HP } = pal);
    // On touch the instruments sit around the thumbs' controls, which don't
    // grow: a phone gets as much of the scale as it has room for (its HUD at
    // least 640 x 360, so a 360-tall phone stays at 1), never less than 1. A
    // tablet gets all of it.
    const want = HUD_SCALES[app.prefs.hudScale] || 1, room = min(app.scene.view.W / 640, app.scene.view.H / 360);
    V.s = G.touchUI ? min(want, max(1, room)) : want;
    V.W = app.scene.view.W / V.s; V.H = app.scene.view.H / V.s;
  };
  setLook();
  const hpCol = f => (f <= 0 ? HP[3] : f > 0.66 ? HP[0] : f > 0.33 ? HP[1] : HP[2]);

  function mechDiagram(m, x, y, u) {
    const box = (k, rx, ry, rw, rh) => {
      ctx.fillStyle = hpCol(m.hp[k] / m.max[k]);
      ctx.fillRect(x + rx * u, y + ry * u, rw * u - 1, rh * u - 1);
      ctx.strokeStyle = DIM; ctx.strokeRect(x + rx * u + 0.5, y + ry * u + 0.5, rw * u - 2, rh * u - 2);
    };
    box('LA', -3.2, 0.2, 1.4, 3.6); box('T', -1.6, 0, 3.2, 4.2); box('RA', 1.8, 0.2, 1.4, 3.6);
    box('LL', -1.6, 4.4, 1.5, 4); box('RL', 0.1, 4.4, 1.5, 4);
  }
  // Your own damage: your mech in wireframe, posed as it is this frame (it
  // walks, twists and aims as you do), turning slowly on the spot so every
  // side shows in time (held still, from behind and a little to one side,
  // with REDUCED MOTION), each section's lines in its damage colour. A
  // section that's gone is gone. (x, y) is the top centre of a box `u` units across: the same
  // footprint as the old box diagram (the fallback before a pose exists).
  // WIRE_HALF: the box's half-width in u, wider than the old box diagram's 4.4: a spinning WARDEN is as wide as it is tall.
  const WIRE_HALF = 6, WIRE_YAW = 0.3, WIRE_SPIN = TAU / 16, WIRE_TILT = 0.2, ct = Math.cos(WIRE_TILT), st = Math.sin(WIRE_TILT);   // SPIN: once round in 16 s
  // Whole pixels: small integers reach the canvas unboxed, so the lines make no garbage.
  const WIRE_SECS = ['T', 'LA', 'RA', 'LL', 'RL'], wirePaths = Object.fromEntries(WIRE_SECS.map(k => [k, { pts: new Int16Array(16384), n: 0 }]));
  // Each mech's reach for the diagram's scale, per partsKey: [height, distance from its upright axis],
  // the most seen so far (a long stride or a WARDEN's splayed legs reach wider than it stands still).
  const wireExt = new Map(), seen = new Float64Array(2);
  function mechWire(m, x, y, u, round = 0) {   // round: clip to a circle of that radius round the box's middle (the ring), else to the box
    const pose = app.scene.poseWire?.(m);
    if (!pose) { mechDiagram(m, x, y, u); return; }
    let ext = wireExt.get(m.partsKey);
    if (!ext) wireExt.set(m.partsKey, ext = extentOf(pose));
    // It spins, so its width is twice its reach from the axis; tilted toward you, the near
    // feet sit below the baseline and the far ones above. Whichever fits tighter sets the scale.
    const h = 10.5 * u, half = WIRE_HALF * u - 3, top = ext[0], r = ext[1];
    const k = min((h - 2) / ((top * ct + 2 * r * st) * 1.04), half / (r * 1.04)), ox = x, oy = y + h - 2 - r * st * k;
    seen[0] = 0; seen[1] = 0;
    const turn = WIRE_YAW + (G.reducedMotion ? 0 : G.time * WIRE_SPIN), cy0 = Math.cos(turn), sy0 = Math.sin(turn);
    for (const sec of WIRE_SECS) wirePaths[sec].n = 0;
    for (let j = 0; j < pose.n; j++) {
      const part = pose.parts[j], path = wirePaths[part.sec];
      path.n = wireEdges(part.edges, part.mat, path.pts, path.n, cy0, sy0, ox, oy, k);
    }
    ext[0] = max(ext[0], seen[0]); ext[1] = max(ext[1], Math.sqrt(seen[1]));   // next frame fits anything reached this one
    ctx.save();
    ctx.beginPath();
    if (round) ctx.arc(x, y + h / 2, round, 0, TAU); else ctx.rect(x - WIRE_HALF * u, y - u, 2 * WIRE_HALF * u, h + u);
    ctx.clip();   // a long stride stays in its box
    ctx.lineWidth = 1;
    for (const sec of WIRE_SECS) {
      const { pts, n } = wirePaths[sec];
      if (!n) continue;
      ctx.strokeStyle = hpCol(m.hp[sec] / m.max[sec]);
      ctx.beginPath();
      for (let i = 0; i + 3 < n; i += 4) { ctx.moveTo(pts[i], pts[i + 1]); ctx.lineTo(pts[i + 2], pts[i + 3]); }
      ctx.stroke();
    }
    ctx.restore();
  }
  // One part's edges onto the diagram, appended to pts from n; returns the new n.
  // Its own small function, called per part: a once-a-frame loop stays half
  // compiled (on-stack replacement that exits every call) and boxes every number.
  function wireEdges(e, q, pts, n, cy0, sy0, ox, oy, k) {
    for (let i = 0; i < e.length && n < pts.length; i += 3) {
      const px = e[i], py = e[i + 1], pz = e[i + 2];
      const X = q[0] * px + q[4] * py + q[8] * pz + q[12], Y = q[1] * px + q[5] * py + q[9] * pz + q[13], Z = q[2] * px + q[6] * py + q[10] * pz + q[14];
      if (Y > seen[0]) seen[0] = Y;
      const rr = X * X + Z * Z; if (rr > seen[1]) seen[1] = rr;   // typed array: no garbage
      const Xv = X * cy0 + Z * sy0, Zv = -X * sy0 + Z * cy0;   // turned about its own feet, then seen from behind: its left on your left
      pts[n++] = Math.round(ox - Xv * k); pts[n++] = Math.round(oy - (Y * ct + Zv * st) * k);
    }
    return n;
  }
  // The posed mech's height and reach from its upright axis, the first time it's drawn (with some room for a stride).
  function extentOf(pose) {
    let top = 0, r2 = 0;
    for (let j = 0; j < pose.n; j++) {
      const { edges: e, mat: q } = pose.parts[j];
      for (let i = 0; i < e.length; i += 3) {
        const X = q[0] * e[i] + q[4] * e[i + 1] + q[8] * e[i + 2] + q[12], Z = q[2] * e[i] + q[6] * e[i + 1] + q[10] * e[i + 2] + q[14];
        top = max(top, q[1] * e[i] + q[5] * e[i + 1] + q[9] * e[i + 2] + q[13]); r2 = max(r2, X * X + Z * Z);
      }
    }
    return new Float64Array([top || 8, Math.sqrt(r2) * 1.05 || 3]);
  }


  // An objective marker: a diamond with the distance under it; off-screen (or
  // behind), held at the edge of the view with an arrow pointing the way.
  function drawMarker(L, p, col) {
    const P = G.player, W = V.W, top = 72, bottom = L.viewBottom - 16, m = 18;
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

  // The ring (the owner's sketch): your mech's damage wireframe in the middle,
  // a bit bigger than it was, and round it three arcs with gaps at the top and
  // the lower corners. Left: heat, filling upward. Right: jump jets, filling
  // upward. Bottom: speed from reverse through zero to full, left to right,
  // with the throttle's setting marked (amber) and KPH under it. (x, y) is
  // its middle; the wire's box (u units, mechWire) sits inside the arcs.
  const RING_GAP = 0.2, RING_W = 8;   // radians either side of each gap; arc thickness, px
  const ringLayout = (x, y, r) => ({ x, y, r, u: (r - RING_W) * 0.16 });
  // An arc from angle a0 to a1 (canvas radians; anticlockwise when a1 < a0), filled to `f` from the a0 end.
  function ringArc(R, a0, a1, f, col) {
    const back = a1 < a0;
    ctx.lineWidth = RING_W + 2; ctx.strokeStyle = DIM; ctx.beginPath(); ctx.arc(R.x, R.y, R.r, a0, a1, back); ctx.stroke();
    ctx.lineWidth = RING_W; ctx.strokeStyle = '#031203'; ctx.beginPath(); ctx.arc(R.x, R.y, R.r, a0, a1, back); ctx.stroke();
    if (f > 0) { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(R.x, R.y, R.r, a0, a0 + (a1 - a0) * f, back); ctx.stroke(); }
  }
  const LOWER_L = PI * 0.75, LOWER_R = PI * 0.25, UP = -PI / 2;   // canvas angles: y grows downward
  function drawRing(R, P) {
    const h = 10.5 * R.u;
    mechWire(P, R.x, R.y - h / 2 - R.u * 0.3, R.u, R.r - RING_W);
    // Near shutdown the instruments brown out: the arcs flicker harder the hotter it runs.
    const hot = P.shutdown ? 0 : hotFrac(P.heat), browned = hot > 0 && (floor(G.time * 17) % 4 === 0 || (hot > 0.6 && floor(G.time * 23) % 5 === 0));
    if (browned) ctx.globalAlpha = 1 - HEAT.flicker * hot;
    const heatCol = P.heat > 85 ? (floor(G.time * 6) % 2 ? RED : AMBER) : P.heat > 80 ? RED : P.heat > 55 ? AMBER : GREEN;
    ringArc(R, LOWER_L + RING_GAP, UP + TAU - RING_GAP, clampN(P.heat / 100, 0, 1), heatCol);   // left: from the lower left, up
    // Right, from the lower right up (anticlockwise): the jets (sim/jets.js). Charging, the charge,
    // blinking white when full; otherwise how ready they are, filling back up after a blast.
    const charge = P.jet?.charge || 0;
    ringArc(R, LOWER_R - RING_GAP, UP + RING_GAP, charge ? charge : clampN(P.fuel, 0, 1), charge >= 1 && floor(G.time * 8) % 2 ? '#fff' : charge ? AMBER : '#3cf');
    ctx.globalAlpha = 1;
    // Bottom: speed. Its scale runs from full reverse (left) to 1.35 x top speed (right), zero at 0.35 / 1.35.
    const b0 = LOWER_L - RING_GAP, b1 = LOWER_R + RING_GAP, span = b1 - b0, at = v => b0 + span * clampN((v + 0.35) / 1.35, 0, 1);
    ringArc(R, b0, b1, 0, GREEN);
    const sp = P.speed / (P.maxSpeed ?? P.ch.speed), zero = at(0);
    ctx.lineWidth = RING_W; ctx.strokeStyle = GREEN; ctx.beginPath();
    if (sp >= 0) ctx.arc(R.x, R.y, R.r, at(sp), zero); else ctx.arc(R.x, R.y, R.r, zero, at(sp));   // b0 > b1: the arc runs anticlockwise, right to left
    ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = DIM; ctx.beginPath();   // the zero tick
    ctx.moveTo(R.x + Math.cos(zero) * (R.r - RING_W), R.y + sin(zero) * (R.r - RING_W)); ctx.lineTo(R.x + Math.cos(zero) * (R.r + RING_W), R.y + sin(zero) * (R.r + RING_W)); ctx.stroke();
    const t = at(P.throttle), tx = R.x + Math.cos(t) * (R.r + RING_W / 2 + 2), ty = R.y + sin(t) * (R.r + RING_W / 2 + 2);   // the setting: an amber notch outside the arc
    ctx.fillStyle = AMBER; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(t + 0.09) * 7, ty + sin(t + 0.09) * 7); ctx.lineTo(tx + Math.cos(t - 0.09) * 7, ty + sin(t - 0.09) * 7); ctx.fill();
    ctx.lineWidth = 1;
    ctx.font = '10px "Lucida Console", monospace'; ctx.fillStyle = DIM;
    ctx.textAlign = 'right'; ctx.fillText('HT', R.x - R.r * 0.72, R.y + R.r * 0.86);
    ctx.textAlign = 'left'; ctx.fillText('JJ', R.x + R.r * 0.72, R.y + R.r * 0.86);
    ctx.textAlign = 'center'; ctx.fillStyle = GREEN; ctx.fillText(`${Math.round(P.speed * 5.4)} KPH`, R.x, R.y + R.r + RING_W + 10);
    ctx.textAlign = 'left';
  }

  // Where each instrument goes. Desktop: the cockpit dashboard along the
  // bottom. Touch: no dashboard -- the bottom belongs to the thumbs and the
  // controls -- so instruments move to the top corners.
  function hudLayout() {
    if (!G.touchUI) {
      const dash = min(150, V.H * 0.27), top = V.H - dash + 8;
      return {
        frame: true, dash, viewBottom: V.H - dash,
        radar: { x: V.W / 2, y: V.H - dash / 2 + 4, r: dash * 0.4 },
        ring: ringLayout(V.W * 0.1 + 12 + dash * 0.4, V.H - dash / 2 - 6, dash * 0.38),   // your own mech, heat, jets and throttle (drawRing)
        weapons: { x: min(V.W * 0.62, V.W * 0.9 - 26 - 200), y: top + 4 },   // the list is 190 wide: never into the throttle (HUD SCALE)
        hostiles: { x: V.W * 0.965 - 10, y: 20 },
        crew: { x: V.W * 0.965 - 10, y: 34 },   // spec 20's crew strip: under HOSTILES
        compass: { w: min(340, V.W * 0.5) },
      };
    }
    const r = clampN(V.H * 0.12, 30, 46), btnX = 132 / V.s;   // the right edge of the pause and zoom buttons, which don't scale
    return {
      frame: false, dash: 0, viewBottom: V.H,
      radar: { x: V.W - r - 14, y: r + 12, r },
      ring: ringLayout(18 + 54, 112 + 54, 54),
      weapons: { x: V.W - 205, y: 2 * r + 34 },
      hostiles: { x: V.W - 14, y: 2 * r + 34 + 56 },   // under the weapon list, clear of the compass
      crew: { x: V.W - 2 * r - 30, y: 20 },   // left of the radar, clear of the buttons below
      compass: { w: max(120, min(340, V.W * 0.5, V.W - 2 * (btnX + 8))) },   // narrower on a phone: clear of the buttons
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
  // Mission 1's prompt (sim/tutorial.js), by the instrument it's about, in
  // the words for whatever the pilot is holding: keys, glass or a pad.
  function drawTutorial(L) {
    const c = G.tut?.cur;
    if (!c || !G.player.alive) return;
    const text = c[G.padActive ? 'pad' : G.touchUI ? 'touch' : 'kb'], W = V.W, vb = L.viewBottom;
    const at = {
      throttle: [L.ring.x, L.frame ? L.ring.y - L.ring.r - 26 : L.ring.y + L.ring.r + 30], weapons: [L.weapons.x + 60, L.weapons.y - (L.frame ? 34 : 14)], heat: [L.ring.x, L.frame ? L.ring.y - L.ring.r - 26 : L.ring.y + L.ring.r + 30],
      target: [W / 2, vb * 0.74], compass: [W / 2, vb * 0.3], centre: [W / 2, vb * 0.64],
    }[c.at] || [W / 2, vb * 0.64];
    ctx.font = 'bold 15px "Lucida Console", monospace'; ctx.textAlign = 'center';
    const w = ctx.measureText(text).width, x = clampN(at[0], w / 2 + 10, W - w / 2 - 10), y = clampN(at[1], 20, V.H - 12);
    ctx.globalAlpha = clampN(min(c.t * 4, 1 - c.fade / TUT.fade), 0, 1);   // in quickly; out as the pilot does it
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - w / 2 - 6, y - 12, w + 12, 18);
    ctx.fillStyle = AMBER; ctx.fillText(text, x, y + 2);
    ctx.globalAlpha = 1;
  }
  // Co-op, down: who you're watching and when you're back (sim/coopRules.js).
  function drawCoopDown(L) {
    const P = G.player, r = G.coopRespawn;
    if (P.alive || !r) return;
    const n = Math.ceil(max(0, r.at - G.time)), W2 = V.W / 2;
    ctx.textAlign = 'center';
    if (G.spectate) {
      const top = L.viewBottom - (L.frame ? 46 : 64);
      ctx.font = 'bold 14px "Lucida Console", monospace'; ctx.fillStyle = AMBER;
      ctx.fillText(`SPECTATING ${app.net.pilotName(G.spectate.id)}`, W2, top);
      ctx.font = '12px "Lucida Console", monospace'; ctx.fillStyle = GREEN;
      ctx.fillText(`BACK IN ${n}  ·  ${G.touchUI ? 'TGT' : 'T'}: NEXT PILOT`, W2, top + 18);
    } else {
      ctx.font = 'bold 22px "Lucida Console", monospace'; ctx.fillStyle = RED;
      ctx.fillText('MECH DESTROYED', W2, L.viewBottom * 0.5);
      ctx.font = '14px "Lucida Console", monospace'; ctx.fillStyle = AMBER;
      ctx.fillText(`BACK IN ${n}`, W2, L.viewBottom * 0.5 + 26);
    }
    ctx.font = '11px "Lucida Console", monospace';
  }
  // Scoreboard, death / respawn, spawn shield, and the round banner.
  function drawArenaHUD(L) {
    const P = G.player;
    const board = app.net.arenaBoard();
    let y = L.hostiles.y + 14;
    const x = L.hostiles.x;
    ctx.textAlign = 'right';
    if (app.net.tdm()) {
      // Team deathmatch: each side's kills in its colour, yours first.
      const mine = app.net.myTeam(), parts = [mine, 1 - mine].map(t => [`${teamName(t)} ${app.net.Net.teams[t]}`, teamCss(t)]);
      let px = x;
      for (let i = parts.length - 1; i >= 0; i--) { ctx.fillStyle = parts[i][1]; ctx.fillText(parts[i][0], px, y); px -= ctx.measureText(parts[i][0]).width + 12; }
      y += 14;
    }
    if (G.touchUI) {
      // Phones: one line -- the full board would sit under the fire buttons.
      // (It's in the menu.)
      const rank = board.findIndex(p => p.id === app.net.Net.id) + 1, me = app.net.Net.info.get(app.net.Net.id), lead = board[0];
      ctx.fillStyle = AMBER;
      ctx.fillText(app.net.tdm() ? `YOU ${me ? `${me.kills}/${me.deaths}` : ''}` : `#${rank} ${me ? `${me.kills}/${me.deaths}` : ''}${lead && lead.id !== app.net.Net.id ? `  LEAD ${lead.name} ${lead.kills}` : ''}`, x, y);
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
    if (!P.alive && G.spectate) {
      // Watching another pilot until the respawn (net/spectate.js): low in the view, clear of the messages.
      const top = L.viewBottom - (L.frame ? 46 : 64), who = G.spectate.id;
      ctx.font = 'bold 14px "Lucida Console", monospace'; ctx.fillStyle = AMBER;
      ctx.fillText(`SPECTATING ${app.net.pilotName(who)}`, V.W / 2, top);
      ctx.font = '12px "Lucida Console", monospace'; ctx.fillStyle = GREEN;
      ctx.fillText(`RESPAWN IN ${Math.ceil(max(0, (G.respawnAt - G.clock) / 1000))}  ·  ${G.touchUI ? 'TGT' : 'T'}: NEXT PILOT`, V.W / 2, top + 18);
    } else if (!P.alive) {
      ctx.font = 'bold 22px "Lucida Console", monospace'; ctx.fillStyle = RED;
      ctx.fillText(G.killer ? `DESTROYED BY ${app.net.pilotName(G.killer)}` : 'MECH DESTROYED', V.W / 2, mid);
      ctx.font = '14px "Lucida Console", monospace'; ctx.fillStyle = AMBER;
      ctx.fillText(`RESPAWN IN ${Math.ceil(max(0, (G.respawnAt - G.clock) / 1000))}`, V.W / 2, mid + 26);
    } else if (P.spawnT > 0) {
      ctx.font = '13px "Lucida Console", monospace'; ctx.fillStyle = '#3cf';
      ctx.fillText('SHIELDED', V.W / 2, mid + 40);
    }
    if (G.roundOver && G.banner && !G.summary) {   // the summary overlay (ui/summary.js) says it instead
      ctx.font = 'bold 24px "Arial Black", Arial, sans-serif'; ctx.fillStyle = AMBER;
      ctx.fillText(G.banner.text, V.W / 2, L.viewBottom * 0.37);
      ctx.font = '13px "Lucida Console", monospace'; ctx.fillStyle = GREEN;
      ctx.fillText(`NEXT ROUND IN ${Math.ceil(max(0, (G.banner.until - performance.now()) / 1000))}`, V.W / 2, L.viewBottom * 0.37 + 24);
    }
    if (G.reconnecting) {   // the socket dropped; net/client.js is trying again
      ctx.font = 'bold 18px "Lucida Console", monospace'; ctx.fillStyle = AMBER;
      ctx.fillText(`RECONNECTING${'.'.repeat(1 + (Math.floor(performance.now() / 400) % 3))}`, V.W / 2, L.viewBottom * 0.28);
    }
    ctx.font = '11px "Lucida Console", monospace';
  }

  // The missile camera: an IR feed, not the cockpit -- scanlines, static,
  // vignette, a reticle, hot targets boxed with their range, and telemetry.
  function drawGuideHUD() {
    const g = G.guide, WHITE = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < V.H; y += 3) ctx.fillRect(0, y, V.W, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    for (let i = 0; i < 180; i++) ctx.fillRect(random() * V.W, random() * V.H, 1 + random() * 2, 1);
    const band = (G.time * 90) % (V.H + 60) - 30;   // a slow rolling interference band
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(0, band, V.W, 18);
    const vg = ctx.createRadialGradient(V.W / 2, V.H / 2, min(V.W, V.H) * 0.25, V.W / 2, V.H / 2, max(V.W, V.H) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, V.W, V.H);

    const cx = V.W / 2, cy = V.H / 2;
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
      if (!q || q[0] < 0 || q[0] > V.W || q[1] < 0 || q[1] > V.H) continue;
      const k = clampN(900 / max(r, 1), 8, 40);
      ctx.strokeStyle = WHITE; ctx.strokeRect(q[0] - k, q[1] - k * 1.3, k * 2, k * 2.6);
      ctx.fillStyle = WHITE; ctx.textAlign = 'center';
      ctx.fillText(`${m.remote ? app.net.pilotName(m.netId) : m.ch.name} ${Math.round(r)}m`, q[0], q[1] - k * 1.3 - 9);
    }

    ctx.fillStyle = WHITE; ctx.textAlign = 'left';
    const lx = G.touchUI ? 70 : 20;
    ctx.fillText('MSL CAM   IR / WHT-HOT', lx, 22);
    ctx.fillText(`${WEAPONS.lrm.name} ${g.n}/${WEAPONS.lrm.count}`, lx, 38);
    ctx.textAlign = 'right';
    const rx = G.touchUI ? V.W - 120 : V.W - 20;
    ctx.fillText(`ALT ${Math.round(g.pos[1] - G.ter.height(g.pos[0], g.pos[2]))}m`, rx, 22);
    ctx.fillText(nearest < Infinity ? `TGT ${Math.round(nearest)}m` : 'TGT ---', rx, 38);
    ctx.fillText(`FUEL ${max(0, g.fuel || 0).toFixed(1)}s`, rx, 54);
    ctx.textAlign = 'center';
    if (g.lost > 0 || !g.n) {
      ctx.font = 'bold 20px "Lucida Console", monospace'; ctx.fillText('SIGNAL LOST', cx, cy - 60);
    } else {
      ctx.fillText(G.touchUI ? 'DRAG TO STEER  ·  LIFT TO DETONATE' : 'STEER WITH THE MOUSE  ·  RELEASE TO DETONATE', cx, G.touchUI ? 66 : V.H - 24);
    }
  }

  // The frame-time readout: median and 95th percentile over the last 2 s, draw
  // calls, particles. On with the FRAME TIME setting (for playtests on real
  // phones), or ?debug=1's FRAME TIME overlay (on unless switched off), which
  // adds the build, the seed, the state and the cheats.
  let lastFrameAt = 0, stopAt = null;
  // The readout's text is made DEBUG_EVERY frames (four times a second), not
  // every frame: it was most of a frame's garbage (#315). The frame times
  // sit in a ring, sorted in a scratch copy when the text is made.
  const DEBUG_EVERY = 15, ring = new Float64Array(120), sorted = new Float64Array(120), lines = [];
  let ringN = 0, ringAt = 0, debugTick = 0;
  function debugLines(full) {
    sorted.set(ring);
    const s = sorted.subarray(0, ringN).sort(), q = f => (ringN ? s[min(ringN - 1, floor(ringN * f))] : 0);
    lines.length = 0;
    lines.push(`FRAME ${q(0.5).toFixed(1)} ms  P95 ${q(0.95).toFixed(1)} ms`, `DRAWS ${app.R.draws}  CULLED ${app.R.culled || 0}  PARTICLES ${G.parts.length}  MECHS ${G.mechs.length}`);
    if (full) lines.push(VERSION_LINE);   // which build: a cached phone checked against GitHub
    if (full) lines.push(`SEED ${G.ter?.seed ?? '-'}  T ${G.time.toFixed(1)}  STATE ${G.state}${app.net.mp() ? `  PING ${app.net.Net.rtt} ms` : ''}`);
    if (full) {   // the cheats that are on, so a screenshot says how it was made
      let on = '';
      for (const [k, l] of CHEATS) if (G.cheats?.[k]) on += (on ? ' · ' : '') + l;
      if (on) lines.push(G.mode === 'sp' ? `CHEATS: ${on}` : 'CHEATS (OFF HERE)');
    }
  }
  function drawDebug() {
    const now = performance.now();
    if (lastFrameAt) { ring[ringAt] = now - lastFrameAt; ringAt = (ringAt + 1) % ring.length; ringN = min(ringN + 1, ring.length); }
    lastFrameAt = now;
    ctx.font = '11px "Lucida Console", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#9f9';
    const full = app.params.has('debug');
    if (debugTick-- <= 0 || !lines.length) { debugTick = DEBUG_EVERY; debugLines(full); }
    const dx = G.touchUI ? 140 : 12, dy = V.H * 0.5 + (G.touchUI ? 40 : 0);   // on touch, right of and below the ring's middle (drawRing)
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], dx, dy + i * 13);
  }
  // ?debug=1's overlays (ui/tuning.js § OVERLAYS), each drawn only while its switch is on.
  // A box's twelve edges, from its corners [x0, y0, z0, x1, y1, z1].
  function wireBox(b, col) {
    const c = [];
    for (let i = 0; i < 8; i++) c.push(project([b[i & 1 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 4 ? 5 : 2]]));
    ctx.strokeStyle = col; ctx.beginPath();
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit) && c[i] && c[i | bit]) { ctx.moveTo(c[i][0], c[i][1]); ctx.lineTo(c[i | bit][0], c[i | bit][1]); }
    ctx.stroke();
  }
  // NAV (sim/ai/nav.js): within NAV_SHOW of you, a dot per floor of each
  // square, and a line per link the nav has worked out, white if a mech walks
  // it and red if not.
  const NAV_SHOW = 160;
  function drawNavDebug() {
    const nav = navOf(G), P = G.player, near = (x, z) => hypot(x - P.x, z - P.z) <= NAV_SHOW;
    ctx.lineWidth = 1;
    for (const [key, ok] of nav.links) {
      const [a, fa, b, fb] = key.split('.').map(Number), A = nav.floorsOf(a)[fa], B = nav.floorsOf(b)[fb];
      if (!A || !B || !near(A.x, A.z)) continue;
      const p = project([A.x, A.y + 0.5, A.z]), q = project([B.x, B.y + 0.5, B.z]);
      if (!p || !q) continue;
      ctx.strokeStyle = ok ? 'rgba(255,255,255,0.7)' : 'rgba(255,60,60,0.8)';
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (let x = P.x - NAV_SHOW; x <= P.x + NAV_SHOW; x += SQ) for (let z = P.z - NAV_SHOW; z <= P.z + NAV_SHOW; z += SQ) {
      if (!near(x, z)) continue;
      for (const f of nav.floorsAt(x, z)) { const p = project([f.x, f.y + 0.5, f.z]); if (p) ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4); }
    }
  }
  // DIGS AND FALLS (sim/dig.js G.digLog): the last 10 s of digs and falls,
  // boxed in green; each overhang the torque rule weighed, as load / section,
  // amber if it held and red if it broke.
  function drawDigDebug() {
    const log = G.digLog;
    if (!log) return;
    ctx.lineWidth = 1; ctx.font = '11px "Lucida Console", monospace'; ctx.textAlign = 'center';
    for (const e of log) {
      if (G.time - e.t > DIG_LOG_S || e.t > G.time) continue;
      if (e.kind !== 'weigh') { wireBox(e.box, e.kind === 'fall' ? '#9f9' : '#5f5'); continue; }
      const p = project([e.x, e.y, e.z]);
      if (p) { ctx.fillStyle = e.broke ? RED : AMBER; ctx.fillText(`${Math.round(e.load)} / ${e.section}`, p[0], p[1]); }
    }
    ctx.textAlign = 'right';
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
      if (e.team === 0 || e.remote || !e.alive || e.script) continue;   // the bench's cast doesn't think (sim/bench.js)
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
  // The crew strip (spec 20 § Swapping mechs): with more than one mech to
  // drive, a line each under HOSTILES, the one you are in amber and marked,
  // a dead one dark red, each with its torso's health. And after a SWAP the
  // cockpit's static wipe: bands of noise that clear in SWAP_WIPE seconds.
  function drawCrew(L) {
    const c = G.crew;
    if (G.swapT != null && G.time - G.swapT < SWAP_WIPE) {
      const k = 1 - (G.time - G.swapT) / SWAP_WIPE;
      ctx.fillStyle = `rgba(0,0,0,${0.45 * k})`; ctx.fillRect(0, 0, V.W, V.H);   // the picture drops out...
      for (let i = 0; i < 28; i++) { ctx.fillStyle = `rgba(${150 + (i * 53) % 100},${170 + (i * 31) % 80},150,${0.75 * k})`; ctx.fillRect(0, ((i * 0.618 + G.time * 7) % 1) * V.H, V.W, 2 + (i % 5) * 4 * k); }   // ...under bands of static
    }
    ctx.font = '10px "Lucida Console", monospace'; ctx.textAlign = 'right';
    // The base (spec 20 § Two buildings): what the silo holds, and what the factory is up to.
    const b = G.base;
    let y0 = L.crew.y;
    if (b) {
      const f = b.factory;
      ctx.fillStyle = b.silo.alive ? AMBER : '#622';
      ctx.fillText(`ORE ${b.ore}  SALVAGE ${b.salvage}`, L.crew.x, y0); y0 += 12;
      if (f) {
        ctx.fillStyle = !f.alive ? '#622' : GREEN;
        ctx.fillText(!f.alive ? 'FACTORY DOWN' : f.site ? `FACTORY SITE ${Math.floor(f.prog * 100)}% · ORE ${Math.floor(f.site.ore)}/${f.site.need}` : f.job != null ? `NEW MECH ${Math.ceil(CONSTRUCT.mechTime - f.job)} s` : 'FACTORY', L.crew.x, y0);
        y0 += 12;
      }
      // What BUILD puts down (docs/specs/21-mining.md): in a digger, with its price (carried to the site, spec 23); and a bay mending you.
      if (G.player?.ch.tool) {
        const k = PLACE_ORDER[b.pick || 0];
        ctx.fillStyle = GREEN;
        ctx.fillText(`${G.touchUI ? '' : 'M2 '}BUILDS ${NAMES.buildings[k]} · ${PLACE[k].ore}`, L.crew.x, y0); y0 += 12;
      }
      if (G.mending) { ctx.fillStyle = GREEN; ctx.fillText('REPAIRING', L.crew.x, y0); y0 += 12; }
      if (G.buildAt) drawFootprint(G.buildAt);
      else if (G.player?.ch.hopper) drawNearSite(b);
    }
    if (!c || c.length < 2) return;
    c.forEach((m, i) => {
      const y = y0 + i * 12, me = m === G.player, f = m.alive ? Math.max(0, m.hp.T / m.max.T) : 0;
      ctx.fillStyle = !m.alive ? '#622' : me ? AMBER : GREEN;
      ctx.fillText(`${me ? '▶ ' : m.alive && m.job ? `${m.job} ` : ''}${m.ch.name}`, L.crew.x - 34, y);   // a digger on its own says what it's at (sim/miner.js)
      ctx.fillStyle = '#031203'; ctx.fillRect(L.crew.x - 30, y - 6, 30, 5);
      ctx.fillStyle = !m.alive ? '#622' : f < 0.35 ? RED : me ? AMBER : GREEN; ctx.fillRect(L.crew.x - 30, y - 6, 30 * f, 5);
    });
  }
  // BUILD held (sim/base.js): the factory's footprint on the ground, green where it can go, red where not,
  // and why not at the crosshair.
  function drawFootprint(f) {
    const hw = f.w / 2, hd = f.d / 2, s = Math.sin(f.yaw), c = Math.cos(f.yaw), pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => {
      const x = f.x + u * c + v * s, z = f.z - u * s + v * c;
      return project([x, G.ter.height(x, z) + 0.5, z]);
    });
    const col = f.why ? RED : GREEN;
    if (pts.every(Boolean)) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.lineWidth = 1; }
    ctx.textAlign = 'center'; ctx.fillStyle = col;
    const what = `${NAMES.buildings[f.kind]} · ${PLACE[f.kind].ore} ORE`;
    ctx.fillText(f.why === 'room' ? 'NO ROOM' : f.why === 'built' ? 'BUILT' : `BUILD ${what}`, V.W / 2, V.H * 0.5 + 34);
    ctx.textAlign = 'right';
  }
  // In a digger or a hauler near a site (docs/specs/23-construction-sites.md):
  // what it is, how far built, and its ore, under the crosshair.
  function drawNearSite(b) {
    const P = G.player;
    let best = null, bd = 40;
    for (const s of b.sites) for (const e of s.parts) { const d = Math.hypot(e.x - P.x, e.z - P.z) - e.radius; if (e.alive && d < bd) { best = s; bd = d; } }
    if (!best) return;
    ctx.textAlign = 'center'; ctx.fillStyle = AMBER;
    ctx.fillText(`${NAMES.buildings[best.kind]} SITE ${Math.floor(Math.min(best.work / best.swings, best.ore / best.need) * 100)}% · ORE ${Math.floor(best.ore)}/${best.need}`, V.W / 2, V.H * 0.5 + 34);
    ctx.textAlign = 'right';
  }
  const sway = makeSway();
  const BRACKET_LOW = 0.15, lockSnap = makeSpring(900, 0.45);   // torso left under which the brackets flash; the snap: quick, a little overshoot
  let bracketFor = null, lastBracketAt = 0;
  let lastSwayAt = 0;
  function drawHUD() {
    setLook();
    ctx.setTransform(app.scene.view.dpr * V.s, 0, 0, app.scene.view.dpr * V.s, 0, 0);
    ctx.clearRect(0, 0, V.W, V.H);
    const ov = app.overlays;   // ?debug=1's switches (ui/tuning.js); none without it
    if (ov ? ov.frame : app.prefs.frameTime) drawDebug();
    if (ov && G.state !== 'menu' && G.VP) { if (ov.ai) drawAIDebug(); if (ov.nav) drawNavDebug(); if (ov.digs) drawDigDebug(); }
    if (G.state === 'menu' || G.lobby) return;   // the arena lobby: no cockpit yet
    if (G.state === 'walk' && app.walk?.showsMech()) { app.walk.draw(ctx, V.W, V.H, project); return; }   // the walk viewer from outside (ui/walkView.js)
    if (G.guide) { drawGuideHUD(); return; }
    const P = G.player, L = hudLayout(), dash = L.dash;
    // The cockpit and the HUD each ride their own spring (stepSway): the
    // frame and dashboard are bolted to the mech and rattle, the projected
    // HUD floats and settles. Without a dashboard (touch) the instruments float too.
    const now = performance.now(), sw = stepSway(sway, G.kick + (G.bob ? G.bob.x : 0), lastSwayAt ? min(0.05, (now - lastSwayAt) / 1000) : 0);
    lastSwayAt = now;
    const dpr = app.scene.view.dpr * V.s, layer = name => ctx.setTransform(dpr, 0, 0, dpr, 0, (name ? sw[name] : 0) * dpr);
    const instruments = L.frame ? 'cockpit' : 'hud';
    layer('cockpit');
    ctx.font = '11px "Lucida Console", "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    // Cockpit frame: side struts and the dashboard.
    if (L.frame) {
    ctx.fillStyle = '#121416';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(V.W * 0.035, 0); ctx.lineTo(V.W * 0.1, V.H - dash); ctx.lineTo(0, V.H - dash * 0.6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(V.W, 0); ctx.lineTo(V.W * 0.965, 0); ctx.lineTo(V.W * 0.9, V.H - dash); ctx.lineTo(V.W, V.H - dash * 0.6); ctx.fill();
    const g = ctx.createLinearGradient(0, V.H - dash, 0, V.H);
    g.addColorStop(0, '#2a2d30'); g.addColorStop(0.08, '#1a1c1e'); g.addColorStop(1, '#0b0c0d');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, V.H); ctx.lineTo(0, V.H - dash * 0.6); ctx.lineTo(V.W * 0.1, V.H - dash); ctx.lineTo(V.W * 0.9, V.H - dash); ctx.lineTo(V.W, V.H - dash * 0.6); ctx.lineTo(V.W, V.H); ctx.fill();
    }

    layer(null);   // full-screen washes stay put
    // Damage flash.
    if (G.flash > 0) { ctx.fillStyle = `rgba(255,40,20,${G.flash * 0.4})`; ctx.fillRect(0, 0, V.W, V.H); }
    if (G.whiteFlash > 0) { ctx.fillStyle = `rgba(235,215,255,${G.whiteFlash * 0.85})`; ctx.fillRect(0, 0, V.W, V.H); }

    layer('hud');
    // Crosshair.
    let ch = project(G.aim) || [V.W / 2, V.H / 2];
    // Hit-stop: the crosshair holds where it was for a beat when your shot lands.
    if (G.hitStop > 0) { if (!stopAt) stopAt = ch; ch = stopAt; } else stopAt = null;
    if (!G.spectate) {   // watching another pilot: nothing to aim at
      ctx.strokeStyle = G.aimMech ? RED : GREEN;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(ch[0] + dx * 5, ch[1] + dy * 5); ctx.lineTo(ch[0] + dx * 14, ch[1] + dy * 14); }
      ctx.stroke();
      ctx.strokeRect(ch[0] - 1, ch[1] - 1, 2, 2);
    }
    // Someone is in reach: a fist beside the crosshair, and the touch button wakes up.
    if (G.punchReady || (P.melee && P.melee.phase === 'windup')) {
      const fx0 = ch[0] + 24, fy0 = ch[1] + 18, winding = P.melee && P.melee.phase === 'windup';
      ctx.fillStyle = winding ? '#fff' : AMBER;
      ctx.fillRect(fx0, fy0 + 4, 12, 9);                                    // the palm
      for (let i = 0; i < 4; i++) ctx.fillRect(fx0 + i * 3, fy0, 2, 5);     // the knuckles
      ctx.fillRect(fx0 - 3, fy0 + 7, 3, 5);                                 // the thumb
      ctx.textAlign = 'left'; ctx.fillText(winding ? 'SWING' : 'PUNCH', fx0 + 16, fy0 + 9);
    } else if (G.digReady) {   // a digger with ground (or a site of its own) in reach (docs/specs/25-hold-to-dig.md)
      ctx.fillStyle = P.toolHold ? '#fff' : AMBER;
      ctx.textAlign = 'left'; ctx.fillText(NAMES.tools.dig, ch[0] + 24, ch[1] + 27);
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
      if (!fs.mech) ctx.fillText(FUSION_NO_TARGET, ch[0], ch[1] + 46);
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
      ctx.fillText(`RESONANCE SCAN -- ${app.net.pilotName(G.scanWarn.by)} ${Math.floor(G.scanWarn.p * 100)}%`, V.W / 2, L.viewBottom * 0.22);
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

    // Target brackets (gone while a bolt has the HUD scrambled), the distance over them. There is no
    // target panel: the owner took it out to see how it plays. The brackets' colour is the target's
    // torso (what kills it), on your own wireframe's scale, flashing under BRACKET_LOW; with a
    // missile lock (G.lockOn) the four corners snap shut into a diamond on a springy morph.
    const scr = P.scramble > 0, t = scr ? null : G.target, sees = sightLine(G);
    if (t !== bracketFor) { bracketFor = t; lockSnap.x = 0; lockSnap.v = 0; }   // a new target starts open
    const nowB = performance.now();
    stepSpring(lockSnap, lastBracketAt ? min(0.05, (nowB - lastBracketAt) / 1000) : 0, G.lockOn ? 1 : 0);
    lastBracketAt = nowB;
    if (t && t.alive && hypot(t.x - P.x, t.z - P.z) < sees) {
      const f = t.kind ? t.hp / t.max : t.hp.T / t.max.T, col = f < BRACKET_LOW && floor(G.time * 6) % 2 ? '#fff' : hpCol(f);   // the target's torso: the brackets' and the lead's colour
      const a = project([t.x, t.y + (t.kind ? t.height : 8.2 * t.ch.scale), t.z]), b = project([t.x, t.y, t.z]);
      if (a && b) {
        const hgt = max(14, b[1] - a[1]), wdt = hgt * 0.75, x0 = a[0] - wdt / 2, y0 = a[1], k = min(10, wdt / 3);
        const sn = clampN(lockSnap.x, 0, 1.25), mx = a[0], my = y0 + hgt / 2, dx = wdt * 0.72, dy = hgt * 0.7;   // the diamond reaches round the whole mech
        ctx.strokeStyle = col; ctx.lineWidth = 2 + sn * 0.5;
        ctx.beginPath();
        // Each corner is three points (its two arms' ends and the corner); shut, they are a diamond's
        // top or bottom point, the middle of its side, and its left or right point.
        for (let c = 0; c < 4; c++) {
          const sx = c & 1 ? -1 : 1, sy = c & 2 ? -1 : 1, px = sx > 0 ? x0 : x0 + wdt, py = sy > 0 ? y0 : y0 + hgt;
          const tx = mx, ty = my - sy * dy, vx = mx - sx * dx, vy = my;   // the diamond's point above or below, and to the side
          const ax = px + sx * k + (tx - px - sx * k) * sn, ay = py + (ty - py) * sn;
          const cx = px + ((tx + vx) / 2 - px) * sn, cy = py + ((ty + vy) / 2 - py) * sn;
          const bx = px + (vx - px) * sn, by = py + sy * k + (vy - py - sy * k) * sn;
          ctx.moveTo(ax, ay); ctx.lineTo(cx, cy); ctx.lineTo(bx, by);
        }
        ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(fmtDist(hypot(t.x - P.x, t.z - P.z)), a[0], y0 - 8 - sn * 4);   // the one thing by it: how far
      }
      // Shell lead: a small diamond where a shell fired now would meet it, while it is moving, in the
      // shell's range, and inside the lock's zone (G.lock: lock range and ~17 degrees of the view;
      // missiles or not), in the brackets' colour.
      const ac = G.lock && P.weapons.find(w => w.def.kind === 'shell' && !w.dead && (w.ammo == null || w.ammo > 0));
      if (ac && Math.abs(t.speed) > 1 && hypot(t.x - P.x, t.z - P.z) < ac.def.range) {
        const lp = project(leadPoint(G.eye, t, ac.def.speed));
        if (lp) {
          ctx.strokeStyle = col; ctx.beginPath();
          ctx.moveTo(lp[0], lp[1] - 6); ctx.lineTo(lp[0] + 6, lp[1]); ctx.lineTo(lp[0], lp[1] + 6); ctx.lineTo(lp[0] - 6, lp[1]); ctx.closePath(); ctx.stroke();
          ctx.fillStyle = col; ctx.fillRect(lp[0] - 1, lp[1] - 1, 2, 2);
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
    const tw = L.compass.w, tx = V.W / 2 - tw / 2, ty = 10;
    ctx.fillStyle = 'rgba(0,20,0,.55)'; ctx.fillRect(tx, ty, tw, 26);
    ctx.strokeStyle = DIM; ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 25);
    const hdg = ((-viewYaw(P) * 180 / PI) % 360 + 360) % 360;
    ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, 26); ctx.clip();
    ctx.textAlign = 'center'; ctx.fillStyle = GREEN; ctx.strokeStyle = GREEN;
    const pxPerDeg = tw / 120;
    for (let dgr = floor((hdg - 70) / 10) * 10; dgr <= hdg + 70; dgr += 10) {
      const x = V.W / 2 + (dgr - hdg) * pxPerDeg, d = ((dgr % 360) + 360) % 360;
      ctx.beginPath(); ctx.moveTo(x, ty + 18); ctx.lineTo(x, ty + (d % 30 ? 22 : 15)); ctx.stroke();
      if (d % 30 === 0) ctx.fillText(compassLabel(d), x, ty + 8);
    }
    ctx.restore();
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.moveTo(V.W / 2, ty + 26); ctx.lineTo(V.W / 2 - 5, ty + 32); ctx.lineTo(V.W / 2 + 5, ty + 32); ctx.fill();
    const legX = V.W / 2 + clampN(P.twist * 180 / PI, -60, 60) * pxPerDeg;
    ctx.fillStyle = GREEN; ctx.fillRect(legX - 6, ty + 34, 12, 3);
    ctx.fillStyle = DIM; ctx.textAlign = 'left'; ctx.fillText('LEGS', legX + 9, ty + 36);

    layer(instruments);
    // Radar.
    const { x: rx, y: ry, r: rr } = L.radar;
    ctx.fillStyle = '#031203'; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = DIM; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, ry, rr / 2, 0, TAU); ctx.stroke();
    const vy = viewYaw(P), half = (G.zoom ? 0.42 : 1.08) * (V.W / max(1, V.H)) / 2;
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
      // Shapes as well as colours: a pilot is a dot, a hostile a triangle, the target a ringed square.
      ctx.fillStyle = m === t ? AMBER : m.remote ? app.net.pilotCss(m.netId) : RED;
      if (m === t) { ctx.fillRect(px - 2, py - 2, 5, 5); ctx.strokeStyle = AMBER; ctx.strokeRect(px - 4.5, py - 4.5, 9, 9); }
      else if (m.remote) { ctx.beginPath(); ctx.arc(px, py, 2.5, 0, TAU); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(px, py - 3.5); ctx.lineTo(px + 3, py + 2.5); ctx.lineTo(px - 3, py + 2.5); ctx.closePath(); ctx.fill(); }
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
    ctx.fillStyle = DIM; ctx.textAlign = 'center'; ctx.fillText(`${RANGE}m`, rx, ry + rr + 9 > V.H ? ry + rr - 8 : ry + rr + 8);

    // Left: the ring (drawRing): your own damage, heat, jump jets and throttle.
    drawRing(L.ring, P);

    // Right: weapons (a digger has none: its hopper, how full, instead; spec 20).
    const wx = L.weapons.x;
    let wy = L.weapons.y;
    ctx.textAlign = 'left';
    if (P.ch.hopper) {
      const ore = P.ore || 0, cap = P.ch.hopper, full = ore >= cap;
      ctx.fillStyle = full ? AMBER : GREEN;
      ctx.fillText(full ? 'HOPPER FULL' : 'HOPPER', wx, wy);
      ctx.fillText(String(ore).padStart(3), wx + 118, wy);
      ctx.fillStyle = '#031203'; ctx.fillRect(wx + 150, wy - 3, 40, 6);
      ctx.fillStyle = full ? AMBER : GREEN; ctx.fillRect(wx + 150, wy - 3, 40 * ore / cap, 6);
    }
    if (P.ch.tool) {
      // The tool (docs/specs/25-hold-to-dig.md), lit while held; then the
      // bucket's dirt (docs/specs/21-mining.md): enough for a DUMP lights it up.
      if (!G.touchUI) { wy += 14; ctx.fillStyle = P.toolHold ? AMBER : GREEN; ctx.fillText(`${CAT_KEY.energy.padEnd(6)}${NAMES.tools[P.ch.tool]}`, wx, wy); }
      const dirt = P.dirt || 0, can = dirt >= CONSTRUCT.dumpCost;
      wy += 14;
      ctx.fillStyle = can ? GREEN : DIM;
      ctx.fillText(G.touchUI ? 'DIRT' : `${CAT_KEY.fusion.padEnd(6)}DIRT`, wx, wy);
      ctx.fillText(String(dirt).padStart(3), wx + 118, wy);
      ctx.fillStyle = '#031203'; ctx.fillRect(wx + 150, wy - 3, 40, 6);
      ctx.fillStyle = can ? GREEN : DIM; ctx.fillRect(wx + 150, wy - 3, 40 * dirt / CONSTRUCT.dirtMax, 6);
    }
    for (const cat of G.touchUI ? NO_CATS : CATS) {   // on touch the fire buttons show this (input/input.js fireStatus)
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

    layer('hud');
    // Objectives: a line each under the compass (secondaries dimmer), a marker
    // where each one is (clamped to the edge when off-screen) and a blip on the radar.
    // (A mission with no objectives listed is the old ELIMINATE, which HOSTILES already counts.)
    const objs = !app.net.mp() && G.def?.objectives && G.objectives ? G.objectives.filter(o => o.state === 'active' && (o.def.type !== 'eliminate' || o.total != null)) : [];
    ctx.textAlign = 'center'; ctx.font = '11px "Lucida Console", monospace';
    objs.forEach((o, i) => { ctx.fillStyle = o.def.secondary ? GREEN : AMBER; ctx.fillText(objectiveLine(o), V.W / 2, 58 + i * 13); });
    for (const o of objs) {
      const p = objectivePoint(G, o);
      if (p) drawMarker(L, p, o.def.secondary ? GREEN : AMBER);
    }
    // Status lines.
    ctx.textAlign = 'center';
    let my = 64 + objs.length * 13;
    for (const m of G.msgs) {
      ctx.globalAlpha = min(1, m.t);
      ctx.fillStyle = m.col; ctx.fillText(m.text, V.W / 2, my); my += 15;
    }
    ctx.globalAlpha = 1;
    layer(null);
    if (P.shutdown) {
      // Power's gone: the instruments go dark under a veil; only the warning stays bright.
      ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, 0, V.W, V.H);
      ctx.font = 'bold 22px "Lucida Console", monospace';
      ctx.fillStyle = floor(G.time * 3) % 2 ? RED : AMBER;
      ctx.fillText('REACTOR SHUTDOWN', V.W / 2, L.viewBottom * 0.4);
    }
    layer('hud');
    if (G.zoom) { ctx.font = '11px "Lucida Console", monospace'; ctx.fillStyle = GREEN; ctx.fillText('ZOOM 2.5x', V.W / 2, L.viewBottom - (L.frame ? 10 : 24)); }
    const left = G.mechs.filter(m => m.alive && m.team !== 0).length;
    ctx.font = '11px "Lucida Console", monospace'; ctx.textAlign = 'right'; ctx.fillStyle = DIM;
    ctx.fillText(app.net.mp() ? `${app.net.tdm() ? '' : `PILOTS ${app.net.Net.info.size}  `}FIRST TO ${app.net.Net.limit}` : `HOSTILES ${left}`, L.hostiles.x, L.hostiles.y);
    if (app.net.mp()) drawArenaHUD(L);
    drawCrew(L);
    drawTutorial(L);
    if ((app.net.mp() || G.mode === 'coop') && app.net.Net.rtt > LAG_MS) {   // a slow line to the relay: say so, small
      const tw = L.compass.w;
      ctx.textAlign = 'left'; ctx.fillStyle = AMBER;
      ctx.fillText('LAG', V.W / 2 + tw / 2 + 8, 28);
    }
    else if (G.mode === 'coop') drawCoopDown(L);
    // Phones held upright get a cramped, stretched view.
    if (G.touchUI && V.H > V.W) {
      ctx.font = 'bold 16px "Lucida Console", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = AMBER;
      ctx.fillText('TURN YOUR DEVICE SIDEWAYS', V.W / 2, V.H * 0.3);
    }
  }


  return { draw: drawHUD, hudLayout, scale: () => V.s };   // scale: the HUD SCALE in effect (capped on a phone)
}
