// Stompy -- a standalone 3D mech sim in the spirit of the mid-90s
// classics. Original code and art: raw WebGL, flat-shaded, no libraries.
//
// Legs and torso turn independently (A/D steer the legs, the mouse twists the
// torso), heat builds as you fire, damage is tracked per section, and a
// computer voice reads out the bad news.

'use strict';

(() => {
  const { sin, cos, atan2, sqrt, min, max, abs, PI, random, hypot, floor } = Math;

  /* ---- the little the page needs: DOM helpers, storage, audio unlock ---- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Storage can throw (private mode, blocked site data); the game runs without it.
  const store = {
    get(k, d) { try { const v = localStorage.getItem('stompy.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('stompy.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const settings = { sound: store.get('sound', true) };
  // Browsers only allow audio after a click, tap or key press -- and iOS is
  // stricter on three counts, each of which silences the game on iPhones:
  //  1. Web Audio follows the ring/silent switch ("ambient" audio) unless the
  //     page asks for "playback". Safari 16.4+ has navigator.audioSession for
  //     that; older iOS switches category if a media element plays, hence the
  //     looping silent <audio>.
  //  2. Only touchend/click count as the gesture (not touchstart/pointerdown),
  //     and the context only really starts once something has played inside it.
  //  3. It suspends audio on screen lock / app switch / calls, and only a later
  //     gesture can resume it.
  // So unlock() runs on every touchend/click/keydown (see the listeners below).
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAAAA';
  const Sound = {
    ctx: null, primed: false, tag: null,
    unlock() {
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
      if (IOS && !navigator.audioSession && !this.tag) {
        try { this.tag = new Audio(SILENT_WAV); this.tag.loop = true; this.tag.play().catch(() => { this.tag = null; }); } catch { this.tag = null; }
      }
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; return; }
      }
      const c = this.ctx;
      if (c.state !== 'running') { try { c.resume()?.catch?.(() => {}); } catch { /* ignore */ } }
      if (!this.primed) {
        try {
          const src = c.createBufferSource();
          src.buffer = c.createBuffer(1, 1, 22050);
          src.connect(c.destination); src.start(0);
          this.primed = true;
        } catch { /* try again next gesture */ }
      }
    },
  };
  for (const ev of ['touchend', 'click', 'keydown']) {
    document.addEventListener(ev, () => { if (settings.sound) Sound.unlock(); }, { capture: true, passive: true });
  }
  const TAU = PI * 2;
  const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = a => { a %= TAU; if (a > PI) a -= TAU; if (a < -PI) a += TAU; return a; };
  const rnd = (a, b) => a + random() * (b - a);

  /* ======================= vectors & matrices ======================= */

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  // yaw 0 faces +z; increasing yaw turns left. pitch > 0 looks up.
  const dirOf = (yaw, pitch) => [sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)];

  // Column-major 4x4, as WebGL wants.
  const M = {
    id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    T(x, y, z) { const m = M.id(); m[12] = x; m[13] = y; m[14] = z; return m; },
    S(x, y = x, z = x) { const m = M.id(); m[0] = x; m[5] = y; m[10] = z; return m; },
    RY(a) { const c = cos(a), s = sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    RX(a) { const c = cos(a), s = sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    RZ(a) { const c = cos(a), s = sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    persp(fovy, aspect, n, f) {
      const t = 1 / Math.tan(fovy / 2);
      return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
    },
    lookAt(eye, at, up = [0, 1, 0]) {
      const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    },
    apply(m, p) {
      return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    },
  };
  const chain = (...ms) => ms.reduce((a, b) => M.mul(a, b));

  /* ======================= mesh building ======================= */

  // Flat-shaded triangle soup: position, normal, colour per vertex.
  class Builder {
    constructor() { this.d = []; }
    tri(a, b, c, col, ref) {
      let n = norm(cross(sub(b, a), sub(c, a)));
      // Orient outward: away from `ref` (a point inside), or upward for terrain.
      if (ref === 'up' ? n[1] < 0 : ref && dot(n, sub(a, ref)) < 0) n = mul(n, -1);
      for (const p of [a, b, c]) this.d.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    }
    quad(a, b, c, d, col, ref) { this.tri(a, b, c, col, ref); this.tri(a, c, d, col, ref); }
    // A unit cube (-0.5..0.5) through matrix m; the top face can be tapered.
    cube(m, col, tx = 1, tz = 1) {
      const k = [-0.5, 0.5], C = [];
      for (let i = 0; i < 8; i++) {
        const y = k[(i >> 1) & 1], top = y > 0;
        C.push(M.apply(m, [k[i & 1] * (top ? tx : 1), y, k[(i >> 2) & 1] * (top ? tz : 1)]));
      }
      const ctr = M.apply(m, [0, 0, 0]);
      for (const [a, b, c, d] of [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6]])
        this.quad(C[a], C[b], C[c], C[d], col, ctr);
    }
  }

  /* ======================= game data ======================= */

  const WEAPONS = {
    // Lasers are continuous beams: damage per second (dps) climbs the longer
    // a beam stays on one mech -- its armour melts (see MELT_T / MELT_MAX) -- and heat per second
    // (hps) is the price -- two large lasers outrun the heat sinks.
    laser:  { name: 'LG LASER',  kind: 'beam',    dps: 3.5, hps: 12, range: 520, col: [1, 0.25, 0.2], w: 0.22, cd: 1 },
    mlaser: { name: 'MED LASER', kind: 'beam',    dps: 2.0, hps: 6,  range: 360, col: [0.3, 1, 0.35], w: 0.16, cd: 1 },
    // The autocannon is the opposite: big individual hits, little heat, ammo.
    ac:     { name: 'AUTOCANNON', kind: 'shell',  dmg: 11,  heat: 2,  cd: 1.1, range: 650, speed: 340, ammo: 30 },
    lrm:    { name: 'LRM-10',    kind: 'missile', dmg: 1.9, heat: 6,  cd: 4.5, range: 850, speed: 120, ammo: 14, count: 10 },
    // Hold a targeting laser on one mech for `scan` seconds -- any break and it
    // starts over -- and the reactor discharges at the target's resonant
    // frequency: an outright kill. The price: heat jumps to `overload` (a
    // deep shutdown, ~5 s) and the cannon needs `cd` seconds to recharge.
    // Lock help, so it's hard but possible: the laser counts within `slack` m
    // of a mech, a slip shorter than `grace` s pauses the scan rather than
    // resetting it, and while locked the torso is drawn gently toward the
    // target (`assist`, per second).
    fusion: { name: 'FUSION CANNON', kind: 'fusion', scan: 3, cd: 25, overload: 140, range: 600, scanHeat: 2, col: [0.78, 0.5, 1],
      slack: 1.5, grace: 0.5, assist: 2.2,
      // Reactor feedback: firing costs this share of your own torso's max
      // armour -- enough to kill you if it's already low. The discharge is a
      // pulse of sine waves travelling the targeting beam at `pulseSpeed` m/s;
      // the target dies when it arrives.
      feedback: 0.35, pulseSpeed: 350 },
  };

  // Three fire controls, one per kind of weapon: lasers are energy (no ammo,
  // lots of heat), the autocannon is ballistic, LRMs are missiles.
  const CATS = ['energy', 'ballistic', 'missile', 'fusion'];
  const CAT_OF = { laser: 'energy', mlaser: 'energy', ac: 'ballistic', lrm: 'missile', fusion: 'fusion' };
  const CAT_LABEL = { energy: 'ENERGY', ballistic: 'BALLISTIC', missile: 'MISSILE', fusion: 'FUSION' };
  const CAT_KEY = { energy: 'LMB 1', ballistic: 'RMB 2', missile: 'SPC 3', fusion: 'G 4' };

  // Hit points per section: T(orso), L/R A(rm), L/R L(eg). Losing the torso kills.
  const CHASSIS = {
    kestrel: { name: 'KESTREL', legs: 'reverse', speed: 15, turn: 1.05, sink: 10, scale: 1, pref: 300,
      hp: { T: 72, LA: 32, RA: 32, LL: 42, RL: 42 }, col: [0.55, 0.58, 0.62], acc: [0.85, 0.6, 0.15],
      weapons: [['laser', 'LA'], ['laser', 'RA'], ['ac', 'T'], ['lrm', 'T'], ['fusion', 'T']] },
    jackal: { name: 'JACKAL', legs: 'forward', speed: 19, turn: 1.6, sink: 9, scale: 0.85, pref: 140, acc0: 0.035,
      hp: { T: 30, LA: 13, RA: 13, LL: 18, RL: 18 }, col: [0.62, 0.26, 0.2], acc: [0.2, 0.2, 0.22],
      weapons: [['mlaser', 'LA'], ['mlaser', 'RA'], ['fusion', 'T']] },
    warden: { name: 'WARDEN', legs: 'quad', speed: 9, turn: 0.7, sink: 10, scale: 1.15, pref: 330, acc0: 0.025,
      hp: { T: 58, LA: 28, RA: 28, LL: 34, RL: 34 }, col: [0.36, 0.4, 0.3], acc: [0.75, 0.7, 0.2],
      weapons: [['lrm', 'T'], ['ac', 'RA'], ['laser', 'LA'], ['fusion', 'T']] },
  };

  // The selectable mechs, in selector order, with what the menu says about them.
  const MECH_ORDER = ['kestrel', 'jackal', 'warden'];
  const MECH_INFO = {
    kestrel: { role: 'REVERSE-JOINT · MEDIUM ALL-ROUNDER', kit: '2x LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.75 },
    jackal: { role: 'FORWARD-JOINT · LIGHT, FAST', kit: '2x MED LASER · FUSION', fire: 0.35 },
    warden: { role: 'QUADRUPED · HEAVY FIRE SUPPORT', kit: 'LG LASER · AUTOCANNON · LRM-10 · FUSION', fire: 0.85 },
  };

  const PALS = {
    dusk: { name: 'Dusk desert', zen: [0.16, 0.1, 0.3], hor: [0.9, 0.56, 0.38], low: [0.56, 0.36, 0.23], mid: [0.74, 0.52, 0.31],
      high: [0.92, 0.8, 0.62], rock: [0.42, 0.3, 0.25], fog: [180, 1150], light: norm([0.4, 0.75, -0.5]) },
    ice: { name: 'Glacier', zen: [0.08, 0.14, 0.32], hor: [0.66, 0.75, 0.86], low: [0.58, 0.66, 0.75], mid: [0.8, 0.86, 0.92],
      high: [0.98, 0.99, 1], rock: [0.42, 0.47, 0.55], fog: [120, 900], light: norm([-0.5, 0.7, -0.3]) },
    volcanic: { name: 'Volcanic plain', zen: [0.08, 0.02, 0.03], hor: [0.6, 0.22, 0.1], low: [0.2, 0.14, 0.13], mid: [0.32, 0.22, 0.18],
      high: [0.5, 0.34, 0.25], rock: [0.13, 0.1, 0.1], fog: [140, 1000], light: norm([0.3, 0.6, 0.6]) },
  };

  const MISSIONS = [
    { name: 'Proving Grounds', pal: 'dusk', foes: ['jackal', 'jackal'],
      intel: 'Two JACKAL scouts have been shadowing the convoy route out of Redwater. Fast, lightly armoured, armed with medium lasers. Run them down.' },
    { name: 'Ridge Patrol', pal: 'ice', foes: ['jackal', 'jackal', 'jackal'],
      intel: 'A scout lance is sweeping the glacier ridges. Visibility is poor. Use the radar and let them come to you.' },
    { name: 'Iron Rain', pal: 'volcanic', foes: ['warden', 'jackal', 'jackal'],
      intel: 'A WARDEN fire-support mech is shelling the refinery with long-range missiles, screened by two scouts. Close the distance: LRMs are weak up close.' },
    { name: 'Hammerfall', pal: 'dusk', foes: ['warden', 'warden', 'jackal', 'jackal'],
      intel: 'The Combine has committed heavies. Two WARDENs and their escorts. Watch your heat.' },
  ];
  function missionDef(n) {
    if (n < MISSIONS.length) return MISSIONS[n];
    const pals = Object.keys(PALS), k = 3 + floor(n / 2), heavies = floor(n / 3);
    return { name: `Contract ${n + 1}`, pal: pals[n % pals.length],
      foes: Array.from({ length: k }, (_, i) => (i < heavies ? 'warden' : 'jackal')),
      intel: `Open contract. ${k} hostiles reported, ${heavies} of them heavy. Pay is by the kill.` };
  }

  // Multiplayer paint jobs: every pilot flies a KESTREL, told apart by colour.
  const MP_COLORS = [
    { name: 'STEEL', col: [0.58, 0.6, 0.64], acc: [0.85, 0.6, 0.15], css: '#9aa0a8' },
    { name: 'RED', col: [0.72, 0.2, 0.17], acc: [0.2, 0.2, 0.22], css: '#e04a3a' },
    { name: 'BLUE', col: [0.2, 0.38, 0.78], acc: [0.85, 0.85, 0.9], css: '#4a7ae0' },
    { name: 'GREEN', col: [0.24, 0.55, 0.28], acc: [0.85, 0.75, 0.2], css: '#44b058' },
    { name: 'GOLD', col: [0.82, 0.64, 0.16], acc: [0.2, 0.2, 0.22], css: '#f0c030' },
    { name: 'VIOLET', col: [0.52, 0.28, 0.68], acc: [0.85, 0.85, 0.9], css: '#a868e0' },
    { name: 'ORANGE', col: [0.85, 0.42, 0.14], acc: [0.2, 0.2, 0.22], css: '#f08030' },
    { name: 'TEAL', col: [0.18, 0.6, 0.6], acc: [0.9, 0.9, 0.9], css: '#38c0c0' },
  ];
  const HPK = ['T', 'LA', 'RA', 'LL', 'RL'];

  const SECT_NAME = { T: 'Torso', LA: 'Left arm', RA: 'Right arm', LL: 'Left leg', RL: 'Right leg' };

  /* ======================= terrain ======================= */

  const N = 96, CELL = 24, HALF = (N * CELL) / 2, BOUND = HALF - 90;

  function makeTerrain(seed) {
    const hs = new Float32Array((N + 1) * (N + 1));
    const hash = (i, j) => { const s = sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - floor(s); };
    const vn = (x, z) => {
      const i = floor(x), j = floor(z), fx = x - i, fz = z - j;
      const u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
      return lerp(lerp(hash(i, j), hash(i + 1, j), u), lerp(hash(i, j + 1), hash(i + 1, j + 1), u), w);
    };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const f = vn(x / 380 + 40, z / 380 + 40) * 0.6 + vn(x / 140, z / 140) * 0.3 + vn(x / 55, z / 55) * 0.1;
      let h = max(0, f - 0.36) * 230;
      const r = hypot(x, z);
      h *= clampN((r - 70) / 200, 0, 1);       // flat landing zone around the start
      hs[j * (N + 1) + i] = h;
    }
    // Same triangle split as the mesh, so mechs stand exactly on what's drawn.
    const height = (x, z) => {
      const gx = clampN((x + HALF) / CELL, 0, N - 1e-4), gz = clampN((z + HALF) / CELL, 0, N - 1e-4);
      const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
      const h00 = hs[j * (N + 1) + i], h10 = hs[j * (N + 1) + i + 1], h01 = hs[(j + 1) * (N + 1) + i], h11 = hs[(j + 1) * (N + 1) + i + 1];
      return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    };
    return { hs, height };
  }

  function buildTerrainMesh(ter, pal, seed) {
    const b = new Builder(), hs = ter.hs;
    let s = seed * 9301 + 49297;
    const r01 = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const colAt = h => {
      const t = clampN(h / 70, 0, 1);
      const c = t < 0.5 ? mix3(pal.low, pal.mid, t * 2) : mix3(pal.mid, pal.high, t * 2 - 1);
      return mul(c, 0.9 + r01() * 0.14);
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const h00 = hs[j * (N + 1) + i], h10 = hs[j * (N + 1) + i + 1], h01 = hs[(j + 1) * (N + 1) + i], h11 = hs[(j + 1) * (N + 1) + i + 1];
      b.tri([x0, h00, z0], [x1, h10, z0], [x0, h01, z1], colAt((h00 + h10 + h01) / 3), 'up');
      b.tri([x1, h11, z1], [x0, h01, z1], [x1, h10, z0], colAt((h11 + h01 + h10) / 3), 'up');
    }
    // Rocks.
    for (let k = 0; k < 150; k++) {
      const x = (r01() - 0.5) * 2 * BOUND, z = (r01() - 0.5) * 2 * BOUND;
      if (hypot(x, z) < 60) continue;
      const sz = 2 + r01() * 7;
      b.cube(chain(M.T(x, ter.height(x, z) + sz * 0.15, z), M.RY(r01() * 6), M.RX((r01() - 0.5) * 0.6),
        M.S(sz, sz * (0.5 + r01() * 0.8), sz * (0.7 + r01() * 0.6))), mul(pal.rock, 0.85 + r01() * 0.3), 0.55 + r01() * 0.3, 0.55 + r01() * 0.3);
    }
    // A few abandoned outposts.
    for (let o = 0; o < 4; o++) {
      const a = r01() * TAU, d = 280 + r01() * 600, cx = sin(a) * d, cz = cos(a) * d;
      for (let k = 0; k < 7; k++) {
        const x = cx + (r01() - 0.5) * 90, z = cz + (r01() - 0.5) * 90;
        const w = 9 + r01() * 14, hgt = 7 + r01() * 22, dd = 9 + r01() * 14;
        const base = ter.height(x, z) - 2;
        const g = 0.45 + r01() * 0.2;
        b.cube(chain(M.T(x, base + hgt / 2, z), M.RY(r01() * 0.4), M.S(w, hgt, dd)), [g, g * 0.97, g * 0.93], 0.97, 0.97);
        b.cube(chain(M.T(x, base + hgt + 0.6, z), M.S(w * 0.6, 1.2, dd * 0.6)), [g * 0.6, g * 0.6, g * 0.6]);
      }
      const tx = cx + 40, tz = cz - 30, tb = ter.height(tx, tz);
      b.cube(chain(M.T(tx, tb + 22, tz), M.S(1.4, 44, 1.4)), [0.35, 0.33, 0.3], 0.4, 0.4);
      b.cube(chain(M.T(tx, tb + 44, tz), M.S(2.5, 1, 2.5)), [0.9, 0.15, 0.1]);
    }
    return b;
  }

  // Body plans, by leg type. Lengths are model units (x chassis scale), and
  // buildMechParts builds each type's leg meshes to match l1 / l2. Per leg:
  // hip (hx, hz), rest foot (fx, fz) and its phase in the gait cycle; `swing`
  // is the share of the cycle a foot spends in the air. +x is the mech's
  // left, +z its front. `knee` is which way the joint bends.
  const GEO = {
    forward: { hip: 4.6, l1: 2.6, l2: 2.5, ankle: 0.42, knee: 'forward', swing: 0.42, stride: [3.5, 4.5],
      radius: 2.4, height: 7.9, legTop: 4.4, torsoY: 5, eye: [0, 2.35, 1.9], armX: 2.25, armY: 2.0, rackY: 3.2, acY: 1.6,
      legs: [{ hx: 0.95, hz: 0, fx: 1.1, fz: 0, ph: 0 }, { hx: -0.95, hz: 0, fx: -1.1, fz: 0, ph: 0.5 }] },
    // Bird-like: the joint points backward, feet are three-toed claws.
    reverse: { hip: 4.9, l1: 2.7, l2: 2.9, ankle: 0.5, knee: 'back', swing: 0.42, stride: [3.5, 4.5],
      radius: 2.4, height: 8.6, legTop: 4.7, torsoY: 5.3, eye: [0, 2.6, 1.5], armX: 2.3, armY: 2.0, rackY: 3.3, acY: 1.6,
      legs: [{ hx: 1.0, hz: 0.1, fx: 1.15, fz: 0.45, ph: 0 }, { hx: -1.0, hz: 0.1, fx: -1.15, fz: 0.45, ph: 0.5 }] },
    // Four legs bowed out like a spider's, trotting: diagonal pairs together.
    quad: { hip: 3.4, l1: 2.4, l2: 2.9, ankle: 0.35, knee: 'out', swing: 0.42, stride: [3.0, 3.6],
      radius: 3.1, height: 6.6, legTop: 3.3, torsoY: 4.0, eye: [0, 1.6, 1.4], armX: 1.9, armY: 1.2, rackY: 2.1, acY: 0.9,
      legs: [{ hx: 1.4, hz: 1.6, fx: 2.9, fz: 2.3, ph: 0 }, { hx: -1.4, hz: -1.6, fx: -2.9, fz: -2.2, ph: 0 },
             { hx: -1.4, hz: 1.6, fx: -2.9, fz: 2.3, ph: 0.5 }, { hx: 1.4, hz: -1.6, fx: 2.9, fz: -2.2, ph: 0.5 }] },
  };
  const geoOf = m => GEO[m.ch.legs] || GEO.forward;

  function buildMechParts(ch) {
    if (ch.legs === 'reverse') return buildReverseParts(ch);
    if (ch.legs === 'quad') return buildQuadParts(ch);
    const c = ch.col, dark = mul(c, 0.55), acc = ch.acc, glass = [0.08, 0.1, 0.13];
    const part = f => { const b = new Builder(); f(b); return b; };
    return {
      hip: part(b => b.cube(M.S(2.6, 0.9, 1.6), dark)),
      // Upper leg runs 2.6 down -y from the hip, lower leg 2.5 down from the knee
      // (GEO.forward.l1 / l2): the IK in drawMech depends on these lengths.
      uleg: part(b => { b.cube(chain(M.T(0, -1.3, 0), M.S(0.95, 2.8, 1.25)), c, 0.85, 0.9); b.cube(chain(M.T(0, -2.6, 0.25), M.S(1.05, 0.75, 1)), dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -1.25, -0.1), M.S(0.8, 2.5, 1.05)), c); b.cube(chain(M.T(0, -1.1, -0.65), M.S(0.3, 1.8, 0.3)), dark); }),
      foot: part(b => b.cube(chain(M.T(0, -0.2, 0.35), M.S(1.25, 0.4, 2.3)), dark, 0.8, 0.8)),
      torso: part(b => {
        b.cube(chain(M.T(0, 1.3, 0), M.S(3.4, 2.6, 2.6)), c, 0.85, 0.8);
        b.cube(chain(M.T(0, 2.15, 1.3), M.S(1.6, 0.9, 1)), glass, 0.75, 0.6);
        b.cube(chain(M.T(1.25, 2.85, -0.2), M.S(1.15, 0.7, 1.6)), acc);
        b.cube(chain(M.T(-1.25, 2.85, -0.2), M.S(1.15, 0.7, 1.6)), acc);
        b.cube(chain(M.T(0, 1.0, -1.5), M.S(2, 1.6, 0.6)), dark);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.6, 0.1), M.S(0.95, 1.8, 1.15)), c);
        b.cube(chain(M.T(0, -1.15, 1.45), M.S(0.38, 0.38, 2.3)), dark);
        b.cube(chain(M.T(0, 0.25, 0), M.S(1.25, 0.8, 1.45)), acc);
      }),
    };
  }

  // The mech from the sketch: square torso, domed cockpit, missile pods on the
  // shoulders, bird legs with clawed feet.
  function buildReverseParts(ch) {
    const c = ch.col, dark = mul(c, 0.55), acc = ch.acc, glass = [0.08, 0.1, 0.13], tube = [0.06, 0.06, 0.07];
    const part = f => { const b = new Builder(); f(b); return b; };
    return {
      hip: part(b => { b.cube(M.S(2.8, 0.9, 1.8), dark); b.cube(chain(M.T(0, -0.1, -0.9), M.S(1.4, 0.6, 0.5)), c); }),
      // l1 = 2.7: an armoured thigh.
      uleg: part(b => { b.cube(chain(M.T(0, -1.35, 0), M.S(1.15, 2.9, 1.45)), c, 0.8, 0.85); b.cube(chain(M.T(0, -2.7, 0), M.S(1.1, 0.8, 1.1)), dark); }),
      // l2 = 2.9: a slimmer shin with a hydraulic ram.
      lleg: part(b => { b.cube(chain(M.T(0, -1.45, 0), M.S(0.7, 2.9, 0.9)), c, 1.2, 1.15); b.cube(chain(M.T(0, -1.3, 0.55), M.S(0.28, 2.2, 0.28)), dark); }),
      // Three toes forward and a spur behind.
      foot: part(b => {
        b.cube(chain(M.T(0, -0.15, 0), M.S(0.8, 0.5, 0.8)), dark);
        b.cube(chain(M.T(0, -0.32, 1.0), M.S(0.38, 0.34, 1.7)), dark, 0.7, 0.8);
        for (const sx of [1, -1]) b.cube(chain(M.T(sx * 0.42, -0.32, 0.75), M.RY(sx * 0.42), M.S(0.34, 0.32, 1.45)), dark, 0.7, 0.8);
        b.cube(chain(M.T(0, -0.32, -0.6), M.S(0.3, 0.3, 0.9)), dark, 0.7, 0.8);
      }),
      torso: part(b => {
        b.cube(chain(M.T(0, 1.3, 0), M.S(3.2, 2.6, 2.4)), c, 0.95, 0.95);
        b.cube(chain(M.T(0, 2.95, 0.2), M.S(1.6, 0.8, 1.5)), c, 0.6, 0.6);          // the dome...
        b.cube(chain(M.T(0, 3.42, 0.2), M.S(0.95, 0.25, 0.9)), c, 0.55, 0.55);
        b.cube(chain(M.T(0, 3.0, 0.92), M.S(0.95, 0.26, 0.12)), glass);              // ...and its viewport
        for (const sx of [1, -1]) {                                                  // missile pods, tubes facing forward
          b.cube(chain(M.T(sx * 1.75, 3.0, -0.1), M.S(1.25, 1.25, 1.45)), acc);
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
            b.cube(chain(M.T(sx * 1.75 + (i - 1) * 0.34, 3.0 + (j - 1) * 0.34, 0.64), M.S(0.2, 0.2, 0.06)), tube);
        }
        b.cube(chain(M.T(0, 1.0, -1.35), M.S(2, 1.6, 0.5)), dark);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.6, 0.1), M.S(0.95, 1.8, 1.15)), c);
        b.cube(chain(M.T(0, -1.15, 1.45), M.S(0.38, 0.38, 2.3)), dark);
        b.cube(chain(M.T(0, 0.25, 0), M.S(1.2, 0.75, 1.35)), dark);
      }),
    };
  }

  // A low armoured hull on four bowed legs, weapons on a turret.
  function buildQuadParts(ch) {
    const c = ch.col, dark = mul(c, 0.55), acc = ch.acc, glass = [0.08, 0.1, 0.13], tube = [0.06, 0.06, 0.07];
    const part = f => { const b = new Builder(); f(b); return b; };
    return {
      // The hull, drawn at hip height; leg mounts at the corners.
      hip: part(b => {
        b.cube(M.S(3.4, 1.3, 4.4), c, 0.85, 0.9);
        b.cube(chain(M.T(0, -0.1, 2.45), M.S(2.4, 0.9, 0.7)), dark, 0.8, 0.8);
        b.cube(chain(M.T(0, 0.15, -2.35), M.S(2.6, 1.0, 0.6)), dark);
        for (const sx of [1, -1]) for (const sz of [1, -1]) b.cube(chain(M.T(sx * 1.45, 0, sz * 1.6), M.S(0.95, 0.95, 0.95)), acc);
      }),
      // l1 = 2.4 thigh, l2 = 2.9 tapering shin, a broad pad of a foot.
      uleg: part(b => { b.cube(chain(M.T(0, -1.2, 0), M.S(0.8, 2.4, 0.9)), c); b.cube(chain(M.T(0, -2.4, 0), M.S(0.95, 0.75, 0.95)), dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -1.45, 0), M.S(0.55, 2.9, 0.6)), c, 1.45, 1.4); b.cube(chain(M.T(0, -0.2, 0), M.S(0.85, 0.5, 0.85)), dark); }),
      foot: part(b => b.cube(chain(M.T(0, -0.17, 0), M.S(1.15, 0.35, 1.15)), dark, 0.75, 0.75)),
      // The turret: cockpit at the front, an LRM box on top.
      torso: part(b => {
        b.cube(chain(M.T(0, 0.7, 0), M.S(2.7, 1.4, 2.5)), c, 0.85, 0.85);
        b.cube(chain(M.T(0, 0.85, 1.3), M.S(1.5, 0.5, 0.25)), glass);
        b.cube(chain(M.T(0, 1.75, -0.3), M.S(1.8, 0.75, 1.5)), acc);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
          b.cube(chain(M.T((i - 1.5) * 0.4, 1.6 + j * 0.3, 0.46), M.S(0.22, 0.22, 0.06)), tube);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.35, 0.2), M.S(0.8, 1.1, 1.6)), c);
        b.cube(chain(M.T(0, -0.5, 1.6), M.S(0.36, 0.36, 2.4)), dark);
      }),
    };
  }

  /* ======================= the app ======================= */

  function start(root) {
    root.innerHTML = `
      <div class="mech-wrap" tabindex="-1">
        <canvas class="mech-gl"></canvas><canvas class="mech-hud"></canvas>
        <div class="touch-ui" hidden>
          <div class="stick" hidden><div class="knob"></div></div>
          <button class="tbtn tpause" data-t="pause" aria-label="Pause">II</button>
          <button class="tbtn tzoom" data-t="zoom">ZOOM</button>
          <button class="tbtn tstop" data-t="stop">STOP</button>
          <div class="tcluster">
            <button class="tbtn" data-t="jump">JUMP</button>
            <button class="tbtn" data-t="tgt">TGT</button>
            <button class="tbtn tfire t-fusion" data-t="fusion">FUSION</button>
            <button class="tbtn tfire t-missile" data-t="missile">MISSILE</button>
            <button class="tbtn tfire t-energy" data-t="energy">ENERGY</button>
            <button class="tbtn tfire t-ballistic" data-t="ballistic">BALLISTIC</button>
          </div>
        </div>
        <div class="mech-overlay"></div>
      </div>`;
    const wrap = $('.mech-wrap', root), cv = $('.mech-gl', root), hud = $('.mech-hud', root), ov = $('.mech-overlay', root);
    const ctx = hud.getContext('2d');
    const gl = cv.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) {
      ov.innerHTML = '<div class="panel">Stompy needs WebGL, which this browser has turned off or does not support.</div>';
      return;
    }

    /* ---------- GL setup ---------- */

    const compile = (vs, fs) => {
      const sh = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    const prog = compile(`
      attribute vec3 aPos, aNrm, aCol;
      uniform mat4 uVP, uM; uniform vec3 uLight, uTint, uCam; uniform float uEmis; uniform vec2 uFog;
      varying vec3 vCol; varying float vFog;
      void main() {
        vec4 wp = uM * vec4(aPos, 1.0);
        gl_Position = uVP * wp;
        vec3 n = normalize((uM * vec4(aNrm, 0.0)).xyz);
        float d = max(dot(n, uLight), 0.0);
        vec3 base = aCol * uTint;
        vCol = mix(base * (0.36 + 0.78 * d), base, uEmis);
        vFog = clamp((length(wp.xyz - uCam) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
      }`, `
      precision mediump float;
      uniform vec3 uFogCol; uniform float uIR, uHeat; varying vec3 vCol; varying float vFog;
      void main() {
        vec3 c = mix(vCol, uFogCol, vFog);
        if (uIR > 0.5) {
          // White-hot infrared (the missile camera): cold things are dim greys
          // by brightness; hot things -- mechs, fire, weapons -- glow white.
          float l = dot(vCol, vec3(0.3, 0.59, 0.11));
          float g = mix(0.1 + l * 0.3, 0.97, uHeat);
          c = vec3(mix(g, 0.06, vFog * 0.9));
        }
        gl_FragColor = vec4(c, 1.0);
      }`);
    const skyProg = compile(`
      attribute vec2 aP; void main() { gl_Position = vec4(aP, 0.999, 1.0); }`, `
      precision mediump float;
      uniform vec3 uZen, uHor; uniform float uH, uRes;
      void main() {
        float y = gl_FragCoord.y / uRes - uH;
        gl_FragColor = vec4(mix(uHor, uZen, smoothstep(0.0, 0.55, y)), 1.0);
      }`);
    const L = n => gl.getUniformLocation(prog, n);
    const U = { VP: L('uVP'), M: L('uM'), light: L('uLight'), tint: L('uTint'), cam: L('uCam'), emis: L('uEmis'), fog: L('uFog'), fogCol: L('uFogCol'), ir: L('uIR'), heat: L('uHeat') };
    const A = { pos: gl.getAttribLocation(prog, 'aPos'), nrm: gl.getAttribLocation(prog, 'aNrm'), col: gl.getAttribLocation(prog, 'aCol') };
    const SU = { zen: gl.getUniformLocation(skyProg, 'uZen'), hor: gl.getUniformLocation(skyProg, 'uHor'), h: gl.getUniformLocation(skyProg, 'uH'), res: gl.getUniformLocation(skyProg, 'uRes') };
    const skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const upload = b => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.d), gl.STATIC_DRAW);
      return { buf, count: b.d.length / 9 };
    };
    const meshes = {};
    const unit = new Builder(); unit.cube(M.id(), [1, 1, 1]);
    meshes.cube = upload(unit);
    const beam = new Builder(); beam.cube(M.T(0, 0, 0.5), [1, 1, 1]);
    meshes.beam = upload(beam);
    const mechParts = {};
    for (const k of Object.keys(CHASSIS)) {
      const p = buildMechParts(CHASSIS[k]);
      mechParts[k] = Object.fromEntries(Object.entries(p).map(([n, b]) => [n, upload(b)]));
    }

    // A mesh set per chassis + multiplayer colour, built the first time it's needed.
    function partsKeyFor(color, type = 'kestrel') {
      if (!CHASSIS[type]) type = 'kestrel';
      const key = `${type}:${color}`;
      if (!mechParts[key]) {
        const c = MP_COLORS[color] || MP_COLORS[0];
        const p = buildMechParts({ ...CHASSIS[type], col: c.col, acc: c.acc });
        mechParts[key] = Object.fromEntries(Object.entries(p).map(([n, b]) => [n, upload(b)]));
      }
      return key;
    }

    let curMesh = null;
    // `heat` is for the IR view; unset, it uses drawHeat (set around groups of draws).
    let drawHeat = 0;
    const draw = (mesh, m, tint = [1, 1, 1], emis = 0, heat) => {
      if (curMesh !== mesh) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
        gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 36, 0);
        gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, 36, 12);
        gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, 36, 24);
        curMesh = mesh;
      }
      gl.uniformMatrix4fv(U.M, false, m);
      gl.uniform3fv(U.tint, tint);
      gl.uniform1f(U.emis, emis);
      gl.uniform1f(U.heat, heat === undefined ? drawHeat : heat);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    };

    /* ---------- sound & voice ---------- */

    // Samples are CC0 clips from Kenney's Sci-fi and Impact packs (see
    // sounds/stompy/). Each sfx layers samples over the original synthesis,
    // which also stands in if the samples haven't loaded.
    let noiseBuf = null, bus = null;
    const ac = () => (settings.sound ? Sound.ctx : null);
    // Everything goes through one compressor, so stacked booms stay punchy
    // instead of clipping.
    const out = () => {
      const c = Sound.ctx;
      if (!bus || bus.context !== c) {
        bus = c.createDynamicsCompressor();
        bus.threshold.value = -16; bus.knee.value = 8; bus.ratio.value = 5; bus.attack.value = 0.004; bus.release.value = 0.2;
        bus.connect(c.destination);
      }
      return bus;
    };
    const noise = () => {
      const c = Sound.ctx;
      if (!noiseBuf && c) {
        noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = random() * 2 - 1;
      }
      return noiseBuf;
    };
    // Where a sound is, as heard from the cockpit. `ref` is how far it carries
    // at full volume: past that it falls off inversely with distance, like real
    // sound (an explosion carries across the map; a footstep doesn't). It pans
    // by bearing relative to where the torso faces, and far sounds lose their
    // highs the way they do outdoors. null = too faint to bother playing.
    // Sounds with no position (`at` null) are your own: full, centred, clear.
    function spatial(at, ref = 25) {
      if (!at) return { g: 1, pan: 0, lp: 0 };
      const ear = G.ear || G.eye, dx = at[0] - ear[0], dy = at[1] - ear[1], dz = at[2] - ear[2], d = hypot(dx, dy, dz);
      if (!Number.isFinite(d)) return null;
      const g = d <= ref ? 1 : ref / (ref + 1.4 * (d - ref));
      if (g < 0.02) return null;
      // yaw grows to the left; StereoPanner is -1 left .. +1 right. Right
      // beside you it stays centred, or a sound at your feet flips sides.
      const rel = wrapA(atan2(dx, dz) - (G.earYaw ?? viewYaw(G.player)));
      const pan = clampN(-sin(rel) * min(1, d / 10), -1, 1) * 0.85;
      const lp = d < 40 ? 0 : clampN(18000 * Math.pow(0.9955, d - 40), 700, 18000);
      return { g, pan, lp };
    }
    // Connect a sound's last node to the mix through its muffling and panning.
    function routeOut(c, node, sp) {
      let n = node;
      if (sp.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = sp.lp; n.connect(f); n = f; }
      if (sp.pan && c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = sp.pan; n.connect(pn); n = pn; }
      n.connect(out());
    }

    // name -> number of takes (files name0..nameN-1, or just name.mp3 for 1).
    const SAMPLES = { step: 5, punch: 3, plate: 2, laser: 5, mlaser: 5, crunch: 5, boom_big: 1, boom_low: 1,
      missile: 1, jet_loop: 1, hum_loop: 1, servo_loop: 1, powerdown: 1, powerup: 1, beep: 1 };
    const buffers = {};
    let loading = null;
    // Make a clip loop without a click. MP3 pads each end with a little
    // silence, and any loop point cut into a recording leaves the waveform
    // jumping between unrelated values -- an audible tick every time round
    // (worst on the steady reactor hum). So drop the padding, then crossfade
    // the last quarter-second into the start: playing past the end now runs
    // straight into a continuation of itself. Equal-power curves, since these
    // are noisy, uncorrelated sounds.
    function seamless(buf) {
      const sr = buf.sampleRate, trim = Math.floor(0.06 * sr), X = Math.floor(0.25 * sr);
      const n = buf.length - 2 * trim - X;
      if (n <= X) return buf;
      const loop = Sound.ctx.createBuffer(buf.numberOfChannels, n, sr);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const src = buf.getChannelData(ch), dst = loop.getChannelData(ch);
        for (let i = 0; i < n; i++) dst[i] = src[trim + i];
        for (let i = 0; i < X; i++) {
          const t = (i / X) * PI / 2;
          dst[i] = src[trim + i] * sin(t) + src[trim + n + i] * cos(t);
        }
      }
      return loop;
    }

    function loadSamples() {
      const c = Sound.ctx;
      if (!c || loading) return;
      loading = Promise.all(Object.entries(SAMPLES).flatMap(([name, n]) => Array.from({ length: n }, (_, i) =>
        fetch(`sounds/${n > 1 ? name + i : name}.mp3`)
          .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then(b => new Promise((ok, fail) => c.decodeAudioData(b, ok, fail)))   // callback form: every Safari
          .then(buf => { (buffers[name] ||= []).push(name.endsWith('_loop') ? seamless(buf) : buf); })
          .catch(() => { /* synthesis covers it */ }))));
    }
    // Play one random take. Lower rate = deeper and longer = heavier.
    // At most this many one-shot sounds at once. Eight mechs stepping plus a
    // few missile volleys (every missile explodes) can otherwise stack up
    // hundreds of voices, and a phone's audio gives out under that. Extra
    // sounds are simply skipped -- nobody hears the 40th explosion anyway.
    const MAX_SFX = 32;
    let liveSfx = 0;
    const voice = node => {
      if (liveSfx >= MAX_SFX) return false;
      liveSfx++;
      node.onended = () => { liveSfx = max(0, liveSfx - 1); };
      return true;
    };
    // A single NaN reaching the compressor silences everything until reload.
    const ok = (...v) => v.every(Number.isFinite);

    function play(name, { vol = 1, rate = 1, vary = 0.07, at = null, ref = 25, delay = 0 } = {}) {
      const c = ac(), list = buffers[name];
      if (!c || !list?.length) return false;
      const sp = spatial(at, ref);
      if (!sp) return true;
      const v = vol * sp.g, pr = rate * (1 + rnd(-vary, vary));
      if (!ok(v, pr) || v < 0.004) return true;
      const src = c.createBufferSource(), g = c.createGain();
      if (!voice(src)) return true;
      src.buffer = list[floor(random() * list.length)];
      src.playbackRate.value = pr;
      g.gain.value = v;
      src.connect(g);
      routeOut(c, g, sp);
      src.start(c.currentTime + delay);
      return true;
    }

    // Continuous layers: reactor hum (tracks speed), jump-jet roar, torso servo whine.
    const loops = {};
    function loopSet(name, gain, rate = 1) {
      const c = ac();
      let l = loops[name];
      if (!c) { if (l) l.g.gain.value = 0; return; }
      if (!l) {
        const buf = buffers[name]?.[0];
        if (!buf) return;
        const src = c.createBufferSource(), g = c.createGain();
        src.buffer = buf; src.loop = true;   // already made seamless at load: loop the whole buffer
        g.gain.value = 0;
        src.connect(g).connect(out());
        src.start(c.currentTime);
        l = loops[name] = { src, g };
      }
      l.g.gain.setTargetAtTime(gain, c.currentTime, 0.08);
      l.src.playbackRate.setTargetAtTime(rate, c.currentTime, 0.15);
    }
    // osc/noise take { at, ref, delay } like play(): positioned and panned.
    const sfx = {
      osc(type, f0, f1, dur, vol, { at = null, ref = 25, delay = 0 } = {}) {
        const c = ac(), sp = c && spatial(at, ref);
        if (!sp) return;
        vol *= sp.g;
        if (!ok(f0, f1, dur, vol) || vol < 0.003) return;
        const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
        if (!voice(o)) return;
        o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); routeOut(c, g, sp); o.start(t); o.stop(t + dur + 0.02);
      },
      noise(dur, vol, f0, f1, type = 'lowpass', { at = null, ref = 25 } = {}) {
        const c = ac(), sp = c && spatial(at, ref);
        if (!sp) return;
        vol *= sp.g;
        if (!ok(f0, f1, dur, vol) || vol < 0.003) return;
        const t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        if (!voice(s)) return;
        s.buffer = noise(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g); routeOut(c, g, sp); s.start(t, random() * 0.5); s.stop(t + dur + 0.02);
      },
      // How far each kind of sound carries at full volume (metres): lasers
      // and cannon carry, explosions carry further, footsteps barely.
      laser(p, small) {
        const at = { at: p, ref: 35 };
        if (play(small ? 'mlaser' : 'laser', { ...at, vol: small ? 0.35 : 0.5, rate: small ? 1 : 0.85 })) return;
        this.osc('sawtooth', 1900, 180, 0.28, 0.05, at); this.osc('sine', 900, 120, 0.3, 0.05, at);
      },
      // The autocannon is a thunk first and a bang second.
      cannon(p) {
        const at = { at: p, ref: 40 };
        play('punch', { ...at, vol: 0.9, rate: 0.7 });
        play('crunch', { ...at, vol: 0.45, rate: 1.25 });
        this.osc('sine', 110, 32, 0.32, 0.3, at);
        if (!buffers.punch) this.noise(0.35, 0.3, 900, 80, 'lowpass', at);
      },
      missile(p) { if (!play('missile', { at: p, ref: 30, vol: 0.35, rate: 1.25, vary: 0.15 })) this.noise(0.7, 0.12, 3000, 400, 'bandpass', { at: p, ref: 30 }); },
      boom(p, big) {
        const at = { at: p, ref: big ? 90 : 40 };
        if (big) { play('boom_big', { ...at, vol: 1.1, rate: 0.9 }); play('crunch', { ...at, vol: 0.8, rate: 0.65 }); play('plate', { ...at, vol: 0.4, rate: 0.5, delay: 0.05 }); }
        else { play('crunch', { ...at, vol: 0.55 }); play('boom_low', { ...at, vol: 0.35, rate: 1.4 }); }
        this.osc('sine', big ? 70 : 120, 25, big ? 1.2 : 0.4, big ? 0.4 : 0.25, at);
        if (!buffers.crunch) this.noise(big ? 1.6 : 0.6, big ? 0.6 : 0.25, big ? 700 : 1200, 40, 'lowpass', at);
      },
      // Taking a hit: armour plate ringing.
      clang() {
        play('step', { vol: 0.8, rate: 1.15, vary: 0.12 }); play('plate', { vol: 0.5, rate: 0.9 });
        if (!buffers.step) { this.osc('square', 240, 120, 0.12, 0.05); this.noise(0.15, 0.15, 4000, 800, 'highpass'); }
      },
      step(m, vol) {
        // A footfall is felt more than heard: a short, quiet sub-bass thump
        // with a soft low-passed scuff. No recordings -- on every step of
        // every mech, any sample turns into noise (first a clank, then a
        // string of explosions). Bigger mechs step deeper; others are quieter.
        const mine = m === G.player, at = { at: mine ? null : [m.x, m.y, m.z], ref: 12 };
        const v = vol * (mine ? 1 : 0.55);
        this.osc('sine', 72 / m.ch.scale, 36, 0.16, 0.14 * v, at);
        this.noise(0.07, 0.035 * v, 170, 60, 'lowpass', at);
      },
      land(force) {
        this.osc('sine', 62, 28, 0.32, 0.22 * force);
        this.noise(0.14, 0.08 * force, 200, 50);
        play('punch', { vol: 0.3 * force, rate: 0.5, vary: 0.04 });
      },
      fusionCrack() {
        this.osc('sawtooth', 2600, 180, 0.35, 0.12); this.osc('square', 1400, 90, 0.4, 0.05);
        this.noise(0.25, 0.25, 6000, 900, 'highpass');
      },
      fusion(at) {
        const o = { at, ref: 120 };
        play('boom_big', { ...o, vol: 1.2, rate: 0.7 }); play('crunch', { ...o, vol: 0.9, rate: 0.5 });
        this.osc('sawtooth', 2200, 50, 1.3, 0.12, o); this.osc('sine', 90, 20, 1.6, 0.5, o);
      },
      beep() { if (!play('beep', { vol: 0.2, vary: 0 })) this.osc('square', 1200, 1190, 0.06, 0.03); },
      powerdown() { play('powerdown', { vol: 0.6, rate: 0.6, vary: 0 }); this.osc('sawtooth', 220, 30, 1.6, 0.05); },
      powerup() { play('powerup', { vol: 0.6, rate: 0.8, vary: 0 }); this.osc('sine', 60, 240, 0.8, 0.06); },
    };

    let voices = [];
    const pickVoice = () => {
      try { voices = speechSynthesis.getVoices(); } catch { voices = []; }
    };
    pickVoice();
    try { speechSynthesis.onvoiceschanged = pickVoice; } catch { /* no speech */ }
    const said = {};
    let lastSaid = 0;
    // The cockpit computer. Each line at most every 6s, and never on top of itself.
    function say(text, force) {
      msg(text.toUpperCase(), '#fc3');
      if (!voiceOn || !settings.sound || !window.speechSynthesis) return;
      const now = performance.now();
      if (!force && (now - (said[text] || 0) < 6000 || now - lastSaid < 1200)) return;
      said[text] = lastSaid = now;
      try {
        const u = new SpeechSynthesisUtterance(text);
        const v = voices.find(v => /^en/i.test(v.lang) && /female|zira|samantha|victoria|karen|serena|susan|hazel|libby|aria|jenny/i.test(v.name))
          || voices.find(v => /^en/i.test(v.lang));
        if (v) u.voice = v;
        u.rate = 1.05; u.pitch = 1.05; u.volume = 0.9;
        speechSynthesis.speak(u);
      } catch { /* ignore */ }
    }

    /* ---------- game state ---------- */

    let voiceOn = store.get('mech.voice', true);
    let invertY = store.get('mech.invert', false);
    let missionN = store.get('mech.mission', 0);
    // Main-menu choices, remembered between visits.
    let chassis = MECH_ORDER.includes(store.get('mech.chassis')) ? store.get('mech.chassis') : 'kestrel';
    let menuSel = store.get('menu.sel', 'campaign');
    let fpMap = store.get('fp.map', 0), fpFoes = store.get('fp.foes', 3);
    const G = { state: 'brief', paused: false, mechs: [], shots: [], beams: [], parts: [], wrecks: [], msgs: [],
      eye: [0, 0, 0], view: [0, 0, 1], flash: 0, shake: 0, kick: 0, lastTwist: 0, cbeams: [], pendingHits: new Map(), pulses: [],
      touchUI: matchMedia('(pointer: coarse)').matches, touchTurn: 0, zoom: false, target: null, sel: 0, endT: 0 };
    let ter = null, world = null, pal = null;
    const keys = {};
    // Which fire controls are held: by touch button, mouse button or key.
    const held = { energy: false, ballistic: false, missile: false, fusion: false };
    const clearHeld = () => { for (const c of CATS) held[c] = false; };
    let volleySeq = 0;
    const KEY_FOR = { energy: ['Digit1'], ballistic: ['Digit2'], missile: ['Digit3', 'Space'], fusion: ['Digit4', 'KeyG'] };
    const isHeld = c => held[c] || KEY_FOR[c].some(k => keys[k]);
    // A missile press is latched until the next frame sees it, so a tap
    // shorter than a frame (a slow phone, a quick thumb) still fires.
    let missileTap = false;

    function newMech(type, team, x, z, yaw, opts = {}) {
      const ch = CHASSIS[type];
      const m = {
        type, ch, team, partsKey: opts.partsKey || type, netId: 0, remote: false, spawnT: 0, x, z, y: ter.height(x, z), vy: 0, yaw, twist: 0, pitch: 0, speed: 0, throttle: 0, heat: 0,
        fuel: 1, jetting: false, air: false, shutdown: false, alive: true,
        hp: { ...ch.hp }, max: { ...ch.hp },
        weapons: ch.weapons.map(([w, mount], i) => ({ type: w, def: WEAPONS[w], mount, cd: random() * 0.5, ammo: WEAPONS[w].ammo || null, dead: false, side: i })),
        ai: { aware: false, strafe: random() < 0.5 ? 1 : -1, strafeT: rnd(2, 5), jitter: rnd(0.2, 0.8), wp: null },
      };
      initFeet(m);
      return m;
    }

    function startMission(n) {
      missionN = n; store.set('mech.mission', max(store.get('mech.mission', 0), n));
      startMatch(missionDef(n), 7 + n * 13, n === 0);
      G.kind = 'campaign';
    }
    // Free play: a one-off battle on the chosen map with the chosen number of hostiles.
    const FP_MAPS = ['random', 'dusk', 'ice', 'volcanic'];
    function startSkirmish() {
      const pk = FP_MAPS[fpMap] === 'random' ? ['dusk', 'ice', 'volcanic'][floor(random() * 3)] : FP_MAPS[fpMap];
      const foes = Array.from({ length: fpFoes }, () => (random() < 0.35 ? 'warden' : 'jackal'));
      startMatch({ name: 'Free Play', pal: pk, foes, intel: '' }, 1 + floor(random() * 1e5), false);
      G.kind = 'free';
    }
    function startMatch(def, seed, gentle) {
      G.worldKind = 'match';
      pal = PALS[def.pal];
      ter = makeTerrain(seed);
      if (world) gl.deleteBuffer(world.buf);
      world = upload(buildTerrainMesh(ter, pal, seed));
      G.mechs = []; G.shots = []; G.beams = []; G.parts = []; G.wrecks = []; G.msgs = []; G.pulses = [];
      G.target = null; G.flash = 0; G.shake = 0; G.kick = 0; G.zoom = false; G.endT = 0; G.time = 0; G.guide = null; G.mDown = false;
      G.stats = { shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0 };
      G.def = def;
      G.player = newMech(chassis, 0, 0, 0, 0);
      G.mechs.push(G.player);
      G.eye = eyeOf(G.player); G.view = dirOf(0, 0); G.aim = add(G.eye, mul(G.view, 100));
      def.foes.forEach((t, i) => {
        const a = (i / def.foes.length) * TAU + rnd(-0.4, 0.4) + PI * 0.6, d = rnd(520, 760);
        const x = clampN(sin(a) * d, -BOUND, BOUND), z = clampN(cos(a) * d, -BOUND, BOUND);
        const e = newMech(t, 1, x, z, atan2(-x, -z) + rnd(-1, 1));
        e.ai.aware = i === 0 && gentle ? false : random() < 0.3;
        G.mechs.push(e);
      });
    }

    /* ---------- geometry helpers ---------- */

    const frame = m => chain(M.T(m.x, m.y + (m.bob || 0), m.z), M.RY(m.yaw), M.S(m.ch.scale));
    const torsoFrame = m => chain(frame(m), M.T(0, geoOf(m).torsoY, 0), M.RY(m.twist));
    const center = m => [m.x, m.y + 4.2 * m.ch.scale, m.z];
    function muzzle(m, w) {
      const tf = torsoFrame(m), g = geoOf(m);
      if (w.mount === 'T') return M.apply(tf, w.type === 'lrm' ? [w.side % 2 ? -1.25 : 1.25, g.rackY, 0.6] : [-0.9, g.acY, 1.6]);
      return M.apply(tf, [(w.mount === 'LA' ? 1 : -1) * g.armX, g.armY - 1.2, 2.4]);
    }
    const eyeOf = m => M.apply(torsoFrame(m), geoOf(m).eye);
    const viewYaw = m => m.yaw + m.twist;

    function rayCyl(o, d, m) {
      const g = geoOf(m), R = g.radius * m.ch.scale, Hh = g.height * m.ch.scale;
      const ox = o[0] - m.x, oz = o[2] - m.z, a = d[0] * d[0] + d[2] * d[2];
      if (a < 1e-8) return null;
      const b = 2 * (ox * d[0] + oz * d[2]), c = ox * ox + oz * oz - R * R, disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const sq = sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0) continue;
        const y = o[1] + d[1] * t;
        if (y >= m.y && y <= m.y + Hh) return t;
      }
      return null;
    }
    function rayTerrain(o, d, maxT) {
      const step = 4;
      let prev = 0;
      for (let t = min(step, maxT); ; t = min(t + step, maxT)) {
        const p = add(o, mul(d, t));
        if (p[1] < ter.height(p[0], p[2])) {
          let lo = prev, hi = t;
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) / 2, q = add(o, mul(d, mid));
            if (q[1] < ter.height(q[0], q[2])) hi = mid; else lo = mid;
          }
          return hi;
        }
        if (t >= maxT) return null;
        prev = t;
      }
    }
    function rayHit(o, d, maxT, ignore) {
      let best = null;
      for (const m of G.mechs) {
        if (!m.alive || m === ignore) continue;
        const t = rayCyl(o, d, m);
        if (t != null && t <= maxT && (!best || t < best.t)) best = { t, mech: m };
      }
      const tt = rayTerrain(o, d, best ? best.t : maxT);
      if (tt != null) best = { t: tt, mech: null };
      if (best) best.point = add(o, mul(d, best.t));
      return best;
    }

    /* ---------- effects ---------- */

    function msg(text, col = '#7f7') {
      G.msgs.push({ text, col, t: 3.5 });
      if (G.msgs.length > 4) G.msgs.shift();
    }
    function particle(p, v, life, size, col, kind, grav = 0) {
      if (G.parts.length > 420) G.parts.shift();
      G.parts.push({ p: [...p], v, life, max: life, size, col, kind, grav, spin: random() * TAU });
    }
    function explode(p, big) {
      const n = big ? 34 : 10, s = big ? 1.6 : 0.7;
      for (let i = 0; i < n; i++) {
        const v = mul(norm([rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)]), rnd(3, 14) * s);
        particle(p, v, rnd(0.35, 0.9), rnd(0.6, 1.6) * s, [1, rnd(0.45, 0.9), 0.1], 'fire');
      }
      for (let i = 0; i < n / 2; i++) particle(add(p, [rnd(-2, 2), rnd(0, 2), rnd(-2, 2)]), [rnd(-1, 1), rnd(2, 5), rnd(-1, 1)], rnd(1.5, 3), rnd(1, 2.4) * s, [0.25, 0.23, 0.22], 'smoke');
      if (big) for (let i = 0; i < 12; i++) particle(p, [rnd(-9, 9), rnd(8, 20), rnd(-9, 9)], rnd(1.5, 2.6), rnd(0.4, 1.1), [0.2, 0.2, 0.2], 'debris', 26);
      const d = len(sub(p, G.eye));
      G.shake = min(1.2, G.shake + (big ? 1 : 0.35) * clampN(1 - d / 220, 0, 1));
      sfx.boom(p, big);
    }

    /* ---------- combat ---------- */

    function sectionHit(m, p) {
      const dx = p[0] - m.x, dz = p[2] - m.z, ly = (p[1] - m.y) / m.ch.scale;
      if (ly < geoOf(m).legTop) { const a = m.yaw; return dx * cos(a) - dz * sin(a) > 0 ? 'LL' : 'RL'; }
      const a = viewYaw(m), lx = (dx * cos(a) - dz * sin(a)) / m.ch.scale;
      return lx > 1.6 ? 'LA' : lx < -1.6 ? 'RA' : 'T';
    }

    // `beam`: a slice of continuous laser damage (one frame's worth) -- it
    // isn't a "hit" for accuracy, and mustn't ring the armour every frame.
    function damage(m, p, amt, src, beam = false) {
      if (!m.alive) return;
      if (m.remote) {
        // Another pilot: what the shooter sees counts, and the victim's own
        // client applies it. Hits are batched (a beam deals damage every
        // frame) and flushed a few times a second -- see flushHits.
        if (G.roundOver) return;
        const q = G.pendingHits.get(m.netId) || { amt: 0, p };
        q.amt += amt; q.p = p;
        G.pendingHits.set(m.netId, q);
        if (src === G.player) { if (!beam) G.stats.hits++; G.stats.dealt += amt; G.hitMark = 0.25; }
        return;
      }
      if (m === G.player && mp() && (m.spawnT > 0 || G.roundOver)) return;
      let sec = sectionHit(m, p);
      if (m.hp[sec] <= 0) sec = 'T';
      m.hp[sec] -= amt;
      if (src === G.player && m !== G.player) { if (!beam) G.stats.hits++; G.stats.dealt += amt; }
      if (m === G.player) {
        G.stats.taken += amt;
        G.flash = min(0.55, G.flash + amt * 0.04);
        G.shake = min(1.2, G.shake + amt * 0.05);
        if (!beam || G.time - (G.lastClang || 0) > 0.35) { G.lastClang = G.time; sfx.clang(); }
        if (!G.target && src && src.alive) G.target = src;
      } else m.ai.aware = true;
      if (m.hp[sec] > 0) {
        if (m === G.player && sec === 'T' && m.hp.T < m.max.T * 0.3) say('Warning. Critical damage.');
        return;
      }
      const over = -m.hp[sec];
      m.hp[sec] = 0;
      if (sec === 'T') return destroy(m, src);
      m.weapons.forEach(w => { if (w.mount === sec) w.dead = true; });
      explode(p, false);
      if (m === G.player) say(`${SECT_NAME[sec]} destroyed.`, true);
      else if (src === G.player) msg(`${m.ch.name}: ${SECT_NAME[sec].toUpperCase()} DESTROYED`);
      if (over > 0) { m.hp.T -= over; if (m.hp.T <= 0) { m.hp.T = 0; destroy(m, src); } }
    }

    function destroy(m, src) {
      if (m === G.player) { endGuide(true); G.mDown = false; }
      m.alive = false;
      explode(center(m), true);
      explode(add(center(m), [rnd(-3, 3), 2, rnd(-3, 3)]), false);
      G.wrecks.push({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, type: m.partsKey, scale: m.ch.scale, t: 0, roll: rnd(-0.6, 0.6) });
      if (G.target === m) G.target = null;
      if (mp() && m === G.player) {
        // In the arena your own client declares your death; the server scores it.
        netSend({ t: 'died', by: src?.netId || 0 });
        sendState();
        // Real time, not game time: a slow phone shouldn't make the wait longer.
        G.respawnAt = performance.now() + 5000; G.killer = src?.netId || 0;
        msg('MECH DESTROYED', '#f44');
        return;
      }
      if (m === G.player) {
        G.state = 'over'; G.endT = 3.2; G.won = false;
        msg('MECH DESTROYED', '#f44');
        return;
      }
      if (src === G.player) G.stats.kills++;
      say('Target destroyed.', true);
      if (G.player.alive && !G.mechs.some(e => e.team !== 0 && e.alive)) {
        G.state = 'over'; G.endT = 3.5; G.won = true;
        setTimeout(() => say('Mission objectives complete.', true), 1400);
      }
    }

    function fire(m, w, aim, target) {
      const d = w.def;
      if (d.kind === 'beam' || d.kind === 'fusion') return false;   // continuous: see beamTick / fusionTick
      if (!m.alive || m.shutdown || w.dead || w.cd > 0 || (d.ammo && w.ammo <= 0)) return false;
      const mz = muzzle(m, w);
      const dir = norm(sub(aim, mz));
      w.cd = d.cd; m.heat += d.heat;
      if (d.ammo) w.ammo--;
      if (m === G.player) G.stats.shots += d.count || 1;   // each missile can hit, so each counts
      if (d.kind === 'beam') {
        const hit = rayHit(mz, dir, d.range, m);
        const end = hit ? hit.point : add(mz, mul(dir, d.range));
        G.beams.push({ a: mz, b: end, col: d.col, w: d.w, life: 0.14, max: 0.14 });
        if (mp() && m === G.player) netSend({ t: 'fx', k: 'b', w: w.type, a: mz.map(r2), b: end.map(r2) });
        if (hit) {
          for (let i = 0; i < 4; i++) particle(end, [rnd(-4, 4), rnd(1, 6), rnd(-4, 4)], 0.25, 0.35, d.col, 'fire');
          if (hit.mech) damage(hit.mech, end, d.dmg, m);
        }
        sfx.laser(mz, d === WEAPONS.mlaser);
      } else if (d.kind === 'shell') {
        G.shots.push({ kind: 'shell', p: mz, v: mul(dir, d.speed), owner: m, dmg: d.dmg, life: d.range / d.speed });
        if (mp() && m === G.player) netSend({ t: 'fx', k: 's', p: mz.map(r2), v: mul(dir, d.speed).map(r2) });
        for (let i = 0; i < 5; i++) particle(add(mz, mul(dir, 1.5)), add(mul(dir, rnd(4, 12)), [rnd(-2, 2), rnd(-1, 2), rnd(-2, 2)]), 0.15, 0.6, [1, 0.8, 0.3], 'fire');
        sfx.cannon(mz);
      } else {
        const vid = ++volleySeq;
        for (let i = 0; i < d.count; i++) {
          const spread = norm(add(dir, [rnd(-0.08, 0.08), rnd(0, 0.12), rnd(-0.08, 0.08)]));
          G.shots.push({ kind: 'missile', p: add(mz, [rnd(-0.6, 0.6), rnd(-0.4, 0.4), rnd(-0.6, 0.6)]), v: mul(spread, d.speed * rnd(0.85, 1.1)),
            owner: m, dmg: d.dmg, life: d.range / d.speed + 1, target, smoke: 0, age: 0, vid });
        }
        if (m === G.player) G.lastVolley = vid;
        sfx.missile(mz);
        if (mp() && m === G.player) netSend({ t: 'fx', k: 'm', p: mz.map(r2), d: dir.map(r2), tg: target?.netId || 0, v: G.lastVolley });
      }
      return true;
    }

    /* ---------- simulation ---------- */

    function stepMech(m, dt) {
      const legs = (m.hp.LL > 0 ? 0.5 : 0) + (m.hp.RL > 0 ? 0.5 : 0);
      let maxS = m.ch.speed * (legs >= 1 ? 1 : legs > 0 ? 0.45 : 0.04);
      if (m.heat > 85) maxS *= 0.65;
      const target = !m.alive || m.shutdown ? 0 : m.throttle * maxS;
      m.speed += clampN(target - m.speed, -11 * dt, 7 * dt);
      m.x = clampN(m.x + sin(m.yaw) * m.speed * dt, -BOUND, BOUND);
      m.z = clampN(m.z + cos(m.yaw) * m.speed * dt, -BOUND, BOUND);

      const ground = ter.height(m.x, m.z);
      const jets = m.jetting && m.fuel > 0 && !m.shutdown && m.alive;
      if (jets) {
        m.vy = min(m.vy + 30 * dt, 12);
        m.fuel = max(0, m.fuel - dt * 0.32);
        m.heat += 10 * dt;
        if (random() < 0.6) particle(add([m.x, m.y + 1.5, m.z], [rnd(-1, 1), 0, rnd(-1, 1)]), [rnd(-1, 1), -8, rnd(-1, 1)], 0.35, 0.7, [1, 0.6, 0.2], 'fire');
      } else m.fuel = min(1, m.fuel + dt * 0.12);
      m.vy -= 18 * dt;
      m.y += m.vy * dt;
      if (!jets && m.vy <= 0 && m.y - ground < 1.2) {
        if (m.air) {
          const force = clampN(-m.vy / 20, 0.25, 1);
          if (m === G.player) { G.shake = min(1.2, G.shake + 0.6 * force); G.kick = 1; sfx.land(force); }
          else sfx.step(m, force * 0.8);
        }
        m.y = ground; m.vy = 0; m.air = false;
      } else if (m.y > ground + 1.2) m.air = true;
      if (m.y < ground) { m.y = ground; m.vy = max(0, m.vy); }

      m.heat = max(0, m.heat - (m.shutdown ? 20 : m.ch.sink) * dt);
      if (!m.shutdown && m.heat >= 100) {
        m.shutdown = true;
        if (m === G.player) { sfx.powerdown(); say('Reactor shutdown.', true); }
      } else if (m.shutdown && m.heat < 45) {
        m.shutdown = false;
        if (m === G.player) { sfx.powerup(); say('Reactor online.', true); }
      }
      if (m === G.player && m.heat > 80 && !m.shutdown) say('Warning. Heat critical.');
      for (const w of m.weapons) w.cd = max(0, w.cd - dt);

      gait(m, dt);
    }

    /* ---------- legs: planted feet + two-bone IK ---------- */
    // A planted foot stays exactly where it landed while the body moves over
    // it. Once the hip has passed it by half a stride it lifts, arcs, and
    // lands half a stride ahead of where the body will be at touchdown -- so
    // feet never slide, and faster walking just means quicker steps.
    // Where foot i would stand, `ahead` units along the heading.
    function restFoot(m, i, ahead = 0) {
      const s = m.ch.scale, leg = geoOf(m).legs[i], c = cos(m.yaw), sn = sin(m.yaw);
      const lx = leg.fx * s, lz = leg.fz * s + ahead;
      const x = m.x + c * lx + sn * lz, z = m.z - sn * lx + c * lz;
      return [x, ter.height(x, z), z];
    }
    function initFeet(m) {
      m.feet = geoOf(m).legs.map((_, i) => ({ pos: restFoot(m, i), from: null, lifted: false, yaw: m.yaw }));
      m.bob = 0; m.cyc = 0.45;   // between swings: every foot planted
    }

    // One gait clock per mech, advanced by distance travelled (and turning),
    // not time -- so the feet can't drift into step with each other, and a
    // swing's landing spot can be predicted exactly. Each leg swings over
    // [ph, ph + swing) of the cycle (bipeds: left at 0, right at 0.5; the
    // quadruped trots, diagonal pairs together); between swings all feet are
    // planted. Each swing aims, every frame, at where its rest spot will be
    // at touchdown plus a stance's worth ahead.
    function swingTarget(m, i, u, D, dir) {
      const sw = geoOf(m).swing;
      return restFoot(m, i, dir * ((1 - u) * sw * D + ((1 - sw) / 2) * D));
    }

    function gait(m, dt) {
      const s = m.ch.scale, pace = min(1, abs(m.speed) / m.ch.speed), crouch = -0.35 * s * pace;
      const dyaw = abs(wrapA(m.yaw - (m.lastYaw ?? m.yaw)));
      m.lastYaw = m.yaw;
      if (m.air) {
        // Legs hang under the body until touchdown.
        m.feet.forEach((f, i) => { const r = restFoot(m, i); f.pos = [r[0], m.y + 1.4 * s, r[2]]; f.lifted = false; f.yaw = m.yaw; });
        m.bob = 0; m.wasAir = true;
        return;
      }
      if (m.wasAir) { m.wasAir = false; m.cyc = 0.45; m.feet.forEach((f, i) => { f.pos = restFoot(m, i); f.yaw = m.yaw; }); }

      // Cycle length in distance: longer strides when faster, but a planted
      // foot never gets more than (1 - swing) / 2 * D from its hip (leg reach).
      const g = geoOf(m), D = s * (g.stride[0] + g.stride[1] * pace);
      const swingOf = i => { const u = (((m.cyc - g.legs[i].ph) % 1 + 1) % 1) / g.swing; return u < 1 ? u : null; };
      const before = g.legs.map((_, i) => swingOf(i));
      const moving = abs(m.speed) > 0.3 || dyaw > 1e-4;
      // Stopped mid-stride: finish the step on the clock rather than freeze with a foot up.
      let adv = moving ? (abs(m.speed) * dt + dyaw * 2.5 * s) / D : (before.some(u => u != null) ? dt / 0.6 : 0);
      m.cyc = (m.cyc + min(adv, 0.2)) % 1;

      const dir = abs(m.speed) > 0.3 ? Math.sign(m.speed) : 0;
      m.bob = crouch;
      m.feet.forEach((f, i) => {
        const u = swingOf(i);
        if (u == null) {
          if (before[i] != null) {   // the swing just ended: put it down exactly on target
            f.pos = swingTarget(m, i, 1, D, dir);
            f.yaw = m.yaw; f.lifted = false;
            footDown(m, f, pace);
          }
          return;
        }
        if (!f.lifted) { f.from = [...f.pos]; f.lifted = true; }
        const t = swingTarget(m, i, u, D, dir), e = u * u * (3 - 2 * u);
        if (hypot(f.from[0] - t[0], f.from[2] - t[2]) > 9 * s) f.from = [...t];   // shoved mid-stride
        f.pos = [lerp(f.from[0], t[0], e), lerp(f.from[1], t[1], e) + sin(PI * u) * (0.5 + 1.1 * pace) * s, lerp(f.from[2], t[2], e)];
        f.yaw += wrapA(m.yaw - f.yaw) * min(1, dt * 10);
        // The body rises over the swinging leg and settles as it lands.
        m.bob = crouch + sin(PI * u) * 0.3 * s * (0.3 + pace);
      });
      // A planted foot left hopelessly far away (shoved, respawned) just resets.
      m.feet.forEach((f, i) => {
        if (f.lifted) return;
        const r = restFoot(m, i);
        if (hypot(f.pos[0] - r[0], f.pos[2] - r[2]) > 7 * s) f.pos = r;
      });
    }

    // Touchdown: the sound, the cockpit jolt, a puff of dust.
    function footDown(m, f, pace) {
      const d = hypot(m.x - G.player.x, m.z - G.player.z);
      if (m === G.player) {
        G.shake = min(1.2, G.shake + 0.12 * pace);
        G.kick = max(G.kick, 0.35 + 0.65 * pace);
        sfx.step(m, 0.4 + 0.55 * pace);
      } else if (d < 350) sfx.step(m, 0.3 + 0.45 * pace);
      if (pace > 0.25 && d < 260 && m !== G.player) {
        for (let i = 0; i < 3; i++) particle(add(f.pos, [rnd(-1, 1), 0.3, rnd(-1, 1)]), [rnd(-2, 2), rnd(0.5, 1.5), rnd(-2, 2)], rnd(0.6, 1), rnd(0.5, 0.9) * m.ch.scale, mul(pal.low, 0.8), 'smoke');
      }
    }

    // Knee position by the law of cosines, bending toward `pole` (forward).
    function solveKnee(H, A, pole, l1, l2) {
      const d = sub(A, H), raw = len(d), n = mul(d, 1 / (raw || 1));
      const dist = clampN(raw, abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
      const a = Math.acos(clampN((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
      let p = sub(pole, mul(n, dot(pole, n)));
      p = len(p) < 1e-4 ? [0, 0, 1] : norm(p);
      return add(H, add(mul(n, l1 * cos(a)), mul(p, l1 * sin(a))));
    }
    // A matrix that hangs a limb mesh (built along -y from its pivot) from P to Q.
    function limb(P, Q, pole, s) {
      const y = norm(sub(P, Q));
      let z = sub(pole, mul(y, dot(pole, y)));
      z = len(z) < 1e-4 ? [0, 0, 1] : norm(z);
      const x = cross(y, z);
      return new Float32Array([x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, P[0], P[1], P[2], 1]);
    }

    function think(e, dt) {
      const P = G.player, dx = P.x - e.x, dz = P.z - e.z, dist = hypot(dx, dz);
      const toYaw = atan2(dx, dz);
      if (!e.ai.aware && (dist < 600 || G.time > 25)) e.ai.aware = true;
      let moveYaw, thr = 1;
      if (!e.ai.aware) {
        if (!e.ai.wp || hypot(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z) < 30) e.ai.wp = [clampN(e.x + rnd(-250, 250), -BOUND, BOUND), clampN(e.z + rnd(-250, 250), -BOUND, BOUND)];
        moveYaw = atan2(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z); thr = 0.5;
      } else {
        e.ai.strafeT -= dt;
        if (e.ai.strafeT <= 0) { e.ai.strafe *= -1; e.ai.strafeT = rnd(3, 7); }
        const pref = e.ch.pref;
        if (dist > pref * 1.35) moveYaw = toYaw + e.ai.strafe * 0.35;
        else if (dist < pref * 0.6) moveYaw = toYaw + PI - e.ai.strafe * 0.6;
        else { moveYaw = toYaw + e.ai.strafe * PI / 2; thr = 0.75; }
        // Steer away from the map edge.
        if (abs(e.x) > BOUND - 60 || abs(e.z) > BOUND - 60) moveYaw = atan2(-e.x, -e.z);
      }
      e.yaw += clampN(wrapA(moveYaw - e.yaw), -e.ch.turn * dt, e.ch.turn * dt);
      e.throttle = thr;
      if (!e.ai.aware) { e.twist *= 1 - dt; return; }
      const wantTwist = clampN(wrapA(toYaw - e.yaw), -1.9, 1.9);
      e.twist += clampN(wrapA(wantTwist - e.twist), -2 * dt, 2 * dt);
      const pc = center(P);
      e.pitch = atan2(pc[1] - (e.y + 6 * e.ch.scale), dist);
      // Fire when the torso is on target, the weapon is in range, and heat allows.
      const off = abs(wrapA(toYaw - viewYaw(e)));
      e.ai.jitter -= dt;
      // Lasers: hold the beam on in bursts while on target and cool enough,
      // with an aim error that drifts, so the beam wanders on and off you.
      const beam = e.weapons.find(w => w.def.kind === 'beam' && !w.dead);
      if (beam && off < 0.3 && dist < beam.def.range * 0.95 && !e.shutdown && P.alive) {
        if (e.heat > 70) e.ai.coolT = rnd(1.5, 3);
        if ((e.ai.coolT = max(0, (e.ai.coolT || 0) - dt)) === 0) {
          const err = dist * e.ch.acc0 * (1 + abs(P.speed) / 14) * (P.air ? 1.6 : 1), k = G.time * 0.9 + e.ai.strafeT;
          e.ai.beamAim = add(pc, [sin(k * 1.3) * err, sin(k * 1.7) * err * 0.5, cos(k * 1.1) * err]);
          e.beamOn = true;
        }
      }
      if (off > 0.25 || e.heat > 72 || e.shutdown || e.ai.jitter > 0 || !P.alive) return;
      for (const w of e.weapons) {
        if (w.def.kind === 'beam' || w.def.kind === 'fusion' || w.dead || w.cd > 0 || dist > w.def.range * 0.95) continue;
        let aim = pc;
        if (w.def.kind === 'shell') { const t = dist / w.def.speed; aim = add(pc, [sin(P.yaw) * P.speed * t, 0, cos(P.yaw) * P.speed * t]); }
        const err = dist * e.ch.acc0 * (1 + abs(P.speed) / 14) * (P.air ? 1.6 : 1);
        aim = add(aim, [rnd(-err, err), rnd(-err, err) * 0.6, rnd(-err, err)]);
        if (fire(e, w, aim, P)) { e.ai.jitter = rnd(0.15, 0.6); break; }
      }
    }

    function update(dt) {
      G.time += dt;
      G.cbeams = [];   // continuous beams are redrawn every frame they're on
      G.frame = (G.frame || 0) + 1;
      const P = G.player;
      if (P.alive && !P.shutdown && !G.paused) {
        if (keys.KeyW) P.throttle = min(1, P.throttle + dt * 0.9);
        if (keys.KeyS) P.throttle = max(-0.35, P.throttle - dt * 0.9);
        if (keys.KeyX) P.throttle = 0;
        const turn = clampN((keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0) + G.touchTurn, -1, 1);
        P.yaw += turn * P.ch.turn * dt * (P.hp.LL > 0 && P.hp.RL > 0 ? 1 : 0.5);
        const kt = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0), kp = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
        if (G.guide) { G.guide.yaw += kt * 1.4 * dt; G.guide.pitch = clampN(G.guide.pitch + kp * 1.0 * dt, -1.3, 1.3); }
        else {
          P.twist = clampN(P.twist + kt * 1.6 * dt, -1.9, 1.9);
          P.pitch = clampN(P.pitch + kp * 0.9 * dt, -0.4, 0.45);
        }
        if (keys.KeyC) P.twist *= max(0, 1 - 6 * dt);
        P.jetting = !!keys.KeyJ;
      } else P.jetting = false;

      G.eye = eyeOf(P);
      G.view = dirOf(viewYaw(P), P.pitch);
      const aimHit = rayHit(G.eye, G.view, 1100, P);
      G.aim = aimHit ? aimHit.point : add(G.eye, mul(G.view, 1100));
      G.aimMech = aimHit?.mech || null;
      const t = G.target;
      G.lock = !!(t && t.alive && len(sub(center(t), G.eye)) < WEAPONS.lrm.range && dot(norm(sub(center(t), G.eye)), G.view) > cos(0.3));

      const armed = P.alive && !G.paused && !G.roundOver;
      P.beamOn = armed && isHeld('energy') && !G.guide;
      fusionTick(P, dt, armed && isHeld('fusion') && !G.guide);
      if (armed && isHeld('ballistic')) fireCat('ballistic');
      missileTrigger(armed && (isHeld('missile') || missileTap));
      missileTap = false;
      if (G.guide) steerVolley(dt);

      for (const m of G.mechs) {
        if (m.remote) {
          if (m.alive) { netInterp(m, dt); gait(m, dt); }
          if (m.alive && m.net?.bm && m.net.be) remoteBeam(m, m.net.be); else m.beaming = false;
          if (m.alive && m.net?.fl) G.cbeams.push({ a: muzzle(m, m.weapons.find(w => w.def.kind === 'fusion')), b: m.net.fl, col: WEAPONS.fusion.col, w: 0.05 + 0.035 * abs(sin(G.time * 37)) });
          continue;
        }
        if (m.team !== 0 && m.alive) think(m, dt);
        if (m.alive) stepMech(m, dt);
        if (m.alive && m.beamOn) beamTick(m, dt, m === P ? G.aim : m.ai.beamAim);
        else m.beaming = false;
        if (m !== P) m.beamOn = false;
      }
      coolArmour(dt);
      beamSound(P.beaming && !G.paused, beamMult(P));
      // Mechs don't walk through each other.
      const alive = G.mechs.filter(m => m.alive);
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j], dx = b.x - a.x, dz = b.z - a.z, d = hypot(dx, dz), r = geoOf(a).radius * a.ch.scale + geoOf(b).radius * b.ch.scale;
        if (d < r && d > 0.01 && !(a.remote && b.remote)) {
          // Only move mechs this client owns; other pilots' clients move theirs.
          const fa = a.remote ? 0 : b.remote ? 1 : 0.5, fb = b.remote ? 0 : a.remote ? 1 : 0.5, gap = r - d;
          a.x -= (dx / d) * gap * fa; a.z -= (dz / d) * gap * fa; b.x += (dx / d) * gap * fb; b.z += (dz / d) * gap * fb;
        }
      }

      for (const s of G.shots) {
        s.life -= dt;
        if (s.kind === 'missile') {
          if (s.guided && G.guide && s.vid === G.guide.vid) {
            // Flown by the pilot: turn hard toward where the camera points.
            const sp = len(s.v);
            s.v = mul(norm(add(norm(s.v), mul(G.guide.dir, dt * 7))), sp);
          } else if (s.target && s.target.alive) {
            const want = norm(sub(center(s.target), s.p)), sp = len(s.v);
            s.v = mul(norm(add(norm(s.v), mul(want, dt * (s.owner === G.player ? 1.7 : 0.9)))), sp);
          }
          s.smoke += dt; s.age += dt;
          // No trail for the first moments: the racks sit beside the cockpit,
          // and smoke that close fills the whole screen.
          if (s.smoke > 0.05 && (s.age > 0.3 || s.owner !== G.player)) { s.smoke = 0; particle(s.p, [rnd(-0.5, 0.5), rnd(0, 1), rnd(-0.5, 0.5)], 0.9, 0.5, [0.55, 0.53, 0.5], 'smoke'); }
        } else s.v[1] -= 6 * dt;
        const stepL = len(s.v) * dt, dir = norm(s.v);
        const hit = rayHit(s.p, dir, stepL, s.owner);
        if (hit) {
          s.life = -1;
          if (hit.mech && !s.ghost) damage(hit.mech, hit.point, s.dmg, s.owner);   // ghosts are other pilots' shots: theirs to score
          if (s.kind === 'missile' && !s.ghost) blast(hit.point, s.dmg, s.owner, hit.mech);
          explode(hit.point, false);
        } else s.p = add(s.p, mul(s.v, dt));
        if (s.life <= 0 && s.kind === 'missile' && !hit) { if (!s.ghost) blast(s.p, s.dmg, s.owner, null); explode(s.p, false); }
      }
      G.shots = G.shots.filter(s => s.life > 0);
      updatePulses(dt);
      for (const b of G.beams) b.life -= dt;
      G.beams = G.beams.filter(b => b.life > 0);
      for (const p of G.parts) {
        p.life -= dt;
        p.v[1] -= p.grav * dt;
        if (p.kind === 'smoke') p.v = mul(p.v, 1 - dt * 0.6);
        p.p = add(p.p, mul(p.v, dt));
        if (p.kind === 'debris') { const g = ter.height(p.p[0], p.p[2]); if (p.p[1] < g) { p.p[1] = g; p.v = [p.v[0] * 0.5, -p.v[1] * 0.35, p.v[2] * 0.5]; } }
        p.spin += dt * 3;
      }
      G.parts = G.parts.filter(p => p.life > 0);
      for (const w of G.wrecks) {
        w.t += dt;
        if (w.t < 30 && random() < dt * 5) particle([w.x + rnd(-2, 2), w.y + 2, w.z + rnd(-2, 2)], [rnd(-0.5, 0.5), rnd(3, 5), rnd(-0.5, 0.5)], rnd(2, 3.5), rnd(1, 2.2), [0.18, 0.17, 0.17], 'smoke');
      }
      for (const m of G.msgs) m.t -= dt;
      G.msgs = G.msgs.filter(m => m.t > 0);
      if (mp()) {
        if (P.spawnT > 0) P.spawnT -= dt;
        if (!P.alive && G.respawnAt && performance.now() >= G.respawnAt) respawn();
        G.hitMark = max(0, (G.hitMark || 0) - dt);
        if ((Net.sendT += dt) >= 1 / SEND_HZ) { Net.sendT = 0; sendState(); flushHits(); }
      }
      G.flash = max(0, G.flash - dt * 1.2);
      G.shake = max(0, G.shake - dt * 2.2);
      G.kick = max(0, G.kick - dt * 5);
      G.whiteFlash = max(0, (G.whiteFlash || 0) - dt * 1.6);

      const live = P.alive && !P.shutdown, pace = min(1, abs(P.speed) / P.ch.speed);
      loopSet('hum_loop', P.alive ? (P.shutdown ? 0.03 : 0.07 + 0.13 * pace) : 0, P.shutdown ? 0.5 : 0.72 + 0.4 * pace);
      const jetting = live && P.jetting && P.fuel > 0;
      loopSet('jet_loop', jetting ? 0.32 : G.guide ? 0.24 : 0, jetting ? 0.85 : G.guide ? 1.7 : 0.85);
      const twistRate = abs(P.twist - G.lastTwist) / max(dt, 1e-3);
      G.lastTwist = P.twist;
      loopSet('servo_loop', live ? min(0.13, twistRate * 0.07) : 0, 0.75 + min(0.6, twistRate * 0.25));

      if (G.state === 'over') {
        G.endT -= dt;
        if (G.endT <= 0) debrief();
      }
    }

    /* ----- lasers: continuous beams whose damage climbs while they stay on target ----- */

    // The ramp lives in the target, not the shooter: a mech's armour "melt"
    // rises while any beam is on it (once per frame, however many beams) and
    // cools whenever nothing is hitting it, whoever is aiming where. Damage is
    // dps x meltMult(target). Two pilots on one mech share its melt.
    const MELT_T = 3;         // seconds of beam to melt armour fully
    const MELT_MAX = 3.5;     // damage multiplier at full melt
    const MELT_COOL = 1.5;    // melt-seconds lost per second off the beam: full to cold in 2 s
    const meltMult = t => 1 + (MELT_MAX - 1) * (t => t * t * (3 - 2 * t))(min(1, t / MELT_T));
    const meltFrac = m => min(1, (m?.melt || 0) / MELT_T);

    // One frame of a mech's lasers firing at `aim`: every live laser draws a
    // beam to whatever it hits and costs heat; a mech it hits takes damage
    // scaled by that mech's melt, and its melt goes up.
    function beamTick(m, dt, aim) {
      const lasers = m.weapons.filter(w => w.def.kind === 'beam' && !w.dead);
      if (!lasers.length || m.shutdown || !m.alive) { m.beaming = false; m.beamMech = null; return; }
      if (!m.beaming) sfx.laser(m === G.player ? null : muzzle(m, lasers[0]), lasers[0].type === 'mlaser');
      m.beaming = true;
      m.beamEnd = aim;
      m.beamMech = null;
      for (const w of lasers) {
        const mz = muzzle(m, w), dir = norm(sub(aim, mz));
        const hit = rayHit(mz, dir, w.def.range, m);
        const end = hit ? hit.point : add(mz, mul(dir, w.def.range));
        const t = hit?.mech, mult = t ? meltMult(t.melt || 0) : 1;
        drawBeam(mz, end, w.def, mult);
        m.heat += w.def.hps * dt;
        if (m === G.player) G.stats.shots += dt * 4;   // accuracy counts beam time in quarter-seconds
        if (!hit) continue;
        if (random() < dt * 25) particle(end, [rnd(-3, 3), rnd(1, 5), rnd(-3, 3)], 0.25, 0.3 + 0.1 * mult, w.def.col, 'fire');
        if (t) {
          m.beamMech = t;
          damage(t, end, w.def.dps * mult * dt, m, true);
          if (t.meltFrame !== G.frame) { t.meltFrame = G.frame; t.melt = min(MELT_T, (t.melt || 0) + dt); }
          t.meltAt = G.time;
          if (m === G.player) G.stats.hits += dt * 4;
        }
      }
    }
    // Armour cools whenever no beam touched it this frame.
    function coolArmour(dt) {
      for (const m of G.mechs) if (m.melt && m.meltAt !== G.time) m.melt = max(0, m.melt - MELT_COOL * dt);
    }
    const beamMult = m => (m.beamMech ? meltMult(m.beamMech.melt || 0) : 1);
    /* ----- fusion cannon: scan the resonant frequency, then dump the reactor into it ----- */

    function fusionTick(m, dt, on) {
      const w = m.weapons.find(w => w.def.kind === 'fusion' && !w.dead);
      const st = m.fusion || (m.fusion = { mech: null, t: 0, on: false, end: null });
      if (!on || !w || w.cd > 0 || m.shutdown || !m.alive) {
        st.on = false; st.t = 0; st.mech = null; st.end = null;
        if (m === G.player) fusionSound(false, 0);
        return;
      }
      st.on = true;
      const d = w.def, mz = muzzle(m, w), dir = norm(sub(G.aim, mz));
      const hit = rayHit(mz, dir, d.range, m);
      // What the laser is on: a direct hit, or a mech it passes within
      // `slack` of (with clear line of sight to it).
      const tgt = hit?.mech || nearMiss(m, mz, dir, d);
      const end = tgt ? center(tgt) : hit ? hit.point : add(mz, mul(dir, d.range));
      st.end = end;
      m.heat += d.scanHeat * dt;
      // A thin, flickering targeting laser, not a weapon beam.
      G.cbeams.push({ a: mz, b: end, col: d.col, w: 0.05 + 0.035 * abs(sin(G.time * 37)) });
      // The scan counts on one mech. A slip shorter than `grace` pauses it;
      // longer, or onto another mech, and it starts over.
      if (tgt && tgt === st.mech) { st.t += dt; st.off = 0; }
      else if (st.mech && !tgt && (st.off = (st.off || 0) + dt) < d.grace) { /* slipping: hold */ }
      else { st.mech = tgt || null; st.t = 0; st.off = 0; }
      st.slipping = !!(st.mech && st.off > 0);
      // Locked and on it: draw the torso gently toward the target.
      if (m === G.player && st.mech && !st.slipping) {
        const c = center(st.mech), e = G.eye, k = 1 - Math.exp(-d.assist * dt);
        const wantTwist = wrapA(atan2(c[0] - e[0], c[2] - e[2]) - m.yaw);
        const wantPitch = atan2(c[1] - e[1], hypot(c[0] - e[0], c[2] - e[2]));
        m.twist = clampN(m.twist + wrapA(wantTwist - m.twist) * k, -1.9, 1.9);
        m.pitch = clampN(m.pitch + (wantPitch - m.pitch) * k, -0.4, 0.45);
      }
      const p = st.mech ? min(1, st.t / d.scan) : 0;
      if (st.mech && random() < dt * (20 + 60 * p)) particle(add(end, [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]), [rnd(-2, 2), rnd(0, 3), rnd(-2, 2)], 0.3, 0.3, w.def.col, 'fire');
      if (m === G.player) fusionSound(true, p);
      if (st.mech && st.t >= w.def.scan) fusionFire(m, w, mz, st.mech, end);
    }

    // The mech the laser passes closest to, if within its radius + slack and
    // nothing (terrain) is in the way.
    function nearMiss(m, mz, dir, d) {
      let best = null, bestD = Infinity;
      for (const t of G.mechs) {
        if (!t.alive || t === m) continue;
        const c = center(t), v = sub(c, mz), along = dot(v, dir);
        if (along < 0 || along > d.range) continue;
        const miss = len(sub(v, mul(dir, along))), lim = geoOf(t).radius * t.ch.scale + d.slack;
        if (miss > lim || miss >= bestD) continue;
        if (rayTerrain(mz, norm(v), len(v) - 1) != null) continue;
        best = t; bestD = miss;
      }
      return best;
    }

    // Fire: launch the pulse down the beam, then the reactor pays for it --
    // feedback into your own torso, a deep overload shutdown, a recharge.
    function fusionFire(m, w, mz, t, end) {
      const d = w.def;
      launchPulse(mz, t, m, false);
      if (mp() && m === G.player) netSend({ t: 'fx', k: 'fu', a: mz.map(r2), id2: t.netId || 0, b: center(t).map(r2) });
      m.heat = d.overload; m.shutdown = true; w.cd = d.cd;
      m.fusion.t = 0; m.fusion.mech = null; m.fusion.on = false;
      if (m === G.player) {
        G.whiteFlash = 0.7; G.shake = 1.2;
        fusionSound(false, 0); sfx.fusionCrack(); sfx.powerdown();
      }
      const cost = m.max.T * d.feedback;
      m.hp.T -= cost;
      if (m === G.player) { G.stats.taken += cost; G.flash = min(0.6, G.flash + 0.4); sfx.clang(); }
      if (m.hp.T <= 0) { m.hp.T = 0; destroy(m, null); return; }
      if (m === G.player) say('Resonance discharge. Reactor overload. Torso damage.', true);
    }

    // The pulse: travels from the muzzle to the target (following it if it
    // moves); kills on arrival. Ghost pulses are other pilots' -- visual only.
    function launchPulse(a, target, shooter, ghost, b) {
      const end = target ? center(target) : b;
      G.pulses.push({ a, b: end, target, shooter, ghost, t: 0, dur: max(0.2, len(sub(end, a)) / WEAPONS.fusion.pulseSpeed), hit: false, seed: random() * 100 });
    }
    function updatePulses(dt) {
      for (const pu of G.pulses) {
        pu.t += dt;
        if (pu.target && pu.target.alive) pu.b = center(pu.target);
        if (pu.hit || pu.t < pu.dur) continue;
        pu.hit = true;
        explode(pu.b, true); explode(add(pu.b, [0, 3, 0]), true);
        for (let i = 0; i < 14; i++) particle(add(pu.b, [rnd(-2, 2), rnd(-3, 3), rnd(-2, 2)]), [rnd(-16, 16), rnd(4, 20), rnd(-16, 16)], rnd(0.5, 1.1), rnd(0.8, 2.2), [0.95, 0.85, 1], 'fire');
        sfx.fusion(pu.b);
        if (pu.ghost || !pu.target || !pu.target.alive) continue;
        // Resonance: the whole frame shakes itself apart, however much armour.
        const t = pu.target;
        if (t.remote) {
          netSend({ t: 'hit', to: t.netId, amt: 40, p: pu.b.map(r2), fu: 1 });
          if (pu.shooter === G.player) { G.stats.hits++; G.hitMark = 0.6; }
        } else { t.hp.T = 0; destroy(t, pu.shooter); }
      }
      G.pulses = G.pulses.filter(pu => pu.t < pu.dur + 0.25);
    }

    // Scan tone: a pulsing whine that climbs as the scan converges.
    let fhum = null;
    function fusionSound(on, p) {
      const c = ac();
      if (!c) { if (fhum) fhum.g.gain.value = 0; return; }
      if (!fhum || fhum.c !== c) {
        const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
        o.type = 'triangle'; lfo.type = 'square'; lg.gain.value = 0; g.gain.value = 0;
        lfo.connect(lg).connect(g.gain); o.connect(g).connect(out());
        o.start(); lfo.start();
        fhum = { c, o, lfo, lg, g };
      }
      const t = c.currentTime;
      fhum.g.gain.setTargetAtTime(on ? 0.04 : 0, t, 0.02);
      fhum.lg.gain.setTargetAtTime(on ? 0.03 : 0, t, 0.02);
      fhum.o.frequency.setTargetAtTime(320 + 1100 * p * p, t, 0.05);
      fhum.lfo.frequency.setTargetAtTime(6 + 22 * p, t, 0.05);
    }

    // Another pilot's beam, drawn from their lasers to where they say it ends.
    // Visual only: their client scores it.
    function remoteBeam(m, end) {
      const lasers = m.weapons.filter(w => w.def.kind === 'beam' && m.hp[w.mount] > 0);
      if (!lasers.length) return;
      if (!m.beaming) sfx.laser(muzzle(m, lasers[0]), false);
      m.beaming = true;
      for (const w of lasers) drawBeam(muzzle(m, w), end, w.def, m.net.bf || 1);   // bf: how melted their target is
      if (random() < 0.4) particle(end, [rnd(-3, 3), rnd(1, 5), rnd(-3, 3)], 0.25, 0.4, lasers[0].def.col, 'fire');
    }

    // Beam damage lands every frame; in the arena it's sent a few times a second.
    function flushHits() {
      for (const [to, q] of G.pendingHits) netSend({ t: 'hit', to, amt: r2(q.amt), p: q.p.map(r2) });
      G.pendingHits.clear();
    }

    // Your lasers' hum: a steady synth tone that climbs in pitch and
    // brightness as the focus multiplier builds -- you hear the beam bite.
    let hum = null;
    function beamSound(on, mult) {
      const c = ac();
      if (!c) { if (hum) hum.g.gain.value = 0; return; }
      if (!hum || hum.c !== c) {
        const o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
        o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.Q.value = 4; g.gain.value = 0;
        o1.connect(f); o2.connect(f); f.connect(g).connect(out());
        o1.start(); o2.start();
        hum = { c, o1, o2, f, g };
      }
      const t = c.currentTime, k = (mult - 1) / (MELT_MAX - 1), base = 150 + 170 * k;
      hum.g.gain.setTargetAtTime(on ? 0.03 + 0.025 * k : 0, t, 0.03);
      hum.o1.frequency.setTargetAtTime(base, t, 0.08);
      hum.o2.frequency.setTargetAtTime(base * 1.505, t, 0.08);
      hum.f.frequency.setTargetAtTime(700 + 2200 * k, t, 0.08);
    }

    // A beam lasts one frame; it's redrawn every frame it's on. Thicker and
    // whiter as the focus climbs.
    function drawBeam(a, b, def, mult) {
      const k = (mult - 1) / (MELT_MAX - 1);
      G.cbeams.push({ a, b, col: mix3(def.col, [1, 1, 1], 0.2 + 0.45 * k), w: def.w * (0.8 + 0.9 * k) * rnd(0.85, 1.15) });
    }

    /* ----- missiles: tap to fire, hold to fly them, let go to detonate ----- */

    const HOLD_TO_GUIDE = 220;   // ms: shorter is a tap
    const BLAST_R = 10;          // metres: a near miss still hurts

    // Called every frame with whether the missile control is held. One volley
    // per press; hold past HOLD_TO_GUIDE and you take over that volley.
    function missileTrigger(down) {
      if (down && !G.mDown) {
        G.mDown = true; G.mAt = performance.now();
        G.mVid = fireCat('missile') ? G.lastVolley : 0;
      } else if (down) {
        if (!G.guide && G.mVid && performance.now() - G.mAt >= HOLD_TO_GUIDE) startGuide(G.mVid);
      } else if (G.mDown) {
        G.mDown = false;
        if (G.guide) endGuide(true);
      }
    }

    const guidedLive = vid => G.shots.filter(s => s.vid === vid && s.owner === G.player && s.life > 0 && !s.ghost);
    const centroid = list => mul(list.reduce((a, s) => add(a, s.p), [0, 0, 0]), 1 / list.length);

    function startGuide(vid) {
      const ms = guidedLive(vid);
      if (!ms.length) return;
      const d = norm(ms[0].v);
      G.guide = { vid, yaw: atan2(d[0], d[2]), pitch: Math.asin(clampN(d[1], -1, 1)), dir: d, pos: centroid(ms), lost: 0, sendT: 0, n: ms.length };
      for (const s of ms) { s.guided = true; s.target = null; s.life = max(s.life, 9); }
      G.zoom = false;
      sfx.beep();
    }

    // Each frame while flying: aim follows input, camera follows the volley.
    function steerVolley(dt) {
      const g = G.guide;
      g.dir = dirOf(g.yaw, g.pitch);
      const ms = guidedLive(g.vid);
      g.n = ms.length;
      if (ms.length) {
        g.pos = centroid(ms); g.fuel = max(...ms.map(s => s.life));
        // The camera rides in the nose of whichever missile is out in front,
        // so the volley and its smoke trail are behind it, not in the shot.
        g.nose = ms.reduce((a, s) => (dot(sub(s.p, g.pos), g.dir) > dot(sub(a.p, g.pos), g.dir) ? s : a)).p;
      }
      else if ((g.lost += dt) > 0.6) { endGuide(false); return; }   // all hit something: "signal lost", then home
      if (mp() && (g.sendT += dt) >= 1 / SEND_HZ && ms.length) { g.sendT = 0; netSend({ t: 'fx', k: 'mg', v: g.vid, p: g.pos.map(r2), d: g.dir.map(r2) }); }
    }
    function steerBy(dx, dy, sens) {
      const g = G.guide;
      g.yaw -= dx * sens;
      g.pitch = clampN(g.pitch - dy * sens * (invertY ? -1 : 1), -1.3, 1.3);
    }

    // Let go: every missile still flying blows up where it is. Then back to the cockpit.
    function endGuide(detonate) {
      const g = G.guide;
      if (!g) return;
      if (detonate) {
        for (const s of guidedLive(g.vid)) { s.life = -1; blast(s.p, s.dmg, s.owner, null); explode(s.p, false); }
        if (mp()) netSend({ t: 'fx', k: 'md', v: g.vid });
      }
      G.guide = null;
    }

    // Splash: anything within BLAST_R takes damage falling off with distance,
    // on the side facing the blast. Not the mech it hit directly (that took
    // the full hit), and never the mech that fired it.
    function blast(p, dmg, owner, direct) {
      for (const m of G.mechs) {
        if (!m.alive || m === owner || m === direct) continue;
        const g = geoOf(m), R = g.radius * m.ch.scale, top = m.y + g.height * m.ch.scale;
        const hx = p[0] - m.x, hz = p[2] - m.z, hd = hypot(hx, hz);
        const dy = p[1] < m.y ? m.y - p[1] : p[1] > top ? p[1] - top : 0;
        const d = hypot(max(0, hd - R), dy);
        if (d >= BLAST_R) continue;
        const nx = hd > 0.01 ? hx / hd : 1, nz = hd > 0.01 ? hz / hd : 0;
        const at = [m.x + nx * R, clampN(p[1], m.y + 1, top - 1), m.z + nz * R];
        damage(m, at, dmg * 0.8 * (1 - d / BLAST_R), owner);
      }
    }

    // Fire every weapon of one kind that's ready; held, each refires as it recharges.
    function fireCat(cat) {
      const P = G.player;
      let any = false;
      for (const w of P.weapons) if (CAT_OF[w.type] === cat) any = fire(P, w, G.aim, G.lock ? G.target : null) || any;
      return any;
    }
    function alpha() {
      const P = G.player;
      for (const w of P.weapons) fire(P, w, G.aim, G.lock ? G.target : null);   // beams skip themselves
    }
    function cycleTarget() {
      const foes = G.mechs.filter(m => m.alive && m.team !== 0)
        .sort((a, b) => hypot(a.x - G.player.x, a.z - G.player.z) - hypot(b.x - G.player.x, b.z - G.player.z));
      if (!foes.length) return;
      const i = foes.indexOf(G.target);
      G.target = foes[(i + 1) % foes.length];
      sfx.beep();
    }

    /* ---------- rendering ---------- */

    let W = 0, H = 0, dpr = 1;
    function resize() {
      dpr = min(devicePixelRatio || 1, 1.5);
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (w === W && h === H) return;
      W = w; H = h;
      cv.width = hud.width = max(1, floor(w * dpr));
      cv.height = hud.height = max(1, floor(h * dpr));
    }

    function drawMech(m, VPtint) {
      const parts = mechParts[m.partsKey], B = frame(m), sc = m.ch.scale;
      const fwd = [sin(m.yaw), 0, cos(m.yaw)];
      // Armour under a beam glows orange as it melts, and runs hotter in IR.
      const mf = meltFrac(m), heatWas = drawHeat;
      const tint = mf ? mix3(VPtint || [1, 1, 1], [2.2, 0.8, 0.25], mf * 0.6) : VPtint || [1, 1, 1];
      if (mf) drawHeat = min(1, drawHeat + mf * 0.3);
      const g = geoOf(m), back = mul(fwd, -1);
      draw(parts.hip, chain(B, M.T(0, g.hip, 0)), tint);
      const hull = M.apply(B, [0, g.hip, 0]);
      // Legs reach for wherever the feet actually are; the knee bends forward,
      // backward (bird legs) or out and up (the quadruped's spider legs).
      m.feet.forEach((f, i) => {
        const leg = g.legs[i];
        const legTint = m.hp[leg.hx > 0 ? 'LL' : 'RL'] > 0 ? tint : mul(tint, 0.35);
        const H = M.apply(B, [leg.hx, g.hip, leg.hz]);
        const pole = g.knee === 'forward' ? fwd : g.knee === 'back' ? back
          : norm(add(norm([H[0] - hull[0], 0, H[2] - hull[2]]), [0, 0.9, 0]));
        const A = add(f.pos, [0, g.ankle * sc, 0]);
        const K = solveKnee(H, A, pole, g.l1 * sc, g.l2 * sc);
        const ankle = add(K, mul(norm(sub(A, K)), g.l2 * sc));   // stays attached even if out of reach
        draw(parts.uleg, limb(H, K, pole, sc), legTint);
        draw(parts.lleg, limb(K, ankle, pole, sc), legTint);
        draw(parts.foot, chain(M.T(...ankle), M.RY(f.yaw), M.S(sc)), legTint);
      });
      const TB = chain(B, M.T(0, g.torsoY, 0), M.RY(m.twist));
      draw(parts.torso, TB, tint);
      for (const [s, k] of [[1, 'LA'], [-1, 'RA']]) {
        if (m.hp[k] <= 0) continue;
        draw(parts.arm, chain(TB, M.T(s * g.armX, g.armY, 0), M.RX(-m.pitch)), tint);
      }
      drawHeat = heatWas;
    }

    function render() {
      resize();
      if (!ter) return;
      gl.viewport(0, 0, cv.width, cv.height);
      const P = G.player, gd = G.guide, ir = !!gd;
      const IR_ZEN = [0.03, 0.03, 0.03], IR_HOR = [0.1, 0.1, 0.1];
      const hor = ir ? IR_HOR : pal.hor;
      gl.clearColor(hor[0], hor[1], hor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let fov, yaw, pitch, eye, dir;
      if (G.state === 'menu') {
        // The main menu's mech: camera in front, aimed left of it so the mech
        // stands in the right-hand part of the screen beside the menu panel.
        // Pulled back a touch more on short screens, and framed so the mech
        // stands above the mech selector in the bottom-right corner.
        const sc = P.ch.scale, R = (15 * sc + 4) * (H < 500 ? 1.45 : 1.2), aspect = W / max(1, H);
        fov = 0.75;
        const c = [P.x, P.y + 4 * sc, P.z];
        eye = [c[0], c[1] + 1.6, c[2] + R];
        const off = aspect > 1 ? 0.4 * R * Math.tan(fov / 2) * aspect : 0;
        dir = norm(sub([c[0] - off, c[1] - (H < 500 ? 2.6 : 1.6), c[2]], eye));
        yaw = atan2(dir[0], dir[2]); pitch = Math.asin(clampN(dir[1], -1, 1));
      } else if (gd) {
        // Riding just behind the volley, looking where it's going.
        fov = 0.95; yaw = gd.yaw; pitch = gd.pitch; dir = gd.dir;
        eye = add(gd.nose || gd.pos, add(mul(dir, 1.5), [0, 0.3, 0]));
      } else {
        fov = G.zoom ? 0.42 : 1.08;
        const sh = G.shake * 0.012;
        yaw = viewYaw(P) + rnd(-sh, sh); pitch = P.pitch + rnd(-sh, sh) - (P.alive ? 0 : 0.15);
        eye = add(G.eye, [0, -G.kick * 0.35, 0]); dir = dirOf(yaw, pitch - G.kick * 0.016);
      }
      G.ear = eye; G.earYaw = yaw;   // sounds are heard from the camera
      const proj = M.persp(fov, W / max(1, H), 0.5, 1800);
      const VP = M.mul(proj, M.lookAt(eye, add(eye, dir)));
      G.VP = VP;

      // Sky.
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(skyProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      const ap = gl.getAttribLocation(skyProg, 'aP');
      gl.enableVertexAttribArray(ap);
      gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(SU.zen, ir ? IR_ZEN : pal.zen); gl.uniform3fv(SU.hor, hor);
      gl.uniform1f(SU.h, 0.5 - 0.5 * Math.tan(pitch) / Math.tan(fov / 2)); gl.uniform1f(SU.res, cv.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(ap);

      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(prog);
      curMesh = null;
      [A.pos, A.nrm, A.col].forEach(a => gl.enableVertexAttribArray(a));
      gl.uniformMatrix4fv(U.VP, false, VP);
      gl.uniform3fv(U.light, pal.light);
      gl.uniform3fv(U.cam, eye);
      gl.uniform2f(U.fog, pal.fog[0], pal.fog[1]);
      gl.uniform3fv(U.fogCol, hor);
      gl.uniform1f(U.ir, ir ? 1 : 0);

      drawHeat = 0;
      draw(world, M.id());
      // In the missile camera your own mech is out there too.
      drawHeat = 1;
      for (const m of G.mechs) if (m.alive && (m !== P || gd || G.state === 'menu')) drawMech(m);
      drawHeat = 0.45;
      for (const w of G.wrecks) {
        const parts = mechParts[w.type], B = chain(M.T(w.x, w.y, w.z), M.RY(w.yaw), M.S(w.scale));
        const dark = [0.3, 0.28, 0.27];
        draw(parts.torso, chain(B, M.T(0, 1.3, -1), M.RX(-1.2), M.RZ(w.roll)), dark);
        draw(parts.hip, chain(B, M.T(0.5, 0.6, 1.5), M.RY(0.6)), dark);
        draw(parts.uleg, chain(B, M.T(2.5, 0.6, 1), M.RZ(1.5)), dark);
        draw(parts.lleg, chain(B, M.T(-2.6, 0.5, -0.5), M.RZ(-1.5), M.RY(1)), dark);
      }
      drawHeat = 1;
      for (const s of G.shots) {
        // The nose camera can't see its own volley flying alongside it.
        if (gd && s.guided && len(sub(s.p, eye)) < 8) continue;
        const d = norm(s.v), yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1));
        if (s.kind === 'shell') draw(meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.25, 0.25, 2.2)), [1, 0.85, 0.4], 1);
        else draw(meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.35, 0.35, 1.2)), [1, 0.55, 0.25], 1);
      }
      // Fusion pulses: six sine waves, each in its own plane with its own
      // frequency and phase, writhing inside a packet that races down the
      // beam; the straight targeting beam stays lit underneath while it flies.
      for (const pu of G.pulses) {
        const v = sub(pu.b, pu.a), L = len(v), d = mul(v, 1 / (L || 1));
        const u = norm(cross(d, abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), w2 = cross(u, d);
        const yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1));
        if (!pu.hit) draw(meshes.beam, chain(M.T(...pu.a), M.RY(yw), M.RX(-pt), M.S(0.05, 0.05, L)), [0.85, 0.6, 1], 1);
        const head = min(1, pu.t / pu.dur) * L, pack = min(L, 34), fade = pu.hit ? max(0, 1 - (pu.t - pu.dur) / 0.25) : 1;
        if (fade <= 0) continue;
        const N = 28, tt = performance.now() / 1000;
        for (let k = 0; k < 6; k++) {
          const th = k * PI / 3 + pu.seed, amp = (0.9 + 0.3 * k) * fade, f = 0.22 + 0.09 * k, ph = pu.seed * (k + 1) + tt * (18 + 3 * k);
          const dirk = add(mul(u, cos(th)), mul(w2, sin(th)));
          let prev = null;
          for (let i = 0; i <= N; i++) {
            const sAlong = head - pack + (pack * i) / N;
            if (sAlong < 0) { prev = null; continue; }
            const env = sin(PI * i / N);   // the packet swells in the middle and tapers at both ends
            const q = add(add(pu.a, mul(d, sAlong)), mul(dirk, amp * env * sin(TAU * f * sAlong + ph)));
            if (prev) {
              const sv = sub(q, prev), sl = len(sv), sd = mul(sv, 1 / (sl || 1));
              draw(meshes.beam, chain(M.T(...prev), M.RY(atan2(sd[0], sd[2])), M.RX(-Math.asin(clampN(sd[1], -1, 1))), M.S(0.22, 0.22, sl)),
                mix3([1, 1, 1], [0.8, 0.55, 1], k / 8), 1);
            }
            prev = q;
          }
        }
      }
      for (const b of G.cbeams) {
        const v = sub(b.b, b.a), l = len(v), d = mul(v, 1 / (l || 1));
        draw(meshes.beam, chain(M.T(...b.a), M.RY(atan2(d[0], d[2])), M.RX(-Math.asin(clampN(d[1], -1, 1))), M.S(b.w, b.w, l)), b.col, 1);
      }
      for (const b of G.beams) {
        const v = sub(b.b, b.a), l = len(v), d = mul(v, 1 / (l || 1));
        const f = b.life / b.max;
        draw(meshes.beam, chain(M.T(...b.a), M.RY(atan2(d[0], d[2])), M.RX(-Math.asin(clampN(d[1], -1, 1))), M.S(b.w * (0.6 + f), b.w * (0.6 + f), l)),
          mix3([1, 1, 1], b.col, 0.4 + 0.6 * (1 - f)), 1);
      }
      for (const p of G.parts) {
        const f = p.life / p.max;
        let size = p.size, tint = p.col, emis = 1;
        if (p.kind === 'fire') { size *= 0.4 + f * 0.8; tint = mix3([0.4, 0.1, 0.05], p.col, f); }
        else if (p.kind === 'smoke') { size *= 1.6 - f * 0.8; tint = mix3(pal.hor, p.col, f); emis = 0.6; }
        else emis = 0;
        draw(meshes.cube, chain(M.T(...p.p), M.RY(p.spin), M.RX(p.spin * 0.7), M.S(size)), tint, emis, p.kind === 'fire' ? f : p.kind === 'smoke' ? 0.15 : 0.3);
      }
      [A.pos, A.nrm, A.col].forEach(a => gl.disableVertexAttribArray(a));

      drawHUD();
    }

    /* ---------- HUD ---------- */

    const project = p => {
      const v = G.VP, x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12], y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
      const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
      if (w <= 0.1) return null;
      return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H];
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
        const dash = min(150, H * 0.27), top = H - dash + 8, u = min(7, dash / 12);
        return {
          frame: true, dash, viewBottom: H - dash,
          radar: { x: W / 2, y: H - dash / 2 + 4, r: dash * 0.4 },
          bars: { x: W * 0.1 + 6, y: top, h: dash - 30 },
          diag: { x: W * 0.1 + 34 + 3.2 * u, y: top + 6, u },
          weapons: { x: W * 0.62, y: top + 4 },
          throttle: { x: W * 0.9 - 26, y: top, h: dash - 30 },
          target: { x: W * 0.1 + 8, y: 48 },
          hostiles: { x: W * 0.965 - 10, y: 20 },
        };
      }
      const r = clampN(H * 0.12, 30, 46), u = 5;
      return {
        frame: false, dash: 0, viewBottom: H,
        radar: { x: W - r - 14, y: r + 12, r },
        bars: { x: 64, y: 112, h: 70 },
        diag: { x: 100 + 3.2 * u, y: 116, u },
        weapons: { x: W - 205, y: 2 * r + 34 },
        throttle: { x: 14, y: H - 196, h: 120 },
        target: { x: 132, y: 10 },   // right of the pause and zoom buttons
        hostiles: { x: W - 14, y: 2 * r + 34 + 56 },   // under the weapon list, clear of the compass
      };
    }

    const arenaBoard = () => [...Net.info.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const boardHTML = () => `<table class="mech-keys scoreboard">${arenaBoard().map((p, i) => `<tr${p.id === Net.id ? ' class="me"' : ''}>
      <td>${i + 1}.</td><td><span class="dot" style="background:${MP_COLORS[p.color]?.css}"></span>${esc(p.name)}</td><td>${p.kills} / ${p.deaths}</td></tr>`).join('')}</table>`;

    // Scoreboard, death / respawn, spawn shield, and the round banner.
    function drawArenaHUD(L) {
      const P = G.player;
      const board = arenaBoard();
      let y = L.hostiles.y + 14;
      const x = L.hostiles.x;
      ctx.textAlign = 'right';
      if (G.touchUI) {
        // Phones: one line -- the full board would sit under the fire buttons.
        // (It's in the menu.)
        const rank = board.findIndex(p => p.id === Net.id) + 1, me = Net.info.get(Net.id), lead = board[0];
        ctx.fillStyle = AMBER;
        ctx.fillText(`#${rank} ${me ? `${me.kills}/${me.deaths}` : ''}${lead && lead.id !== Net.id ? `  LEAD ${lead.name} ${lead.kills}` : ''}`, x, y);
      } else for (const p of board) {
        ctx.fillStyle = p.id === Net.id ? AMBER : GREEN;
        ctx.fillText(`${p.name.padEnd(12)} ${String(p.kills).padStart(2)}/${p.deaths}`, x, y);
        ctx.fillStyle = MP_COLORS[p.color]?.css || GREEN;
        ctx.fillRect(x - 128, y - 4, 8, 8);
        y += 14;
      }
      ctx.textAlign = 'center';
      const mid = L.viewBottom * 0.5;
      if (!P.alive) {
        ctx.font = 'bold 22px "Lucida Console", monospace'; ctx.fillStyle = RED;
        ctx.fillText(G.killer ? `DESTROYED BY ${pilotName(G.killer)}` : 'MECH DESTROYED', W / 2, mid);
        ctx.font = '14px "Lucida Console", monospace'; ctx.fillStyle = AMBER;
        ctx.fillText(`RESPAWN IN ${Math.ceil(max(0, (G.respawnAt - performance.now()) / 1000))}`, W / 2, mid + 26);
      } else if (P.spawnT > 0) {
        ctx.font = '13px "Lucida Console", monospace'; ctx.fillStyle = '#3cf';
        ctx.fillText('SHIELDED', W / 2, mid + 40);
      }
      if (G.roundOver && G.banner) {
        ctx.font = 'bold 24px "Arial Black", Arial, sans-serif'; ctx.fillStyle = AMBER;
        ctx.fillText(G.banner.text, W / 2, L.viewBottom * 0.37);
        ctx.font = '13px "Lucida Console", monospace'; ctx.fillStyle = GREEN;
        ctx.fillText(`NEXT ROUND IN ${Math.ceil(max(0, (G.banner.until - performance.now()) / 1000))}`, W / 2, L.viewBottom * 0.37 + 24);
      }
      ctx.font = '11px "Lucida Console", monospace';
    }

    // The missile camera: an IR feed, not the cockpit -- scanlines, static,
    // vignette, a reticle, hot targets boxed with their range, and telemetry.
    function drawGuideHUD() {
      const g = G.guide, WHITE = 'rgba(255,255,255,0.9)';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      for (let i = 0; i < 180; i++) ctx.fillRect(random() * W, random() * H, 1 + random() * 2, 1);
      const band = (G.time * 90) % (H + 60) - 30;   // a slow rolling interference band
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(0, band, W, 18);
      const vg = ctx.createRadialGradient(W / 2, H / 2, min(W, H) * 0.25, W / 2, H / 2, max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.8)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2;
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
        if (!q || q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) continue;
        const k = clampN(900 / max(r, 1), 8, 40);
        ctx.strokeStyle = WHITE; ctx.strokeRect(q[0] - k, q[1] - k * 1.3, k * 2, k * 2.6);
        ctx.fillStyle = WHITE; ctx.textAlign = 'center';
        ctx.fillText(`${m.remote ? pilotName(m.netId) : m.ch.name} ${Math.round(r)}m`, q[0], q[1] - k * 1.3 - 9);
      }

      ctx.fillStyle = WHITE; ctx.textAlign = 'left';
      const lx = G.touchUI ? 70 : 20;
      ctx.fillText('MSL CAM   IR / WHT-HOT', lx, 22);
      ctx.fillText(`LRM ${g.n}/${WEAPONS.lrm.count}`, lx, 38);
      ctx.textAlign = 'right';
      const rx = G.touchUI ? W - 120 : W - 20;
      ctx.fillText(`ALT ${Math.round(g.pos[1] - ter.height(g.pos[0], g.pos[2]))}m`, rx, 22);
      ctx.fillText(nearest < Infinity ? `TGT ${Math.round(nearest)}m` : 'TGT ---', rx, 38);
      ctx.fillText(`FUEL ${max(0, g.fuel || 0).toFixed(1)}s`, rx, 54);
      ctx.textAlign = 'center';
      if (g.lost > 0 || !g.n) {
        ctx.font = 'bold 20px "Lucida Console", monospace'; ctx.fillText('SIGNAL LOST', cx, cy - 60);
      } else {
        ctx.fillText(G.touchUI ? 'DRAG TO STEER  ·  LIFT TO DETONATE' : 'STEER WITH THE MOUSE  ·  RELEASE TO DETONATE', cx, G.touchUI ? 66 : H - 24);
      }
    }

    function drawHUD() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
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
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.035, 0); ctx.lineTo(W * 0.1, H - dash); ctx.lineTo(0, H - dash * 0.6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W * 0.965, 0); ctx.lineTo(W * 0.9, H - dash); ctx.lineTo(W, H - dash * 0.6); ctx.fill();
      const g = ctx.createLinearGradient(0, H - dash, 0, H);
      g.addColorStop(0, '#2a2d30'); g.addColorStop(0.08, '#1a1c1e'); g.addColorStop(1, '#0b0c0d');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H - dash * 0.6); ctx.lineTo(W * 0.1, H - dash); ctx.lineTo(W * 0.9, H - dash); ctx.lineTo(W, H - dash * 0.6); ctx.lineTo(W, H); ctx.fill();
      }

      // Damage flash.
      if (G.flash > 0) { ctx.fillStyle = `rgba(255,40,20,${G.flash * 0.4})`; ctx.fillRect(0, 0, W, H); }
      if (G.whiteFlash > 0) { ctx.fillStyle = `rgba(235,215,255,${G.whiteFlash * 0.85})`; ctx.fillRect(0, 0, W, H); }

      // Crosshair.
      const ch = project(G.aim) || [W / 2, H / 2];
      ctx.strokeStyle = G.aimMech ? RED : GREEN;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(ch[0] + dx * 5, ch[1] + dy * 5); ctx.lineTo(ch[0] + dx * 14, ch[1] + dy * 14); }
      ctx.stroke();
      ctx.strokeRect(ch[0] - 1, ch[1] - 1, 2, 2);
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
        ctx.fillText(`RESONANCE SCAN -- ${pilotName(G.scanWarn.by)} ${Math.floor(G.scanWarn.p * 100)}%`, W / 2, L.viewBottom * 0.22);
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
          ctx.fillText(G.lock ? 'LOCK' : t.remote ? pilotName(t.netId) : t.ch.name, a[0], y0 - 8);
        }
      }
      // Enemy markers in view (small chevrons), so far-off mechs can be found.
      for (const m of G.mechs) {
        if (!m.alive || m.team === 0 || m === t) continue;
        const p = project([m.x, m.y + 9 * m.ch.scale, m.z]);
        if (!p || p[1] > L.viewBottom) continue;
        ctx.fillStyle = m.remote ? pilotCss(m.netId) : RED;
        ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1] - 6); ctx.lineTo(p[0] + 4, p[1] - 6); ctx.lineTo(p[0], p[1]); ctx.fill();
        if (m.remote) { ctx.textAlign = 'center'; ctx.fillText(pilotName(m.netId), p[0], p[1] - 14); }
      }

      // Compass tape: torso heading, with a mark for where the legs point.
      const tw = min(340, W * 0.5), tx = W / 2 - tw / 2, ty = 10;
      ctx.fillStyle = 'rgba(0,20,0,.55)'; ctx.fillRect(tx, ty, tw, 26);
      ctx.strokeStyle = DIM; ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 25);
      const hdg = ((-viewYaw(P) * 180 / PI) % 360 + 360) % 360;
      ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, 26); ctx.clip();
      ctx.textAlign = 'center'; ctx.fillStyle = GREEN; ctx.strokeStyle = GREEN;
      const pxPerDeg = tw / 120;
      for (let dgr = floor((hdg - 70) / 10) * 10; dgr <= hdg + 70; dgr += 10) {
        const x = W / 2 + (dgr - hdg) * pxPerDeg, d = ((dgr % 360) + 360) % 360;
        ctx.beginPath(); ctx.moveTo(x, ty + 18); ctx.lineTo(x, ty + (d % 30 ? 22 : 15)); ctx.stroke();
        if (d % 30 === 0) ctx.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10).padStart(2, '0'), x, ty + 8);
      }
      ctx.restore();
      ctx.fillStyle = AMBER;
      ctx.beginPath(); ctx.moveTo(W / 2, ty + 26); ctx.lineTo(W / 2 - 5, ty + 32); ctx.lineTo(W / 2 + 5, ty + 32); ctx.fill();
      const legX = W / 2 + clampN(P.twist * 180 / PI, -60, 60) * pxPerDeg;
      ctx.fillStyle = GREEN; ctx.fillRect(legX - 6, ty + 34, 12, 3);
      ctx.fillStyle = DIM; ctx.textAlign = 'left'; ctx.fillText('LEGS', legX + 9, ty + 36);

      // Radar.
      const { x: rx, y: ry, r: rr } = L.radar;
      ctx.fillStyle = '#031203'; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.fill();
      ctx.strokeStyle = DIM; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(rx, ry, rr / 2, 0, TAU); ctx.stroke();
      const vy = viewYaw(P), half = (G.zoom ? 0.42 : 1.08) * (W / max(1, H)) / 2;
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - sin(half) * rr, ry - cos(half) * rr);
      ctx.moveTo(rx, ry); ctx.lineTo(rx + sin(half) * rr, ry - cos(half) * rr); ctx.stroke();
      const RANGE = 800;
      for (const m of G.mechs) {
        if (!m.alive || m === P) continue;
        const dx = m.x - P.x, dz = m.z - P.z, d = hypot(dx, dz);
        if (d > RANGE) continue;
        const ang = atan2(dx, dz) - vy;
        const px = rx - sin(ang) * (d / RANGE) * rr, py = ry - cos(ang) * (d / RANGE) * rr;
        ctx.fillStyle = m === t ? AMBER : m.remote ? pilotCss(m.netId) : RED;
        ctx.fillRect(px - 2, py - 2, m === t ? 5 : 4, m === t ? 5 : 4);
      }
      ctx.fillStyle = GREEN; ctx.fillRect(rx - 1, ry - 1, 3, 3);
      ctx.fillStyle = DIM; ctx.textAlign = 'center'; ctx.fillText(`${RANGE}m`, rx, ry + rr + 9 > H ? ry + rr - 8 : ry + rr + 8);

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
        const live = ws.filter(w => !w.dead), firingNow = isHeld(cat);
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
        ctx.fillText(`TGT ${t.remote ? pilotName(t.netId) : t.ch.name}`, px + 6, py + 10);
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
        ctx.fillStyle = m.col; ctx.fillText(m.text, W / 2, my); my += 15;
      }
      ctx.globalAlpha = 1;
      if (P.shutdown) {
        ctx.font = 'bold 22px "Lucida Console", monospace';
        ctx.fillStyle = floor(G.time * 3) % 2 ? RED : AMBER;
        ctx.fillText('REACTOR SHUTDOWN', W / 2, L.viewBottom * 0.4);
      }
      if (G.zoom) { ctx.font = '11px "Lucida Console", monospace'; ctx.fillStyle = GREEN; ctx.fillText('ZOOM 2.5x', W / 2, L.viewBottom - (L.frame ? 10 : 24)); }
      const left = G.mechs.filter(m => m.alive && m.team !== 0).length;
      ctx.font = '11px "Lucida Console", monospace'; ctx.textAlign = 'right'; ctx.fillStyle = DIM;
      ctx.fillText(mp() ? `PILOTS ${Net.info.size}  FIRST TO ${Net.limit}` : `HOSTILES ${left}`, L.hostiles.x, L.hostiles.y);
      if (mp()) drawArenaHUD(L);
      // Phones held upright get a cramped, stretched view.
      if (G.touchUI && H > W) {
        ctx.font = 'bold 16px "Lucida Console", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = AMBER;
        ctx.fillText('TURN YOUR DEVICE SIDEWAYS', W / 2, H * 0.3);
      }
    }

    /* ---------- screens ---------- */

    const TOUCH_CONTROLS = `
      <table class="mech-keys">
        <tr><td>Left side</td><td>drag: sideways turns the legs, up / down sets the throttle (it stays set)</td></tr>
        <tr><td>Right side</td><td>drag: twist the torso and aim</td></tr>
        <tr><td>ENERGY (hold)</td><td>laser beams: damage climbs the longer you hold them on one target -- watch your heat</td></tr>
        <tr><td>FUSION (hold)</td><td>keep the scan on a mech for 3 s (drag the button to aim; brief slips are forgiven): it dies outright -- and the feedback hurts your own torso and shuts your reactor down</td></tr>
        <tr><td>BALLISTIC (hold)</td><td>autocannon: big single hits, little heat, limited ammo</td></tr>
        <tr><td>MISSILE</td><td>tap: fire the LRMs (they home in on a locked target)<br>hold: fly them yourself in IR -- drag to steer, let go to detonate</td></tr>
        <tr><td>TGT</td><td>next target</td></tr>
        <tr><td>JUMP (hold)</td><td>jump jets</td></tr>
        <tr><td>ZOOM / STOP / II</td><td>zoom, full stop, pause</td></tr>
      </table>`;
    const controls = () => (G.touchUI ? TOUCH_CONTROLS : CONTROLS);
    const CONTROLS = `
      <table class="mech-keys">
        <tr><td>W / S</td><td>throttle up / down (it stays set)</td><td>X</td><td>full stop</td></tr>
        <tr><td>A / D</td><td>turn legs</td><td>Mouse</td><td>twist torso &amp; aim</td></tr>
        <tr><td>Left mouse / 1</td><td>laser beams (hold on target: damage climbs, so does heat)</td><td>Right mouse / 2</td><td>autocannon (big hits)</td></tr>
        <tr><td>G / 4 (hold)</td><td>fusion cannon: scan one mech for 3 s -- it dies; the feedback hurts your torso and shuts you down</td><td></td><td></td></tr>
        <tr><td>Space / 3</td><td>tap: fire missiles &middot; hold: fly them, release to detonate</td><td>F</td><td>fire everything</td></tr>
        <tr><td>T</td><td>next target</td><td></td><td></td></tr>
        <tr><td>R</td><td>target under crosshair</td><td>J (hold)</td><td>jump jets</td></tr>
        <tr><td>C</td><td>centre torso on legs</td><td>Z</td><td>zoom</td></tr>
        <tr><td>Arrows</td><td>twist / aim without mouse</td><td>P / Esc</td><td>pause</td></tr>
      </table>`;

    const OPTS = {
      sound: ['SOUND', () => settings.sound, v => { settings.sound = v; store.set('sound', v); }],
      voice: ['VOICE', () => voiceOn, v => { voiceOn = v; store.set('mech.voice', v); }],
      invert: ['INVERT AIM', () => invertY, v => { invertY = v; store.set('mech.invert', v); }],
    };
    const optLabel = k => `${OPTS[k][0]}: ${OPTS[k][1]() ? 'ON' : 'OFF'}`;
    const options = () => `<div class="opts">${Object.keys(OPTS).map(k => `<button class="opt" data-opt="${k}">${optLabel(k)}</button>`).join('')}
      <button class="opt" data-a="full">FULL SCREEN</button></div>`;

    function showOverlay(html, cls = '') { ov.innerHTML = html; ov.className = 'mech-overlay' + (cls ? ' ' + cls : ''); ov.hidden = false; }
    function hideOverlay() { ov.hidden = true; ov.className = 'mech-overlay'; }

    /* ----- the main menu: Campaign / Free Play / Multiplayer / Settings, and your mech ----- */

    const MENU = [['campaign', 'CAMPAIGN'], ['free', 'FREE PLAY'], ['mp', 'MULTIPLAYER'], ['settings', 'SETTINGS']];

    function mainMenu(sel = menuSel, status = '') {
      if (Net.ws) { const ws = Net.ws; Net.ws = null; ws.close(); }
      G.mode = 'sp'; G.state = 'menu'; G.paused = false; G.guide = null;
      menuSel = sel; store.set('menu.sel', sel);
      syncTouchUI(); exitLock();
      // The backdrop: a quiet patch of desert, with your mech standing in it.
      if (G.worldKind !== 'menu') {
        G.worldKind = 'menu';
        pal = PALS.dusk;
        ter = makeTerrain(3);
        if (world) gl.deleteBuffer(world.buf);
        world = upload(buildTerrainMesh(ter, pal, 3));
      }
      G.shots = []; G.beams = []; G.cbeams = []; G.parts = []; G.wrecks = []; G.msgs = [];
      showMech();
      renderMenu(status);
    }
    // The mech on show: multiplayer shows it in your arena colour.
    function showMech() {
      const key = menuSel === 'mp' ? partsKeyFor(mpColor, chassis) : chassis;
      G.player = newMech(chassis, 0, 0, 0, 0, { partsKey: key });
      G.mechs = [G.player];
      menuTick(0);
    }
    function menuTick(dt) {
      const m = G.player, t = performance.now() / 1000;
      if (!m) return;
      if (!G.menuDrag) G.showYaw = (G.showYaw ?? 2.6) + dt * 0.35;
      m.yaw = G.showYaw; m.twist = sin(t * 0.6) * 0.3; m.pitch = sin(t * 0.4) * 0.08;
      initFeet(m);
      m.bob = sin(t * 1.7) * 0.06;   // idling: a slow breath
    }

    function menuDetail(status) {
      if (menuSel === 'campaign') {
        const d = missionDef(missionN), p = PALS[d.pal];
        const counts = d.foes.reduce((a, f) => ((a[f] = (a[f] || 0) + 1), a), {});
        return `<div class="k">MISSION ${missionN + 1}: ${esc(d.name.toUpperCase())}</div>
          <p>${esc(d.intel)}</p>
          <p class="dim">${esc(p.name.toUpperCase())} · ${Object.entries(counts).map(([k, n]) => `${n}x ${CHASSIS[k].name}`).join(', ')}</p>
          ${missionN > 0 ? '<button class="opt" data-a="restart">RESTART CAMPAIGN</button>' : ''}`;
      }
      if (menuSel === 'free') {
        const mapName = FP_MAPS[fpMap] === 'random' ? 'RANDOM' : PALS[FP_MAPS[fpMap]].name.toUpperCase();
        return `<p>One battle, your rules.</p>
          <div class="mm-pick"><span>MAP</span><button data-fp="map" data-d="-1">◀</button><b>${mapName}</b><button data-fp="map" data-d="1">▶</button></div>
          <div class="mm-pick"><span>HOSTILES</span><button data-fp="foes" data-d="-1">◀</button><b>${fpFoes}</b><button data-fp="foes" data-d="1">▶</button></div>`;
      }
      if (menuSel === 'mp') {
        return `<p>Free-for-all for up to 8 pilots on this network. First to ${Net.limit} kills wins the round.</p>
          <p class="lobby-row"><label for="callsign">CALLSIGN</label>
            <input id="callsign" class="callsign" maxlength="12" value="${esc(mpName)}" placeholder="PILOT"
              autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="go"></p>
          <div class="swatches">${MP_COLORS.map((c, i) => `<button class="swatch${i === mpColor ? ' on' : ''}" data-col="${i}"
            style="background:${c.css}" aria-label="${c.name}" title="${c.name}"></button>`).join('')}</div>
          <p class="status k">${esc(status)}</p>`;
      }
      return `${options()}
        <div class="mm-controls">${controls()}</div>
        <p class="credits">Original game, raw WebGL. Sound effects by <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a> (CC0).
          The cockpit voice is your browser's speech engine.</p>`;
    }

    function renderMenu(status = '') {
      const ch = CHASSIS[chassis], info = MECH_INFO[chassis];
      const hpSum = c => Object.values(CHASSIS[c].hp).reduce((a, v) => a + v, 0);
      const maxHp = max(...MECH_ORDER.map(hpSum)), maxSpeed = max(...MECH_ORDER.map(c => CHASSIS[c].speed));
      const bar = (label, f) => `<span>${label}</span><i><b style="width:${Math.round(f * 100)}%"></b></i>`;
      const launchLabel = { campaign: 'LAUNCH', free: 'LAUNCH', mp: 'JOIN ARENA' }[menuSel];
      showOverlay(`
        <div class="mm">
          <div class="mm-left">
            <div class="mm-title">STOMPY</div>
            <nav class="mm-items">${MENU.map(([k, label]) => `<button class="mm-item${k === menuSel ? ' on' : ''}" data-sel="${k}">${label}</button>`).join('')}</nav>
            <div class="mm-detail">${menuDetail(status)}</div>
            ${launchLabel ? `<button class="mm-launch" data-a="go">${launchLabel}</button>` : ''}
          </div>
          <div class="mm-right">
            <div class="mm-select">
              <div class="mm-label">SELECT MECH</div>
              <div class="mm-mech"><button data-mech="-1" aria-label="Previous mech">◀</button><span>${ch.name}</span><button data-mech="1" aria-label="Next mech">▶</button></div>
              <div class="mm-role">${info.role}</div>
              <div class="mm-kit">${info.kit}</div>
              <div class="mm-stats">${bar('SPEED', ch.speed / maxSpeed)}${bar('ARMOR', hpSum(chassis) / maxHp)}${bar('FIREPOWER', info.fire)}</div>
            </div>
          </div>
        </div>`, 'menu');
    }

    function go() {
      if (menuSel === 'campaign') { startMission(missionN); launch(); }
      else if (menuSel === 'free') { startSkirmish(); launch(); }
      else if (menuSel === 'mp') join();
    }

    function launch() {
      hideOverlay();
      wrap.focus();
      G.state = 'play'; G.paused = false;
      syncTouchUI();
      // On a phone, go full screen and sideways where the browser allows it.
      if (G.touchUI && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' })
          .then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      }
      Sound.unlock();
      loadSamples();
      lockPointer();
      syncWeaponButtons();
      say(G.kind === 'campaign' ? `Mission ${missionN + 1}. ${G.def.name}. Systems online.` : 'Free play. Systems online.', true);
    }

    function debrief() {
      G.state = 'debrief';
      syncTouchUI();
      exitLock();
      const s = G.stats, acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
      const tm = `${floor(G.time / 60)}:${String(floor(G.time % 60)).padStart(2, '0')}`;
      const camp = G.kind === 'campaign';
      if (G.won && camp) store.set('mech.mission', max(store.get('mech.mission', 0), missionN + 1));
      showOverlay(`
        <h1 style="color:${G.won ? '#5f5' : '#f44'}">${G.won ? 'MISSION COMPLETE' : 'MECH DESTROYED'}</h1>
        <div class="panel">
          <div class="k">${camp ? `MISSION ${missionN + 1}: ${esc(G.def.name.toUpperCase())}` : 'FREE PLAY'}</div>
          <p>TIME ${tm}<br>KILLS ${s.kills} / ${G.def.foes.length}<br>
             ACCURACY ${acc}% (${Math.round(s.hits)} of ${Math.round(s.shots)})<br>
             DAMAGE DEALT ${Math.round(s.dealt)} &nbsp; TAKEN ${Math.round(s.taken)}</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          ${camp && G.won ? '<button class="go" data-a="next">NEXT MISSION</button>' : ''}
          ${camp ? `<button class="go" data-a="retry">${G.won ? 'REPLAY' : 'RETRY'}</button>` : '<button class="go" data-a="again">PLAY AGAIN</button>'}
          <button class="go" data-a="menu">MAIN MENU</button>
        </div>`);
    }

    function pause(on) {
      if (G.state !== 'play') return;
      G.paused = on;
      clearHeld();
      if (on) {
        for (const k in keys) keys[k] = false;
        endGuide(true); G.mDown = false;
        exitLock();   // give the cursor back, or nothing outside the game can be clicked
        syncTouchUI();
        showOverlay(`<h1>${mp() ? 'MENU' : 'PAUSED'}</h1>
          <div class="panel" style="text-align:center">${mp() ? 'The match keeps going while you are in here. Tap or click to get back in.' : 'Click to resume.'}</div>
          ${mp() ? `<div class="panel"><div class="k">SCORES &mdash; FIRST TO ${Net.limit}</div>${boardHTML()}</div>` : ''}
          <div class="panel">${controls()}</div>${options()}
          ${mp() ? '<button class="go" data-a="leave">LEAVE MATCH</button>' : '<button class="go" data-a="menu">MAIN MENU</button>'}`);
      } else { hideOverlay(); wrap.focus(); syncTouchUI(); lockPointer(); }
    }

    ov.addEventListener('click', e => {
      const opt = e.target.closest('[data-opt]');
      if (opt) { const [, get, set] = OPTS[opt.dataset.opt]; set(!get()); opt.textContent = optLabel(opt.dataset.opt); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'full') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); return; }
      if (e.target.closest('a')) return;
      const sw = e.target.closest('[data-col]');
      if (sw) { mpColor = +sw.dataset.col; store.set('mp.color', mpColor); ov.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b === sw)); if (G.state === 'menu') showMech(); return; }
      if (e.target.closest('input')) return;
      if (G.state === 'menu') {
        const sel = e.target.closest('[data-sel]')?.dataset.sel, md = e.target.closest('[data-mech]'), fp = e.target.closest('[data-fp]');
        if (sel) { const wasMp = menuSel === 'mp'; menuSel = sel; store.set('menu.sel', sel); if (wasMp !== (sel === 'mp')) showMech(); renderMenu(); return; }
        if (md) { cycleMech(+md.dataset.mech); return; }
        if (fp) {
          const d = +fp.dataset.d;
          if (fp.dataset.fp === 'map') fpMap = (fpMap + d + FP_MAPS.length) % FP_MAPS.length;
          else fpFoes = clampN(fpFoes + d, 1, 8);
          store.set('fp.map', fpMap); store.set('fp.foes', fpFoes);
          renderMenu(); return;
        }
        if (a === 'go') go();
        else if (a === 'restart') { missionN = 0; store.set('mech.mission', 0); renderMenu(); }
        return;
      }
      if (a === 'menu') { mainMenu(); return; }
      if (a === 'mp') { mainMenu('mp'); return; }
      if (a === 'leave') { leaveArena(); return; }
      if (a === 'next') { missionN++; startMission(missionN); launch(); }
      else if (a === 'retry') { startMission(missionN); launch(); }
      else if (a === 'again') { startSkirmish(); launch(); }
      else if (G.state === 'play' && G.paused) pause(false);
    });

    function cycleMech(d) {
      chassis = MECH_ORDER[(MECH_ORDER.indexOf(chassis) + d + MECH_ORDER.length) % MECH_ORDER.length];
      store.set('mech.chassis', chassis);
      showMech(); renderMenu();
    }
    ov.addEventListener('input', e => { if (e.target.matches('.callsign')) { mpName = e.target.value.toUpperCase().slice(0, 12); store.set('mp.name', mpName); } });
    // Drag anywhere off the menu panel to turn the mech round.
    ov.addEventListener('pointerdown', e => {
      if (G.state !== 'menu' || e.target.closest('button, input, a, .mm-left, .mm-select')) return;
      G.menuDrag = { x: e.clientX }; ov.setPointerCapture?.(e.pointerId);
    });
    ov.addEventListener('pointermove', e => { if (G.menuDrag) { G.showYaw += (e.clientX - G.menuDrag.x) * 0.012; G.menuDrag.x = e.clientX; } });
    const endDrag = () => { G.menuDrag = null; };
    ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);
    // Only show fire buttons for the kinds of weapon this mech carries.
    function syncWeaponButtons() {
      for (const c of CATS) {
        const btn = $(`[data-t="${c}"]`, tui);
        if (btn) btn.hidden = !G.player.weapons.some(w => CAT_OF[w.type] === c);
      }
    }

    /* ---------- input ---------- */

    const lockPointer = () => { if (G.touchUI) return; try { const r = cv.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* fall back to arrows */ } };
    const exitLock = () => { if (document.pointerLockElement === cv) document.exitPointerLock(); };
    const locked = () => document.pointerLockElement === cv;
    let hadLock = false;
    const onLockChange = () => {
      if (locked()) hadLock = true;
      else if (hadLock && G.state === 'play' && !G.paused) pause(true);
    };
    document.addEventListener('pointerlockchange', onLockChange);

    const onMouseMove = e => {
      if (G.state !== 'play' || G.paused || !G.player.alive) return;
      if (!locked()) return;
      if (G.guide) { steerBy(e.movementX, e.movementY, 0.0028); return; }
      const sens = (G.zoom ? 0.0009 : 0.0024);
      const P = G.player;
      P.twist = clampN(P.twist - e.movementX * sens, -1.9, 1.9);
      P.pitch = clampN(P.pitch - e.movementY * sens * (invertY ? -1 : 1), -0.4, 0.45);
    };
    document.addEventListener('mousemove', onMouseMove);

    wrap.addEventListener('contextmenu', e => e.preventDefault());
    cv.parentElement.addEventListener('mousedown', e => {
      if (e.target.closest('.mech-overlay') || G.touchUI) return;
      wrap.focus();
      Sound.unlock();
      loadSamples();
      if (G.state !== 'play' || G.paused) return;
      if (!locked()) { lockPointer(); return; }
      const cat = { 0: 'energy', 2: 'ballistic', 1: 'missile' }[e.button];
      if (cat) { held[cat] = true; e.preventDefault(); if (cat === 'missile') missileTap = true; }
    });
    addEventListener('mouseup', e => {
      const cat = { 0: 'energy', 2: 'ballistic', 1: 'missile' }[e.button];
      if (cat && !G.touchUI) held[cat] = false;
    });

    const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyC', 'KeyJ', 'KeyT', 'KeyR', 'KeyF', 'KeyZ', 'KeyP', 'Space',
      'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyG', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    // Keys are taken at the document: hiding the overlay drops focus to <body>,
    // and pointer lock doesn't move it back.
    const onKeyDown = e => {
      if (e.target.closest?.('input')) { if (e.key === 'Enter' && G.state === 'menu') { e.preventDefault(); go(); } return; }
      if (e.key === 'F2') { e.preventDefault(); exitLock(); if (mp()) leaveArena(); else mainMenu(); return; }
      if (e.code === 'KeyM') { OPTS.sound[2](!settings.sound); msg(settings.sound ? 'SOUND ON' : 'SOUND OFF'); return; }
      if (G.state === 'menu') {
        const i = MENU.findIndex(([k]) => k === menuSel);
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = MENU[(i + (e.key === 'ArrowDown' ? 1 : -1) + MENU.length) % MENU.length][0];
          const wasMp = menuSel === 'mp'; menuSel = next; store.set('menu.sel', next);
          if (wasMp !== (next === 'mp')) showMech();
          renderMenu();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycleMech(e.key === 'ArrowRight' ? 1 : -1); }
        else if (e.key === 'Enter') { e.preventDefault(); go(); }
        return;
      }
      if (G.state !== 'play') return;
      // Esc only ever pauses: leaving pointer lock already pauses via
      // pointerlockchange, and a toggle here would immediately undo that.
      if (e.code === 'Escape') { e.preventDefault(); if (!G.paused) pause(true); return; }
      if (e.code === 'KeyP') { e.preventDefault(); pause(!G.paused); return; }
      if (G.paused || !GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (e.repeat && keys[e.code]) return;
      keys[e.code] = true;
      if (KEY_FOR.missile.includes(e.code)) missileTap = true;
      if (e.code === 'KeyT') cycleTarget();
      if (e.code === 'KeyR' && G.aimMech && G.aimMech.team !== 0) { G.target = G.aimMech; sfx.beep(); }
      if (e.code === 'KeyF') alpha();
      if (e.code === 'KeyZ') G.zoom = !G.zoom;
    };
    const onKeyUp = e => { keys[e.code] = false; };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    /* ---------- touch ---------- */

    // Left 40% of the screen: a floating stick that appears under the thumb.
    // Sideways turns the legs; up/down moves the throttle from wherever it was
    // when the thumb went down (so steering doesn't reset your speed), and the
    // throttle stays set on release, like W/S. Anywhere else: drag to aim.
    // Buttons handle themselves. Every finger is tracked separately.
    const tui = $('.touch-ui', root), stick = $('.stick', tui), knob = $('.knob', tui);
    const fingers = new Map();
    const STICK_R = 56;
    const syncTouchUI = () => {
      tui.hidden = !(G.touchUI && (G.state === 'play' || G.state === 'over') && !G.paused);
      if (tui.hidden) releaseFingers();
    };
    function releaseFingers() {
      for (const f of fingers.values()) if (f.kind === 'btn') touchButton(f.name, false, f.el);
      fingers.clear();
      G.touchTurn = 0; stick.hidden = true;
    }
    function touchButton(name, down, el) {
      el?.classList.toggle('on', down);
      if (CATS.includes(name)) { held[name] = down; if (down && name === 'missile') missileTap = true; }
      else if (name === 'jump') keys.KeyJ = down;
      if (!down) return;
      if (name === 'tgt') cycleTarget();
      else if (name === 'zoom') G.zoom = !G.zoom;
      else if (name === 'stop') G.player.throttle = 0;
      else if (name === 'pause') pause(true);
    }
    // Stop the browser turning touches into scrolls, zooms and fake mouse clicks.
    tui.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    tui.addEventListener('pointerdown', e => {
      e.preventDefault();
      Sound.unlock(); loadSamples();
      tui.setPointerCapture?.(e.pointerId);
      const b = e.target.closest('[data-t]');
      if (b) { fingers.set(e.pointerId, { kind: 'btn', name: b.dataset.t, el: b, lx: e.clientX, ly: e.clientY }); touchButton(b.dataset.t, true, b); return; }
      const r = tui.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const haveStick = [...fingers.values()].some(f => f.kind === 'stick');
      if (x < r.width * 0.4 && !haveStick) {
        fingers.set(e.pointerId, { kind: 'stick', x0: x, y0: y, thr0: G.player.throttle });
        stick.hidden = false;
        stick.style.left = x + 'px'; stick.style.top = y + 'px';
        knob.style.transform = 'translate(-50%, -50%)';
      } else fingers.set(e.pointerId, { kind: 'aim', lx: e.clientX, ly: e.clientY });
    });
    tui.addEventListener('pointermove', e => {
      const f = fingers.get(e.pointerId);
      if (!f || G.state !== 'play' || G.paused) return;
      const P = G.player;
      if (f.kind === 'stick') {
        const r = tui.getBoundingClientRect();
        let dx = e.clientX - r.left - f.x0, dy = e.clientY - r.top - f.y0;
        const d = hypot(dx, dy);
        if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const dead = v => (abs(v) < 8 ? 0 : v - Math.sign(v) * 8);
        G.touchTurn = clampN(-dead(dx) / (STICK_R - 8), -1, 1);
        if (P.alive && !P.shutdown) P.throttle = clampN(f.thr0 - dead(dy) / (STICK_R - 8), -0.35, 1);
      } else if (G.guide && (f.kind === 'aim' || (f.kind === 'btn' && f.name === 'missile'))) {
        // Flying missiles: drag the missile button itself (the thumb is
        // already on it) or anywhere on the right side to steer.
        steerBy(e.clientX - (f.lx ?? e.clientX), e.clientY - (f.ly ?? e.clientY), f.kind === 'btn' ? 0.009 : 0.006);
        f.lx = e.clientX; f.ly = e.clientY;
      } else if (f.kind === 'btn') {
        f.lx = e.clientX; f.ly = e.clientY;
      } else if (f.kind === 'btn' && f.name === 'fusion' && P.alive) {
        P.twist = clampN(P.twist - (e.clientX - f.lx) * 0.0055, -1.9, 1.9);
        P.pitch = clampN(P.pitch - (e.clientY - f.ly) * 0.0055 * (invertY ? -1 : 1), -0.4, 0.45);
        f.lx = e.clientX; f.ly = e.clientY;
      } else if (f.kind === 'aim' && P.alive) {
        const sens = G.zoom ? 0.0022 : 0.0055;
        P.twist = clampN(P.twist - (e.clientX - f.lx) * sens, -1.9, 1.9);
        P.pitch = clampN(P.pitch - (e.clientY - f.ly) * sens * (invertY ? -1 : 1), -0.4, 0.45);
        f.lx = e.clientX; f.ly = e.clientY;
      }
    });
    const lift = e => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      fingers.delete(e.pointerId);
      if (f.kind === 'btn') touchButton(f.name, false, f.el);
      if (f.kind === 'stick') { G.touchTurn = 0; stick.hidden = true; }
    };
    tui.addEventListener('pointerup', lift);
    tui.addEventListener('pointercancel', lift);
    // A touchscreen laptop can switch either way: follow whatever was used last.
    document.addEventListener('pointerdown', e => {
      const touch = e.pointerType === 'touch';
      if (touch === G.touchUI || e.pointerType === 'pen') return;
      G.touchUI = touch;
      if (touch) exitLock();
      syncTouchUI();
    }, true);

    /* ---------- multiplayer arena ---------- */

    // A free-for-all for up to eight pilots via server.py (port 8096). Each
    // client is the authority for its own mech: it sends its state ~15 times a
    // second, reports hits it lands, applies hits it takes, and declares its
    // own death. Other pilots are drawn from their latest state, smoothed and
    // extrapolated, and walk with the same gait. Their shots arrive as effects
    // ("ghosts") that look real but never score -- their shooter scores them.
    const NET_PORT = 8096, SEND_HZ = 15;
    const Net = { ws: null, id: 0, info: new Map(), sendT: 0, limit: 10 };
    const mp = () => G.mode === 'mp';
    const r2 = v => Math.round(v * 100) / 100;
    let mpName = store.get('mp.name', ''), mpColor = store.get('mp.color', floor(random() * MP_COLORS.length));
    const pilotName = id => Net.info.get(id)?.name || `PILOT ${id}`;
    const pilotCss = id => MP_COLORS[Net.info.get(id)?.color ?? 0]?.css || '#f44';
    const mechById = id => (id === Net.id ? G.player : G.mechs.find(m => m.netId === id));

    const setStatus = t => { const el = $('.status', ov); if (el) el.textContent = t; };

    function join() {
      if (Net.ws) return;
      mpName = ($('.callsign', ov)?.value || '').trim().toUpperCase().slice(0, 12);
      store.set('mp.name', mpName); store.set('mp.color', mpColor);
      Sound.unlock(); loadSamples();
      setStatus('CONNECTING...');
      let ws, welcomed = false;
      try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${NET_PORT}/ws`); }
      catch { setStatus('COULD NOT CONNECT'); return; }
      Net.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: mpName, color: mpColor }));
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') welcomed = true;
        onNet(m);
      };
      ws.onclose = () => {
        if (Net.ws !== ws) return;   // we closed it on purpose
        Net.ws = null;
        if (!welcomed) { if (G.state === 'menu' && !/FULL/.test($('.status', ov)?.textContent || '')) setStatus('THE ARENA SERVER IS NOT ANSWERING'); }
        else if (mp()) lostConnection();
      };
    }
    function netSend(obj) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify(obj)); }
    function leaveArena() {
      const ws = Net.ws; Net.ws = null; ws?.close();
      G.mode = 'sp'; Net.info.clear();
      mainMenu('mp');
    }
    function lostConnection() {
      Net.info.clear();
      mainMenu('mp', 'CONNECTION LOST -- A PHONE THAT SLEEPS DROPS OUT. JOIN AGAIN?');
    }

    function setScores(list) {
      if (!Array.isArray(list)) return;
      Net.info = new Map(list.map(p => [p.id, p]));
    }

    function onNet(m) {
      switch (m.t) {
        case 'full': setStatus(`THE ARENA IS FULL (${m.max} PILOTS) -- TRY AGAIN LATER`); break;
        case 'welcome':
          Net.id = m.id; Net.limit = m.limit || 10;
          setScores(m.scores);
          startArena(m.seed, m.pal);
          G.roundOver = !!m.over;
          break;
        case 'join': setScores(m.scores); msg(`${pilotName(m.id)} JOINED`); break;
        case 'leave': {
          msg(`${pilotName(m.id)} LEFT`);
          G.mechs = G.mechs.filter(x => x.netId !== m.id || x === G.player);
          if (G.target?.netId === m.id) G.target = null;
          setScores(m.scores);
          break;
        }
        case 's': netState(m); break;
        case 'fx': netFx(m); break;
        case 'hit':
          if (!G.player.alive) break;
          // A fusion discharge isn't damage: it's the frame shaking apart.
          if (m.fu && G.player.spawnT <= 0 && !G.roundOver) { G.whiteFlash = 1; destroy(G.player, mechById(m.from) || null); }
          else damage(G.player, m.p, m.amt, mechById(m.from) || null);
          break;
        case 'kill': {
          setScores(m.scores);
          const mine = m.killer === Net.id || m.victim === Net.id;
          msg(m.killer ? `${pilotName(m.killer)} DESTROYED ${pilotName(m.victim)}` : `${pilotName(m.victim)} WENT DOWN`, mine ? '#fc3' : '#7f7');
          if (m.killer === Net.id) { G.stats.kills++; say('Target destroyed.', true); }
          break;
        }
        case 'roundover':
          setScores(m.scores);
          G.roundOver = true;
          G.banner = { text: m.winner === Net.id ? 'YOU WIN THE ROUND' : `${m.name} WINS THE ROUND`, until: performance.now() + (m.next || 10) * 1000 };
          say(m.winner === Net.id ? 'Round won.' : 'Round over.', true);
          break;
        case 'newround':
          setScores(m.scores);
          startArena(m.seed, m.pal);
          say('New round.', true);
          break;
      }
    }

    function startArena(seed, palName) {
      G.mode = 'mp';
      pal = PALS[palName] || PALS.dusk;
      ter = makeTerrain(seed);
      if (world) gl.deleteBuffer(world.buf);
      world = upload(buildTerrainMesh(ter, pal, seed));
      G.mechs = []; G.shots = []; G.beams = []; G.parts = []; G.wrecks = []; G.msgs = []; G.pulses = [];
      G.target = null; G.flash = 0; G.shake = 0; G.kick = 0; G.zoom = false; G.time = 0; G.guide = null; G.mDown = false;
      G.stats = { shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0 };
      G.def = { name: 'Arena', foes: [] };
      G.roundOver = false; G.banner = null; G.respawnAt = 0; G.hitMark = 0;
      G.worldKind = 'match';
      G.player = newMech(chassis, 0, 0, 0, 0, { partsKey: partsKeyFor(mpColor, chassis) });
      G.player.netId = Net.id;
      G.mechs.push(G.player);
      respawn();
      hideOverlay(); wrap.focus();
      G.state = 'play'; G.paused = false;
      syncTouchUI();
      if (G.touchUI && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      }
      lockPointer();
      syncWeaponButtons();
    }

    // Somewhere on the map, as far as possible from everyone else.
    function spawnPoint() {
      let best = [0, 0], bestD = -1;
      for (let k = 0; k < 20; k++) {
        const a = random() * TAU, d = rnd(80, BOUND - 80), x = sin(a) * d, z = cos(a) * d;
        const near = min(1e9, ...G.mechs.filter(m => m.alive && m !== G.player).map(m => hypot(m.x - x, m.z - z)));
        if (near > bestD) { bestD = near; best = [x, z]; }
      }
      return best;
    }
    function respawn() {
      const P = G.player, [x, z] = spawnPoint();
      Object.assign(P, { x, z, y: ter.height(x, z), vy: 0, yaw: atan2(-x, -z), twist: 0, pitch: 0, speed: 0, throttle: 0,
        heat: 0, fuel: 1, shutdown: false, alive: true, air: false, hp: { ...P.max }, spawnT: 2 });
      P.weapons.forEach(w => { w.cd = 0; w.dead = false; w.ammo = w.def.ammo || null; });
      initFeet(P); P.lastYaw = P.yaw;
      G.respawnAt = 0; G.flash = 0; G.killer = 0;
      G.eye = eyeOf(P); G.view = dirOf(P.yaw, 0); G.aim = add(G.eye, mul(G.view, 100));
      sendState();
    }

    function sendState() {
      const P = G.player;
      netSend({ t: 's', ch: P.type, x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(P.yaw), tw: r2(P.twist), p: r2(P.pitch), sp: r2(P.speed),
        air: P.air ? 1 : 0, al: P.alive ? 1 : 0, sd: P.shutdown ? 1 : 0, hp: HPK.map(k => r2(P.hp[k])),
        bm: P.beaming ? 1 : 0, be: P.beaming && P.beamEnd ? P.beamEnd.map(r2) : 0, bf: r2(beamMult(P)),
        fl: P.fusion?.on && P.fusion.end ? P.fusion.end.map(r2) : 0, sc: P.fusion?.mech?.netId || 0,
        sp: P.fusion?.mech ? r2(min(1, P.fusion.t / WEAPONS.fusion.scan)) : 0 });
    }

    function netState(s) {
      let r = G.mechs.find(m => m.netId === s.id);
      if (!r) {
        const ch = CHASSIS[s.ch] ? s.ch : 'kestrel';
        r = newMech(ch, s.id, s.x, s.z, s.yaw, { partsKey: partsKeyFor(Net.info.get(s.id)?.color ?? 0, ch) });
        Object.assign(r, { netId: s.id, remote: true, net: null });
        G.mechs.push(r);
      }
      const first = !r.net;
      r.net = { ...s, at: performance.now() };
      // Someone's resonance scan is on us: warn, with an alarm.
      if (s.sc === Net.id && s.sp > 0) {
        if (!G.scanWarn || performance.now() - G.scanWarn.at > 1000) say('Warning. Resonance scan.', true);
        G.scanWarn = { by: s.id, p: s.sp, at: performance.now() };
        if (random() < 0.3) sfx.beep();
      }
      if (Array.isArray(s.hp)) HPK.forEach((k, i) => { r.hp[k] = +s.hp[i] || 0; });
      if (first || (s.al && !r.alive)) {
        // Appeared or respawned: jump straight there.
        Object.assign(r, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, twist: s.tw, pitch: s.p, alive: !!s.al });
        initFeet(r); r.lastYaw = r.yaw;
      } else if (!s.al && r.alive) {
        // Its own client says it's dead: show the kill.
        r.alive = false;
        explode(center(r), true);
        explode(add(center(r), [rnd(-3, 3), 2, rnd(-3, 3)]), false);
        G.wrecks.push({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, type: r.partsKey, scale: r.ch.scale, t: 0, roll: rnd(-0.6, 0.6) });
        if (G.target === r) G.target = null;
      }
    }

    // Glide toward the latest report, projected forward by its speed so a
    // late packet doesn't leave the mech standing still; snap if far off.
    function netInterp(r, dt) {
      const n = r.net;
      if (!n) return;
      const age = min(0.25, (performance.now() - n.at) / 1000);
      const tx = n.x + sin(n.yaw) * n.sp * age, tz = n.z + cos(n.yaw) * n.sp * age;
      const k = 1 - Math.exp(-dt * 12);
      if (hypot(tx - r.x, tz - r.z) > 30) { r.x = tx; r.z = tz; } else { r.x += (tx - r.x) * k; r.z += (tz - r.z) * k; }
      r.y += (n.y - r.y) * k;
      r.yaw += wrapA(n.yaw - r.yaw) * k;
      r.twist += wrapA(n.tw - r.twist) * k;
      r.pitch += (n.p - r.pitch) * k;
      r.speed = n.sp; r.air = !!n.air; r.shutdown = !!n.sd;
    }

    function netFx(f) {
      const src = mechById(f.id) || null;
      if (f.k === 'b') {
        const d = WEAPONS[f.w] || WEAPONS.laser;
        G.beams.push({ a: f.a, b: f.b, col: d.col, w: d.w, life: 0.14, max: 0.14 });
        for (let i = 0; i < 4; i++) particle(f.b, [rnd(-4, 4), rnd(1, 6), rnd(-4, 4)], 0.25, 0.35, d.col, 'fire');
        sfx.laser(f.a, d === WEAPONS.mlaser);
      } else if (f.k === 's') {
        G.shots.push({ kind: 'shell', p: f.p, v: f.v, owner: src, dmg: 0, life: WEAPONS.ac.range / WEAPONS.ac.speed, ghost: true });
        sfx.cannon(f.p);
      } else if (f.k === 'm') {
        const d = WEAPONS.lrm, target = f.tg ? mechById(f.tg) : null;
        for (let i = 0; i < d.count; i++) {
          const spread = norm(add(f.d, [rnd(-0.08, 0.08), rnd(0, 0.12), rnd(-0.08, 0.08)]));
          G.shots.push({ kind: 'missile', p: add(f.p, [rnd(-0.6, 0.6), rnd(-0.4, 0.4), rnd(-0.6, 0.6)]), v: mul(spread, d.speed * rnd(0.85, 1.1)),
            owner: src, dmg: 0, life: d.range / d.speed + 1, target, smoke: 0, age: 1, ghost: true, vid: f.v, from: f.id });
        }
        sfx.missile(f.p);
      } else if (f.k === 'fu') {
        launchPulse(f.a, f.id2 ? mechById(f.id2) : null, src, true, f.b);
        sfx.fusionCrack();
      } else if (f.k === 'mg' || f.k === 'md') {
        // Another pilot is flying a volley (mg: where it is and where it's
        // heading) or has detonated it (md). Their client scores the damage.
        const ghosts = G.shots.filter(s => s.ghost && s.from === f.id && s.vid === f.v && s.life > 0);
        if (!ghosts.length) return;
        if (f.k === 'md') { for (const s of ghosts) { s.life = -1; explode(s.p, false); } return; }
        const shift = mul(sub(f.p, centroid(ghosts)), 0.5);
        for (const s of ghosts) { s.p = add(s.p, shift); s.v = mul(norm(f.d), len(s.v)); s.target = null; s.life = max(s.life, 2); }
      }
    }

    /* ---------- loop & lifecycle ---------- */

    let raf = 0, last = 0, lastAudioCheck = 0;
    const loop = ts => {
      raf = requestAnimationFrame(loop);
      const dt = min(0.05, (ts - last) / 1000 || 0);
      last = ts;
      if (document.hidden) { for (const k of Object.keys(loops)) loopSet(k, 0); beamSound(false, 1); fusionSound(false, 0); return; }
      if (ts - lastAudioCheck > 1000) {
        lastAudioCheck = ts;
        const c = Sound.ctx;
        if (c && settings.sound && c.state !== 'running' && c.state !== 'closed') { try { c.resume()?.catch?.(() => {}); } catch { /* next tap */ } }
      }
      if (G.state === 'play' && !document.hasFocus() && !G.paused) pause(true);
      if (G.state === 'menu') menuTick(dt);
      if ((G.state === 'play' && (!G.paused || mp())) || G.state === 'over') update(dt);
      else { for (const k of Object.keys(loops)) loopSet(k, 0); beamSound(false, 1); fusionSound(false, 0); }
      render();
    };

    mainMenu();
    raf = requestAnimationFrame(loop);
    setTimeout(() => wrap.focus(), 0);
  }

  document.addEventListener('DOMContentLoaded', () => start(document.getElementById('app')));
})();
