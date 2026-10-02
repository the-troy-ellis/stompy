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
  // Browsers only allow audio after a click or key press.
  const Sound = {
    ctx: null,
    unlock() {
      if (this.ctx) { this.ctx.resume?.(); return; }
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    },
  };
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
    laser:  { name: 'LG LASER',  kind: 'beam',    dmg: 8,   heat: 9,  cd: 1.7, range: 520, col: [1, 0.25, 0.2], w: 0.22 },
    mlaser: { name: 'MED LASER', kind: 'beam',    dmg: 4.5, heat: 4,  cd: 1.0, range: 360, col: [0.3, 1, 0.35], w: 0.16 },
    ac:     { name: 'AUTOCANNON', kind: 'shell',  dmg: 9,   heat: 3,  cd: 1.3, range: 650, speed: 280, ammo: 30 },
    lrm:    { name: 'LRM-10',    kind: 'missile', dmg: 1.9, heat: 6,  cd: 4.5, range: 850, speed: 120, ammo: 14, count: 10 },
  };

  // Hit points per section: T(orso), L/R A(rm), L/R L(eg). Losing the torso kills.
  const CHASSIS = {
    kestrel: { name: 'KESTREL', speed: 15, turn: 1.05, sink: 10, scale: 1, pref: 300,
      hp: { T: 72, LA: 32, RA: 32, LL: 42, RL: 42 }, col: [0.55, 0.58, 0.62], acc: [0.85, 0.6, 0.15],
      weapons: [['laser', 'LA'], ['laser', 'RA'], ['ac', 'T'], ['lrm', 'T']] },
    jackal: { name: 'JACKAL', speed: 19, turn: 1.6, sink: 9, scale: 0.85, pref: 140, acc0: 0.035,
      hp: { T: 30, LA: 13, RA: 13, LL: 18, RL: 18 }, col: [0.62, 0.26, 0.2], acc: [0.2, 0.2, 0.22],
      weapons: [['mlaser', 'LA'], ['mlaser', 'RA']] },
    warden: { name: 'WARDEN', speed: 9, turn: 0.7, sink: 10, scale: 1.15, pref: 330, acc0: 0.025,
      hp: { T: 58, LA: 28, RA: 28, LL: 34, RL: 34 }, col: [0.36, 0.4, 0.3], acc: [0.75, 0.7, 0.2],
      weapons: [['lrm', 'T'], ['ac', 'RA'], ['laser', 'LA']] },
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

  function buildMechParts(ch) {
    const c = ch.col, dark = mul(c, 0.55), acc = ch.acc, glass = [0.08, 0.1, 0.13];
    const part = f => { const b = new Builder(); f(b); return b; };
    return {
      hip: part(b => b.cube(M.S(2.6, 0.9, 1.6), dark)),
      // Upper leg runs 2.6 down -y from the hip, lower leg 2.5 down from the knee
      // (LEG.l1 / LEG.l2): the IK in drawMech depends on these lengths.
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

  /* ======================= the app ======================= */

  function start(root) {
    root.innerHTML = `
      <div class="mech-wrap" tabindex="-1">
        <canvas class="mech-gl"></canvas><canvas class="mech-hud"></canvas>
        <div class="touch-ui" hidden>
          <div class="stick" hidden><div class="knob"></div></div>
          <button class="tbtn tpause" data-t="pause" aria-label="Pause">II</button>
          <button class="tbtn tstop" data-t="stop">STOP</button>
          <div class="tcluster">
            <button class="tbtn" data-t="zoom">ZOOM</button>
            <button class="tbtn" data-t="tgt">TGT</button>
            <button class="tbtn" data-t="wpn">WPN</button>
            <button class="tbtn" data-t="alpha">ALL</button>
            <button class="tbtn tfire" data-t="fire">FIRE</button>
            <button class="tbtn" data-t="jump">JUMP</button>
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
      uniform vec3 uFogCol; varying vec3 vCol; varying float vFog;
      void main() { gl_FragColor = vec4(mix(vCol, uFogCol, vFog), 1.0); }`);
    const skyProg = compile(`
      attribute vec2 aP; void main() { gl_Position = vec4(aP, 0.999, 1.0); }`, `
      precision mediump float;
      uniform vec3 uZen, uHor; uniform float uH, uRes;
      void main() {
        float y = gl_FragCoord.y / uRes - uH;
        gl_FragColor = vec4(mix(uHor, uZen, smoothstep(0.0, 0.55, y)), 1.0);
      }`);
    const L = n => gl.getUniformLocation(prog, n);
    const U = { VP: L('uVP'), M: L('uM'), light: L('uLight'), tint: L('uTint'), cam: L('uCam'), emis: L('uEmis'), fog: L('uFog'), fogCol: L('uFogCol') };
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

    let curMesh = null;
    const draw = (mesh, m, tint = [1, 1, 1], emis = 0) => {
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
    const volAt = p => (p ? clampN(1 - len(sub(p, G.eye)) / 900, 0, 1) : 1);

    // name -> number of takes (files name0..nameN-1, or just name.mp3 for 1).
    const SAMPLES = { step: 5, punch: 3, hiss: 3, plate: 2, laser: 5, mlaser: 5, crunch: 5, boom_big: 1, boom_low: 1,
      missile: 1, jet_loop: 1, hum_loop: 1, servo_loop: 1, powerdown: 1, powerup: 1, beep: 1 };
    const buffers = {};
    let loading = null;
    function loadSamples() {
      const c = Sound.ctx;
      if (!c || loading) return;
      loading = Promise.all(Object.entries(SAMPLES).flatMap(([name, n]) => Array.from({ length: n }, (_, i) =>
        fetch(`sounds/${n > 1 ? name + i : name}.mp3`)
          .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then(b => c.decodeAudioData(b))
          .then(buf => { (buffers[name] ||= []).push(buf); })
          .catch(() => { /* synthesis covers it */ }))));
    }
    // Play one random take. Lower rate = deeper and longer = heavier.
    function play(name, { vol = 1, rate = 1, vary = 0.07, at = null, delay = 0 } = {}) {
      const c = ac(), list = buffers[name];
      if (!c || !list?.length) return false;
      const v = vol * volAt(at);
      if (v < 0.004) return true;
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = list[floor(random() * list.length)];
      src.playbackRate.value = rate * (1 + rnd(-vary, vary));
      g.gain.value = v;
      src.connect(g).connect(out());
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
        src.buffer = buf; src.loop = true;
        // Skip the MP3 encoder's padding at each end, or the loop clicks.
        src.loopStart = 0.06; src.loopEnd = buf.duration - 0.06;
        g.gain.value = 0;
        src.connect(g).connect(out());
        src.start(c.currentTime, 0.06);
        l = loops[name] = { src, g };
      }
      l.g.gain.setTargetAtTime(gain, c.currentTime, 0.08);
      l.src.playbackRate.setTargetAtTime(rate, c.currentTime, 0.15);
    }
    const sfx = {
      osc(type, f0, f1, dur, vol, delay = 0) {
        const c = ac(); if (!c || vol < 0.003) return;
        const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(out()); o.start(t); o.stop(t + dur + 0.02);
      },
      noise(dur, vol, f0, f1, type = 'lowpass') {
        const c = ac(); if (!c || vol < 0.003) return;
        const t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = noise(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(out()); s.start(t, random() * 0.5); s.stop(t + dur + 0.02);
      },
      laser(p, small) {
        if (play(small ? 'mlaser' : 'laser', { at: p, vol: small ? 0.35 : 0.5, rate: small ? 1 : 0.85 })) return;
        const v = volAt(p); this.osc('sawtooth', 1900, 180, 0.28, 0.05 * v); this.osc('sine', 900, 120, 0.3, 0.05 * v);
      },
      // The autocannon is a thunk first and a bang second.
      cannon(p) {
        const v = volAt(p);
        play('punch', { at: p, vol: 0.9, rate: 0.7 });
        play('crunch', { at: p, vol: 0.45, rate: 1.25 });
        this.osc('sine', 110, 32, 0.32, 0.3 * v);
        if (!buffers.punch) this.noise(0.35, 0.3 * v, 900, 80);
      },
      missile(p) { if (!play('missile', { at: p, vol: 0.35, rate: 1.25, vary: 0.15 })) this.noise(0.7, 0.12 * volAt(p), 3000, 400, 'bandpass'); },
      boom(p, big) {
        const v = volAt(p);
        if (big) { play('boom_big', { at: p, vol: 1.1, rate: 0.9 }); play('crunch', { at: p, vol: 0.8, rate: 0.65 }); play('plate', { at: p, vol: 0.4, rate: 0.5, delay: 0.05 }); }
        else { play('crunch', { at: p, vol: 0.55 }); play('boom_low', { at: p, vol: 0.35, rate: 1.4 }); }
        this.osc('sine', big ? 70 : 120, 25, big ? 1.2 : 0.4, (big ? 0.4 : 0.25) * v);
        if (!buffers.crunch) this.noise(big ? 1.6 : 0.6, (big ? 0.6 : 0.25) * v, big ? 700 : 1200, 40);
      },
      // Taking a hit: armour plate ringing.
      clang() {
        play('step', { vol: 0.8, rate: 1.15, vary: 0.12 }); play('plate', { vol: 0.5, rate: 0.9 });
        if (!buffers.step) { this.osc('square', 240, 120, 0.12, 0.05); this.noise(0.15, 0.15, 4000, 800, 'highpass'); }
      },
      // A footfall: metal foot, slowed right down, on a sub-bass thump, with
      // the leg's hydraulics hissing as it lifts. Bigger mechs step deeper.
      step(m, vol) {
        const at = m === G.player ? null : [m.x, m.y, m.z], r = 0.6 / m.ch.scale;
        play('step', { at, vol: 0.95 * vol, rate: r });
        play('punch', { at, vol: 0.55 * vol, rate: r * 0.75 });
        play('hiss', { at, vol: 0.1 * vol, rate: 1.1, delay: 0.16 });
        const v = vol * volAt(at);
        this.osc('sine', 62 / m.ch.scale, 28, 0.24, 0.22 * v);
        if (!buffers.step) this.noise(0.08, 0.05 * v, 500, 100);
      },
      land(force) {
        play('plate', { vol: 0.9 * force, rate: 0.55 }); play('boom_low', { vol: 0.6 * force, rate: 0.8 });
        play('step', { vol: force, rate: 0.45 });
        this.osc('sine', 55, 22, 0.5, 0.35 * force);
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
    const G = { state: 'brief', paused: false, mechs: [], shots: [], beams: [], parts: [], wrecks: [], msgs: [],
      eye: [0, 0, 0], view: [0, 0, 1], flash: 0, shake: 0, kick: 0, lastTwist: 0,
      touchUI: matchMedia('(pointer: coarse)').matches, touchTurn: 0, zoom: false, target: null, sel: 0, endT: 0 };
    let ter = null, world = null, pal = null;
    const keys = {};
    let firing = false;

    function newMech(type, team, x, z, yaw) {
      const ch = CHASSIS[type];
      const m = {
        type, ch, team, x, z, y: ter.height(x, z), vy: 0, yaw, twist: 0, pitch: 0, speed: 0, throttle: 0, heat: 0,
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
      const def = missionDef(n);
      pal = PALS[def.pal];
      const seed = 7 + n * 13;
      ter = makeTerrain(seed);
      world = upload(buildTerrainMesh(ter, pal, seed));
      G.mechs = []; G.shots = []; G.beams = []; G.parts = []; G.wrecks = []; G.msgs = [];
      G.target = null; G.sel = 0; G.flash = 0; G.shake = 0; G.kick = 0; G.zoom = false; G.endT = 0; G.time = 0;
      G.stats = { shots: 0, hits: 0, dealt: 0, taken: 0, kills: 0 };
      G.def = def;
      G.player = newMech('kestrel', 0, 0, 0, 0);
      G.mechs.push(G.player);
      G.eye = eyeOf(G.player); G.view = dirOf(0, 0); G.aim = add(G.eye, mul(G.view, 100));
      def.foes.forEach((t, i) => {
        const a = (i / def.foes.length) * TAU + rnd(-0.4, 0.4) + PI * 0.6, d = rnd(520, 760);
        const x = clampN(sin(a) * d, -BOUND, BOUND), z = clampN(cos(a) * d, -BOUND, BOUND);
        const e = newMech(t, 1, x, z, atan2(-x, -z) + rnd(-1, 1));
        e.ai.aware = i === 0 && n === 0 ? false : random() < 0.3;
        G.mechs.push(e);
      });
    }

    /* ---------- geometry helpers ---------- */

    const frame = m => chain(M.T(m.x, m.y + (m.bob || 0), m.z), M.RY(m.yaw), M.S(m.ch.scale));
    const torsoFrame = m => chain(frame(m), M.T(0, 5, 0), M.RY(m.twist));
    const center = m => [m.x, m.y + 4.2 * m.ch.scale, m.z];
    const MOUNTS = { LA: [2.25, 0.8, 2.4], RA: [-2.25, 0.8, 2.4] };
    function muzzle(m, w) {
      const tf = torsoFrame(m);
      if (w.mount === 'T') return M.apply(tf, w.type === 'lrm' ? [w.side % 2 ? -1.25 : 1.25, 3.2, 0.6] : [-0.9, 1.6, 1.6]);
      return M.apply(tf, MOUNTS[w.mount]);
    }
    const eyeOf = m => M.apply(torsoFrame(m), [0, 2.35, 1.9]);
    const viewYaw = m => m.yaw + m.twist;

    function rayCyl(o, d, m) {
      const R = 2.4 * m.ch.scale, Hh = 7.9 * m.ch.scale;
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
      if (ly < 4.4) { const a = m.yaw; return dx * cos(a) - dz * sin(a) > 0 ? 'LL' : 'RL'; }
      const a = viewYaw(m), lx = (dx * cos(a) - dz * sin(a)) / m.ch.scale;
      return lx > 1.6 ? 'LA' : lx < -1.6 ? 'RA' : 'T';
    }

    function damage(m, p, amt, src) {
      if (!m.alive) return;
      let sec = sectionHit(m, p);
      if (m.hp[sec] <= 0) sec = 'T';
      m.hp[sec] -= amt;
      if (src === G.player && m !== G.player) { G.stats.hits++; G.stats.dealt += amt; }
      if (m === G.player) {
        G.stats.taken += amt;
        G.flash = min(0.55, G.flash + amt * 0.04);
        G.shake = min(1.2, G.shake + amt * 0.05);
        sfx.clang();
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
      m.alive = false;
      explode(center(m), true);
      explode(add(center(m), [rnd(-3, 3), 2, rnd(-3, 3)]), false);
      G.wrecks.push({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, type: m.type, scale: m.ch.scale, t: 0, roll: rnd(-0.6, 0.6) });
      if (G.target === m) G.target = null;
      if (m === G.player) {
        G.state = 'over'; G.endT = 3.2; G.won = false;
        msg('MECH DESTROYED', '#f44');
        return;
      }
      if (src === G.player) G.stats.kills++;
      say('Target destroyed.', true);
      if (!G.mechs.some(e => e.team !== 0 && e.alive)) {
        G.state = 'over'; G.endT = 3.5; G.won = true;
        setTimeout(() => say('Mission objectives complete.', true), 1400);
      }
    }

    function fire(m, w, aim, target) {
      const d = w.def;
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
        if (hit) {
          for (let i = 0; i < 4; i++) particle(end, [rnd(-4, 4), rnd(1, 6), rnd(-4, 4)], 0.25, 0.35, d.col, 'fire');
          if (hit.mech) damage(hit.mech, end, d.dmg, m);
        }
        sfx.laser(mz, d === WEAPONS.mlaser);
      } else if (d.kind === 'shell') {
        G.shots.push({ kind: 'shell', p: mz, v: mul(dir, d.speed), owner: m, dmg: d.dmg, life: d.range / d.speed });
        for (let i = 0; i < 5; i++) particle(add(mz, mul(dir, 1.5)), add(mul(dir, rnd(4, 12)), [rnd(-2, 2), rnd(-1, 2), rnd(-2, 2)]), 0.15, 0.6, [1, 0.8, 0.3], 'fire');
        sfx.cannon(mz);
      } else {
        for (let i = 0; i < d.count; i++) {
          const spread = norm(add(dir, [rnd(-0.08, 0.08), rnd(0, 0.12), rnd(-0.08, 0.08)]));
          G.shots.push({ kind: 'missile', p: add(mz, [rnd(-0.6, 0.6), rnd(-0.4, 0.4), rnd(-0.6, 0.6)]), v: mul(spread, d.speed * rnd(0.85, 1.1)),
            owner: m, dmg: d.dmg, life: d.range / d.speed + 1, target, smoke: 0, age: 0 });
        }
        sfx.missile(mz);
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
    const LEG = { hip: 4.6, hipX: 0.95, footX: 1.1, l1: 2.6, l2: 2.5, ankle: 0.42 };

    // Where foot i (0 = left) would stand, `ahead` units along the heading.
    function restFoot(m, i, ahead = 0) {
      const s = m.ch.scale, side = i === 0 ? 1 : -1, c = cos(m.yaw), sn = sin(m.yaw);
      const x = m.x + c * side * LEG.footX * s + sn * ahead, z = m.z - sn * side * LEG.footX * s + c * ahead;
      return [x, ter.height(x, z), z];
    }
    function initFeet(m) {
      m.feet = [0, 1].map(i => ({ pos: restFoot(m, i), from: null, lifted: false, yaw: m.yaw }));
      m.bob = 0; m.cyc = 0.45;   // both feet planted
    }

    // One gait clock per mech, advanced by distance travelled (and turning),
    // not time -- so the feet can't drift into step with each other, and a
    // swing's landing spot can be predicted exactly. The left foot swings
    // over cycle [0, SWING), the right over [0.5, 0.5 + SWING); in between
    // both are planted. Each swing aims, every frame, at where its rest spot
    // will be at touchdown plus a stance's worth ahead.
    const SWING = 0.42, STANCE_AHEAD = (1 - SWING) / 2;

    function swingTarget(m, i, u, D, dir) {
      return restFoot(m, i, dir * ((1 - u) * SWING * D + STANCE_AHEAD * D));
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
      // foot never gets more than STANCE_AHEAD * D from its hip (leg reach).
      const D = s * (3.5 + 4.5 * pace);
      const swingOf = i => { const u = (m.cyc - i * 0.5) / SWING; return u >= 0 && u < 1 ? u : null; };
      const before = [swingOf(0), swingOf(1)];
      const moving = abs(m.speed) > 0.3 || dyaw > 1e-4;
      // Stopped mid-stride: finish the step on the clock rather than freeze with a foot up.
      let adv = moving ? (abs(m.speed) * dt + dyaw * 2.5 * s) / D : (before[0] != null || before[1] != null ? dt / 0.6 : 0);
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
      if (off > 0.25 || e.heat > 72 || e.shutdown || e.ai.jitter > 0 || !P.alive) return;
      for (const w of e.weapons) {
        if (w.dead || w.cd > 0 || dist > w.def.range * 0.95) continue;
        let aim = pc;
        if (w.def.kind === 'shell') { const t = dist / w.def.speed; aim = add(pc, [sin(P.yaw) * P.speed * t, 0, cos(P.yaw) * P.speed * t]); }
        const err = dist * e.ch.acc0 * (1 + abs(P.speed) / 14) * (P.air ? 1.6 : 1);
        aim = add(aim, [rnd(-err, err), rnd(-err, err) * 0.6, rnd(-err, err)]);
        if (fire(e, w, aim, P)) { e.ai.jitter = rnd(0.15, 0.6); break; }
      }
    }

    function update(dt) {
      G.time += dt;
      const P = G.player;
      if (P.alive && !P.shutdown) {
        if (keys.KeyW) P.throttle = min(1, P.throttle + dt * 0.9);
        if (keys.KeyS) P.throttle = max(-0.35, P.throttle - dt * 0.9);
        if (keys.KeyX) P.throttle = 0;
        const turn = clampN((keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0) + G.touchTurn, -1, 1);
        P.yaw += turn * P.ch.turn * dt * (P.hp.LL > 0 && P.hp.RL > 0 ? 1 : 0.5);
        const kt = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0), kp = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
        P.twist = clampN(P.twist + kt * 1.6 * dt, -1.9, 1.9);
        P.pitch = clampN(P.pitch + kp * 0.9 * dt, -0.4, 0.45);
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

      if (P.alive && (firing || keys.Space)) fireGroup(G.sel);

      for (const m of G.mechs) {
        if (m.team !== 0 && m.alive) think(m, dt);
        if (m.alive) stepMech(m, dt);
      }
      // Mechs don't walk through each other.
      const alive = G.mechs.filter(m => m.alive);
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j], dx = b.x - a.x, dz = b.z - a.z, d = hypot(dx, dz), r = 2.4 * (a.ch.scale + b.ch.scale);
        if (d < r && d > 0.01) { const push = (r - d) / 2; a.x -= (dx / d) * push; a.z -= (dz / d) * push; b.x += (dx / d) * push; b.z += (dz / d) * push; }
      }

      for (const s of G.shots) {
        s.life -= dt;
        if (s.kind === 'missile') {
          if (s.target && s.target.alive) {
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
          if (hit.mech) damage(hit.mech, hit.point, s.dmg, s.owner);
          explode(hit.point, false);
        } else s.p = add(s.p, mul(s.v, dt));
        if (s.life <= 0 && s.kind === 'missile' && !hit) explode(s.p, false);
      }
      G.shots = G.shots.filter(s => s.life > 0);
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
      G.flash = max(0, G.flash - dt * 1.2);
      G.shake = max(0, G.shake - dt * 2.2);
      G.kick = max(0, G.kick - dt * 5);

      const live = P.alive && !P.shutdown, pace = min(1, abs(P.speed) / P.ch.speed);
      loopSet('hum_loop', P.alive ? (P.shutdown ? 0.03 : 0.07 + 0.13 * pace) : 0, P.shutdown ? 0.5 : 0.72 + 0.4 * pace);
      loopSet('jet_loop', live && P.jetting && P.fuel > 0 ? 0.32 : 0, 0.85);
      const twistRate = abs(P.twist - G.lastTwist) / max(dt, 1e-3);
      G.lastTwist = P.twist;
      loopSet('servo_loop', live ? min(0.13, twistRate * 0.07) : 0, 0.75 + min(0.6, twistRate * 0.25));

      if (G.state === 'over') {
        G.endT -= dt;
        if (G.endT <= 0) debrief();
      }
    }

    function groups() {
      const g = [];
      for (const w of G.player.weapons) if (!g.includes(w.type)) g.push(w.type);
      return g;
    }
    function fireGroup(idx) {
      const P = G.player, type = groups()[idx];
      let any = false;
      for (const w of P.weapons) if (w.type === type) any = fire(P, w, G.aim, G.lock ? G.target : null) || any;
      return any;
    }
    function alpha() {
      const P = G.player;
      for (const w of P.weapons) fire(P, w, G.aim, G.lock ? G.target : null);
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
      const parts = mechParts[m.type], B = frame(m), sc = m.ch.scale;
      const fwd = [sin(m.yaw), 0, cos(m.yaw)];
      const tint = VPtint || [1, 1, 1];
      draw(parts.hip, chain(B, M.T(0, LEG.hip, 0)), tint);
      // Legs reach for wherever the feet actually are.
      m.feet.forEach((f, i) => {
        const side = i === 0 ? 1 : -1;
        const legTint = m.hp[side > 0 ? 'LL' : 'RL'] > 0 ? tint : mul(tint, 0.35);
        const H = M.apply(B, [side * LEG.hipX, LEG.hip, 0]);
        const A = add(f.pos, [0, LEG.ankle * sc, 0]);
        const K = solveKnee(H, A, fwd, LEG.l1 * sc, LEG.l2 * sc);
        const ankle = add(K, mul(norm(sub(A, K)), LEG.l2 * sc));   // stays attached even if out of reach
        draw(parts.uleg, limb(H, K, fwd, sc), legTint);
        draw(parts.lleg, limb(K, ankle, fwd, sc), legTint);
        draw(parts.foot, chain(M.T(...ankle), M.RY(f.yaw), M.S(sc)), legTint);
      });
      const TB = chain(B, M.T(0, 5, 0), M.RY(m.twist));
      draw(parts.torso, TB, tint);
      for (const [s, k] of [[1, 'LA'], [-1, 'RA']]) {
        if (m.hp[k] <= 0) continue;
        draw(parts.arm, chain(TB, M.T(s * 2.25, 2.0, 0), M.RX(-m.pitch)), tint);
      }
    }

    function render() {
      resize();
      if (!ter) return;
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(pal.hor[0], pal.hor[1], pal.hor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const P = G.player;
      const fov = G.zoom ? 0.42 : 1.08;
      const sh = G.shake * 0.012;
      const yaw = viewYaw(P) + rnd(-sh, sh), pitch = P.pitch + rnd(-sh, sh) - (P.alive ? 0 : 0.15);
      const eye = add(G.eye, [0, -G.kick * 0.35, 0]), dir = dirOf(yaw, pitch - G.kick * 0.016);
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
      gl.uniform3fv(SU.zen, pal.zen); gl.uniform3fv(SU.hor, pal.hor);
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
      gl.uniform3fv(U.fogCol, pal.hor);

      draw(world, M.id());
      for (const m of G.mechs) if (m.alive && m !== P) drawMech(m);
      for (const w of G.wrecks) {
        const parts = mechParts[w.type], B = chain(M.T(w.x, w.y, w.z), M.RY(w.yaw), M.S(w.scale));
        const dark = [0.3, 0.28, 0.27];
        draw(parts.torso, chain(B, M.T(0, 1.3, -1), M.RX(-1.2), M.RZ(w.roll)), dark);
        draw(parts.hip, chain(B, M.T(0.5, 0.6, 1.5), M.RY(0.6)), dark);
        draw(parts.uleg, chain(B, M.T(2.5, 0.6, 1), M.RZ(1.5)), dark);
        draw(parts.lleg, chain(B, M.T(-2.6, 0.5, -0.5), M.RZ(-1.5), M.RY(1)), dark);
      }
      for (const s of G.shots) {
        const d = norm(s.v), yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1));
        if (s.kind === 'shell') draw(meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.25, 0.25, 2.2)), [1, 0.85, 0.4], 1);
        else draw(meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.35, 0.35, 1.2)), [1, 0.55, 0.25], 1);
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
        draw(meshes.cube, chain(M.T(...p.p), M.RY(p.spin), M.RX(p.spin * 0.7), M.S(size)), tint, emis);
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
        target: { x: 64, y: 10 },
        hostiles: { x: W - 2 * r - 30, y: 20 },
      };
    }

    function drawHUD() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(0, G.kick * 3);  // the dashboard jolts with each step
      if (G.state === 'brief') return;
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

      // Crosshair.
      const ch = project(G.aim) || [W / 2, H / 2];
      ctx.strokeStyle = G.aimMech ? RED : GREEN;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(ch[0] + dx * 5, ch[1] + dy * 5); ctx.lineTo(ch[0] + dx * 14, ch[1] + dy * 14); }
      ctx.stroke();
      ctx.strokeRect(ch[0] - 1, ch[1] - 1, 2, 2);

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
          ctx.fillText(G.lock ? 'LOCK' : t.ch.name, a[0], y0 - 8);
        }
      }
      // Enemy markers in view (small chevrons), so far-off mechs can be found.
      for (const m of G.mechs) {
        if (!m.alive || m.team === 0 || m === t) continue;
        const p = project([m.x, m.y + 9 * m.ch.scale, m.z]);
        if (!p || p[1] > L.viewBottom) continue;
        ctx.fillStyle = RED;
        ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1] - 6); ctx.lineTo(p[0] + 4, p[1] - 6); ctx.lineTo(p[0], p[1]); ctx.fill();
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
        ctx.fillStyle = m === t ? AMBER : RED;
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
      const wx = L.weapons.x, gs = groups();
      let wy = L.weapons.y;
      ctx.textAlign = 'left';
      for (const w of P.weapons) {
        const sel = gs[G.sel] === w.type;
        ctx.fillStyle = w.dead ? '#622' : sel ? GREEN : DIM;
        const label = `${sel ? '>' : ' '}${w.def.name}${w.mount === 'T' ? '' : w.mount === 'LA' ? ' L' : ' R'}`;
        ctx.fillText(label, wx, wy);
        const ammo = w.def.ammo ? String(w.ammo).padStart(3) : '   ';
        ctx.fillText(w.dead ? 'DESTROYED' : ammo, wx + 120, wy);
        if (!w.dead) {
          const f = 1 - w.cd / w.def.cd;
          ctx.fillStyle = '#031203'; ctx.fillRect(wx + 150, wy - 3, 40, 6);
          ctx.fillStyle = f >= 1 ? GREEN : AMBER; ctx.fillRect(wx + 150, wy - 3, 40 * f, 6);
        }
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
        ctx.fillText(`TGT ${t.ch.name}`, px + 6, py + 10);
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
      ctx.fillText(`HOSTILES ${left}`, L.hostiles.x, L.hostiles.y);
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
        <tr><td>FIRE (hold)</td><td>fire the selected weapon group</td></tr>
        <tr><td>ALL</td><td>fire everything</td></tr>
        <tr><td>WPN / TGT</td><td>next weapon group / next target</td></tr>
        <tr><td>JUMP (hold)</td><td>jump jets</td></tr>
        <tr><td>ZOOM / STOP / II</td><td>zoom, full stop, pause</td></tr>
      </table>`;
    const controls = () => (G.touchUI ? TOUCH_CONTROLS : CONTROLS);
    const CONTROLS = `
      <table class="mech-keys">
        <tr><td>W / S</td><td>throttle up / down (it stays set)</td><td>X</td><td>full stop</td></tr>
        <tr><td>A / D</td><td>turn legs</td><td>Mouse</td><td>twist torso &amp; aim</td></tr>
        <tr><td>Click / Space</td><td>fire selected group</td><td>Right-click / F</td><td>fire everything</td></tr>
        <tr><td>Tab / 1-3</td><td>select weapon group</td><td>T</td><td>next target</td></tr>
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

    function showOverlay(html) { ov.innerHTML = html; ov.hidden = false; }
    function hideOverlay() { ov.hidden = true; }

    function briefing() {
      G.state = 'brief';
      syncTouchUI();
      startMission(missionN);
      const d = G.def, p = PALS[d.pal];
      const counts = d.foes.reduce((a, f) => ((a[f] = (a[f] || 0) + 1), a), {});
      showOverlay(`
        <h1>STOMPY</h1>
        <div class="panel">
          <div class="k">MISSION ${missionN + 1}: ${esc(d.name.toUpperCase())}</div>
          <p>${esc(d.intel)}</p>
          <p>TERRAIN: ${esc(p.name)}<br>OBJECTIVE: Destroy all hostile mechs
            (${Object.entries(counts).map(([k, n]) => `${n}x ${CHASSIS[k].name}`).join(', ')})<br>
            YOUR MECH: KESTREL &mdash; 2x LG LASER, AUTOCANNON, LRM-10, JUMP JETS</p>
          ${controls()}
          ${G.touchUI ? '<p class="k">Best played sideways, full screen.</p>' : ''}
        </div>
        <div style="display:flex;gap:10px">
          <button class="go" data-a="launch">LAUNCH</button>
          ${missionN > 0 ? '<button class="go" data-a="first">START OVER</button>' : ''}
        </div>
        ${options()}
        <p class="credits">Original game, raw WebGL. Sound effects by <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a> (CC0).
          The cockpit voice is your browser's speech engine.</p>`);
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
      say(`Mission ${missionN + 1}. ${G.def.name}. Systems online.`, true);
    }

    function debrief() {
      G.state = 'debrief';
      syncTouchUI();
      exitLock();
      const s = G.stats, acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
      const tm = `${floor(G.time / 60)}:${String(floor(G.time % 60)).padStart(2, '0')}`;
      if (G.won) store.set('mech.mission', max(store.get('mech.mission', 0), missionN + 1));
      showOverlay(`
        <h1 style="color:${G.won ? '#5f5' : '#f44'}">${G.won ? 'MISSION COMPLETE' : 'MECH DESTROYED'}</h1>
        <div class="panel">
          <div class="k">MISSION ${missionN + 1}: ${esc(G.def.name.toUpperCase())}</div>
          <p>TIME ${tm}<br>KILLS ${s.kills} / ${G.def.foes.length}<br>
             ACCURACY ${acc}% (${s.hits} of ${s.shots})<br>
             DAMAGE DEALT ${Math.round(s.dealt)} &nbsp; TAKEN ${Math.round(s.taken)}</p>
        </div>
        <div style="display:flex;gap:10px">
          ${G.won ? '<button class="go" data-a="next">NEXT MISSION</button>' : ''}
          <button class="go" data-a="retry">${G.won ? 'REPLAY' : 'RETRY'}</button>
        </div>
        ${options()}`);
    }

    function pause(on) {
      if (G.state !== 'play') return;
      G.paused = on;
      firing = false;
      if (on) {
        for (const k in keys) keys[k] = false;
        exitLock();   // give the cursor back, or nothing outside the game can be clicked
        syncTouchUI();
        showOverlay(`<h1>PAUSED</h1><div class="panel" style="text-align:center">Click to resume.</div><div class="panel">${controls()}</div>${options()}`);
      } else { hideOverlay(); wrap.focus(); syncTouchUI(); lockPointer(); }
    }

    ov.addEventListener('click', e => {
      const opt = e.target.closest('[data-opt]');
      if (opt) { const [, get, set] = OPTS[opt.dataset.opt]; set(!get()); opt.textContent = optLabel(opt.dataset.opt); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'full') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); return; }
      if (e.target.closest('a')) return;
      if (a === 'launch') launch();
      else if (a === 'first') { missionN = 0; store.set('mech.mission', 0); briefing(); }
      else if (a === 'next') { missionN++; briefing(); }
      else if (a === 'retry') briefing();
      else if (G.state === 'play' && G.paused) pause(false);
    });

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
      if (e.button === 0) firing = true;
      if (e.button === 2) alpha();
    });
    addEventListener('mouseup', () => { firing = false; });

    const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyX', 'KeyC', 'KeyJ', 'KeyT', 'KeyR', 'KeyF', 'KeyZ', 'KeyP', 'Tab', 'Space',
      'Digit1', 'Digit2', 'Digit3', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    // Keys are taken at the document: hiding the overlay drops focus to <body>,
    // and pointer lock doesn't move it back.
    const onKeyDown = e => {
      if (e.key === 'F2') { e.preventDefault(); exitLock(); briefing(); return; }
      if (e.code === 'KeyM') { OPTS.sound[2](!settings.sound); msg(settings.sound ? 'SOUND ON' : 'SOUND OFF'); return; }
      if (G.state !== 'play') { if (e.key === 'Enter' && G.state === 'brief') { e.preventDefault(); launch(); } return; }
      // Esc only ever pauses: leaving pointer lock already pauses via
      // pointerlockchange, and a toggle here would immediately undo that.
      if (e.code === 'Escape') { e.preventDefault(); if (!G.paused) pause(true); return; }
      if (e.code === 'KeyP') { e.preventDefault(); pause(!G.paused); return; }
      if (G.paused || !GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (e.repeat && keys[e.code]) return;
      keys[e.code] = true;
      const gs = groups();
      if (e.code === 'Tab') { G.sel = (G.sel + 1) % gs.length; sfx.beep(); }
      if (e.code.startsWith('Digit')) { const i = +e.code.slice(5) - 1; if (i < gs.length) { G.sel = i; sfx.beep(); } }
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
      if (name === 'fire') firing = down;
      else if (name === 'jump') keys.KeyJ = down;
      if (!down) return;
      const gs = groups();
      if (name === 'alpha') alpha();
      else if (name === 'wpn') { G.sel = (G.sel + 1) % gs.length; sfx.beep(); }
      else if (name === 'tgt') cycleTarget();
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
      if (b) { fingers.set(e.pointerId, { kind: 'btn', name: b.dataset.t, el: b }); touchButton(b.dataset.t, true, b); return; }
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

    /* ---------- loop & lifecycle ---------- */

    let raf = 0, last = 0;
    const loop = ts => {
      raf = requestAnimationFrame(loop);
      const dt = min(0.05, (ts - last) / 1000 || 0);
      last = ts;
      if (document.hidden) { for (const k of Object.keys(loops)) loopSet(k, 0); return; }
      if (G.state === 'play' && !document.hasFocus() && !G.paused) pause(true);
      if ((G.state === 'play' && !G.paused) || G.state === 'over') update(dt);
      else for (const k of Object.keys(loops)) loopSet(k, 0);
      render();
    };

    briefing();
    raf = requestAnimationFrame(loop);
    setTimeout(() => wrap.focus(), 0);
  }

  document.addEventListener('DOMContentLoaded', () => start(document.getElementById('app')));
})();
