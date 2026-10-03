// Stompy -- a standalone 3D mech sim in the spirit of the mid-90s
// classics. Original code and art: raw WebGL, flat-shaded, no libraries.
//
// Legs and torso turn independently (A/D steer the legs, the mouse twists the
// torso), heat builds as you fire, damage is tracked per section, and a
// computer voice reads out the bad news.

'use strict';
import { $, esc } from './util/dom.js';
import { store } from './util/store.js';
import { TAU, clampN, wrapA, rnd, add, sub, mul, cross, len, norm, mix3, dirOf, M, chain } from './util/math.js';
import { Builder } from './mesh/builder.js';
import { buildMechParts } from './mesh/mechParts.js';
import { WEAPONS, CATS, CAT_OF, CAT_LABEL, CAT_KEY } from './data/weapons.js';
import { CHASSIS, MECH_ORDER, MECH_INFO, HPK } from './data/chassis.js';
import { geoOf } from './data/geo.js';
import { PALS } from './data/palettes.js';
import { missionDef, FP_MAPS } from './data/missions.js';
import { MP_COLORS } from './data/colors.js';
import { BOUND, makeTerrain } from './world/terrain.js';
import { buildTerrainMesh } from './world/terrainMesh.js';
import { createGame, newMech, startMatch, resetMatch } from './sim/state.js';
import { update } from './sim/update.js';
import { center, frame, eyeOf, viewYaw } from './sim/geom.js';
import { initFeet, solveKnee, limb } from './sim/gait.js';
import { msg, particle, explode } from './sim/effects.js';
import { damage, destroy } from './sim/combat.js';
import { MELT_MAX, beamMult, meltFrac } from './sim/beams.js';
import { launchPulse } from './sim/fusion.js';
import { SEND_HZ, steerBy, endGuide, alpha, cycleTarget } from './sim/missiles.js';
import { r2 } from './net/protocol.js';


(() => {
  const { sin, cos, atan2, min, max, abs, PI, random, hypot, floor } = Math;

  /* ---- the little the page needs: DOM helpers, storage, audio unlock ---- */
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
    function say(text, force, delay) {
      if (delay) { setTimeout(() => say(text, force), delay); return; }
      msg(G, text.toUpperCase(), '#fc3');
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
    const params = new URLSearchParams(location.search);
    const fx = { say, sfx, fusionSound: (on, p) => fusionSound(on, p), netSend: obj => netSend(obj) };
    const G = createGame({ fx, touchUI: params.has('touch') || matchMedia('(pointer: coarse)').matches });
    // ?debug=1 exposes the state for the smoke test and for poking at in the console.
    if (params.has('debug')) window.__stompy = { game: G, kill: m => destroy(G, m, G.player) };
    let world = null;
    const keys = {};
    // Which fire controls are held: by touch button, mouse button or key.
    const held = { energy: false, ballistic: false, missile: false, fusion: false };
    const clearHeld = () => { for (const c of CATS) held[c] = false; };
    const KEY_FOR = { energy: ['Digit1'], ballistic: ['Digit2'], missile: ['Digit3', 'Space'], fusion: ['Digit4', 'KeyG'] };
    const isHeld = c => held[c] || KEY_FOR[c].some(k => keys[k]);
    // A missile press is latched until the next frame sees it, so a tap
    // shorter than a frame (a slow phone, a quick thumb) still fires.
    let missileTap = false;

    function startMission(n) {
      missionN = n; store.set('mech.mission', max(store.get('mech.mission', 0), n));
      startMatch(G, missionDef(n), 7 + n * 13, n === 0, chassis);
      G.kind = 'campaign';
      uploadWorld();
    }
    // Free play: a one-off battle on the chosen map with the chosen number of hostiles.
    function startSkirmish() {
      const pk = FP_MAPS[fpMap] === 'random' ? ['dusk', 'ice', 'volcanic'][floor(random() * 3)] : FP_MAPS[fpMap];
      const foes = Array.from({ length: fpFoes }, () => (random() < 0.35 ? 'warden' : 'jackal'));
      startMatch(G, { name: 'Free Play', pal: pk, foes, intel: '' }, 1 + floor(random() * 1e5), false, chassis);
      G.kind = 'free';
      uploadWorld();
    }
    // The terrain mesh on the GPU, rebuilt whenever the sim builds a new world.
    function uploadWorld() {
      if (world) gl.deleteBuffer(world.buf);
      world = upload(buildTerrainMesh(G.ter, G.pal, G.ter.seed));
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
      if (!G.ter) return;
      gl.viewport(0, 0, cv.width, cv.height);
      const P = G.player, gd = G.guide, ir = !!gd;
      const IR_ZEN = [0.03, 0.03, 0.03], IR_HOR = [0.1, 0.1, 0.1];
      const hor = ir ? IR_HOR : G.pal.hor;
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
      gl.uniform3fv(SU.zen, ir ? IR_ZEN : G.pal.zen); gl.uniform3fv(SU.hor, hor);
      gl.uniform1f(SU.h, 0.5 - 0.5 * Math.tan(pitch) / Math.tan(fov / 2)); gl.uniform1f(SU.res, cv.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(ap);

      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(prog);
      curMesh = null;
      [A.pos, A.nrm, A.col].forEach(a => gl.enableVertexAttribArray(a));
      gl.uniformMatrix4fv(U.VP, false, VP);
      gl.uniform3fv(U.light, G.pal.light);
      gl.uniform3fv(U.cam, eye);
      gl.uniform2f(U.fog, G.pal.fog[0], G.pal.fog[1]);
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
        else if (p.kind === 'smoke') { size *= 1.6 - f * 0.8; tint = mix3(G.pal.hor, p.col, f); emis = 0.6; }
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
        ctx.fillText(`RESPAWN IN ${Math.ceil(max(0, (G.respawnAt - G.clock) / 1000))}`, W / 2, mid + 26);
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
      ctx.fillText(`ALT ${Math.round(g.pos[1] - G.ter.height(g.pos[0], g.pos[2]))}m`, rx, 22);
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
        G.pal = PALS.dusk;
        G.ter = makeTerrain(3);
        uploadWorld();
      }
      G.shots = []; G.beams = []; G.cbeams = []; G.parts = []; G.wrecks = []; G.msgs = [];
      showMech();
      renderMenu(status);
    }
    // The mech on show: multiplayer shows it in your arena colour.
    function showMech() {
      const key = menuSel === 'mp' ? partsKeyFor(mpColor, chassis) : chassis;
      G.player = newMech(G, chassis, 0, 0, 0, 0, { partsKey: key });
      G.mechs = [G.player];
      menuTick(0);
    }
    function menuTick(dt) {
      const m = G.player, t = performance.now() / 1000;
      if (!m) return;
      if (!G.menuDrag) G.showYaw = (G.showYaw ?? 2.6) + dt * 0.35;
      m.yaw = G.showYaw; m.twist = sin(t * 0.6) * 0.3; m.pitch = sin(t * 0.4) * 0.08;
      initFeet(G, m);
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
        endGuide(G, true); G.mDown = false;
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
      if (G.guide) { steerBy(G, e.movementX, e.movementY, 0.0028, invertY); return; }
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
      if (e.code === 'KeyM') { OPTS.sound[2](!settings.sound); msg(G, settings.sound ? 'SOUND ON' : 'SOUND OFF'); return; }
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
      if (e.code === 'KeyT') cycleTarget(G);
      if (e.code === 'KeyR' && G.aimMech && G.aimMech.team !== 0) { G.target = G.aimMech; sfx.beep(); }
      if (e.code === 'KeyF') alpha(G);
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
      if (name === 'tgt') cycleTarget(G);
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
        steerBy(G, e.clientX - (f.lx ?? e.clientX), e.clientY - (f.ly ?? e.clientY), f.kind === 'btn' ? 0.009 : 0.006, invertY);
        f.lx = e.clientX; f.ly = e.clientY;
      } else if (f.kind === 'btn' && f.name === 'fusion' && P.alive) {
        // Dragging the fusion button aims the scan (the thumb is already on it).
        P.twist = clampN(P.twist - (e.clientX - f.lx) * 0.0055, -1.9, 1.9);
        P.pitch = clampN(P.pitch - (e.clientY - f.ly) * 0.0055 * (invertY ? -1 : 1), -0.4, 0.45);
        f.lx = e.clientX; f.ly = e.clientY;
      } else if (f.kind === 'btn') {
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
    const NET_PORT = 8096;
    const Net = { ws: null, id: 0, info: new Map(), sendT: 0, limit: 10 };
    const mp = () => G.mode === 'mp';
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
        case 'join': setScores(m.scores); msg(G, `${pilotName(m.id)} JOINED`); break;
        case 'leave': {
          msg(G, `${pilotName(m.id)} LEFT`);
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
          if (m.fu && G.player.spawnT <= 0 && !G.roundOver) { G.whiteFlash = 1; destroy(G, G.player, mechById(m.from) || null); }
          else damage(G, G.player, m.p, m.amt, mechById(m.from) || null);
          break;
        case 'kill': {
          setScores(m.scores);
          const mine = m.killer === Net.id || m.victim === Net.id;
          msg(G, m.killer ? `${pilotName(m.killer)} DESTROYED ${pilotName(m.victim)}` : `${pilotName(m.victim)} WENT DOWN`, mine ? '#fc3' : '#7f7');
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
      resetMatch(G, { def: { name: 'Arena', foes: [] }, seed, pal: palName });
      uploadWorld();
      G.banner = null;
      G.player = newMech(G, chassis, 0, 0, 0, 0, { partsKey: partsKeyFor(mpColor, chassis) });
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
      Object.assign(P, { x, z, y: G.ter.height(x, z), vy: 0, yaw: atan2(-x, -z), twist: 0, pitch: 0, speed: 0, throttle: 0,
        heat: 0, fuel: 1, shutdown: false, alive: true, air: false, hp: { ...P.max }, spawnT: 2 });
      P.weapons.forEach(w => { w.cd = 0; w.dead = false; w.ammo = w.def.ammo || null; });
      initFeet(G, P); P.lastYaw = P.yaw;
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
        // eslint-disable-next-line no-dupe-keys -- the duplicate `sp` is the known wire bug fixed with the protocol move (M0 stage 5)
        sp: P.fusion?.mech ? r2(min(1, P.fusion.t / WEAPONS.fusion.scan)) : 0 });
    }

    function netState(s) {
      let r = G.mechs.find(m => m.netId === s.id);
      if (!r) {
        const ch = CHASSIS[s.ch] ? s.ch : 'kestrel';
        r = newMech(G, ch, s.id, s.x, s.z, s.yaw, { partsKey: partsKeyFor(Net.info.get(s.id)?.color ?? 0, ch) });
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
        initFeet(G, r); r.lastYaw = r.yaw;
      } else if (!s.al && r.alive) {
        // Its own client says it's dead: show the kill.
        r.alive = false;
        explode(G, center(r), true);
        explode(G, add(center(r), [rnd(-3, 3), 2, rnd(-3, 3)]), false);
        G.wrecks.push({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, type: r.partsKey, scale: r.ch.scale, t: 0, roll: rnd(-0.6, 0.6) });
        if (G.target === r) G.target = null;
      }
    }

    const centroid = list => mul(list.reduce((a, s) => add(a, s.p), [0, 0, 0]), 1 / list.length);
    function netFx(f) {
      const src = mechById(f.id) || null;
      if (f.k === 'b') {
        const d = WEAPONS[f.w] || WEAPONS.laser;
        G.beams.push({ a: f.a, b: f.b, col: d.col, w: d.w, life: 0.14, max: 0.14 });
        for (let i = 0; i < 4; i++) particle(G, f.b, [rnd(-4, 4), rnd(1, 6), rnd(-4, 4)], 0.25, 0.35, d.col, 'fire');
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
        launchPulse(G, f.a, f.id2 ? mechById(f.id2) : null, src, true, f.b);
        sfx.fusionCrack();
      } else if (f.k === 'mg' || f.k === 'md') {
        // Another pilot is flying a volley (mg: where it is and where it's
        // heading) or has detonated it (md). Their client scores the damage.
        const ghosts = G.shots.filter(s => s.ghost && s.from === f.id && s.vid === f.v && s.life > 0);
        if (!ghosts.length) return;
        if (f.k === 'md') { for (const s of ghosts) { s.life = -1; explode(G, s.p, false); } return; }
        const shift = mul(sub(f.p, centroid(ghosts)), 0.5);
        for (const s of ghosts) { s.p = add(s.p, shift); s.v = mul(norm(f.d), len(s.v)); s.target = null; s.life = max(s.life, 2); }
      }
    }

    /* ---------- loop & lifecycle ---------- */

    // What the sim sees this frame, from the keyboard, the mouse buttons and the touch controls.
    function snapshotInput() {
      const inp = {
        thrUp: !!keys.KeyW, thrDown: !!keys.KeyS, stop: !!keys.KeyX,
        turn: (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0) + G.touchTurn,
        twist: (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0), pitch: (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0),
        centre: !!keys.KeyC, jets: !!keys.KeyJ,
        held: Object.fromEntries(CATS.map(c => [c, isHeld(c)])), missileTap,
      };
      missileTap = false;
      return inp;
    }
    // The arena's per-frame housekeeping: respawn timer, spawn shield, state cadence.
    function netTick(dt) {
      if (!mp()) return;
      const P = G.player;
      if (P.spawnT > 0) P.spawnT -= dt;
      if (!P.alive && G.respawnAt && G.clock >= G.respawnAt) respawn();
      if ((Net.sendT += dt) >= 1 / SEND_HZ) { Net.sendT = 0; sendState(); flushHits(); }
    }
    // Continuous layers follow the sim state: reactor hum, jets, torso servo, laser bite.
    function audioTick() {
      const P = G.player, live = P.alive && !P.shutdown, pace = min(1, abs(P.speed) / P.ch.speed);
      loopSet('hum_loop', P.alive ? (P.shutdown ? 0.03 : 0.07 + 0.13 * pace) : 0, P.shutdown ? 0.5 : 0.72 + 0.4 * pace);
      const jetting = live && P.jetting && P.fuel > 0;
      loopSet('jet_loop', jetting ? 0.32 : G.guide ? 0.24 : 0, jetting ? 0.85 : G.guide ? 1.7 : 0.85);
      const twistRate = G.twistRate || 0;
      loopSet('servo_loop', live ? min(0.13, twistRate * 0.07) : 0, 0.75 + min(0.6, twistRate * 0.25));
      beamSound(P.beaming && !G.paused, beamMult(P));
    }

    let last = 0, lastAudioCheck = 0;
    const loop = ts => {
      requestAnimationFrame(loop);
      const dt = min(0.05, (ts - last) / 1000 || 0);
      last = ts;
      if (document.hidden) { for (const k of Object.keys(loops)) loopSet(k, 0); beamSound(false, 1); fusionSound(false, 0); return; }
      if (ts - lastAudioCheck > 1000) {
        lastAudioCheck = ts;
        const c = Sound.ctx;
        if (c && settings.sound && c.state !== 'running' && c.state !== 'closed') { try { c.resume()?.catch?.(() => {}); } catch { /* next tap */ } }
      }
      if (G.state === 'play' && !document.hasFocus() && !G.paused) pause(true);
      G.clock = performance.now();
      if (G.state === 'menu') menuTick(dt);
      if ((G.state === 'play' && (!G.paused || mp())) || G.state === 'over') {
        update(G, snapshotInput(), dt);
        netTick(dt);
        audioTick();
      } else { for (const k of Object.keys(loops)) loopSet(k, 0); beamSound(false, 1); fusionSound(false, 0); }
      render();
    };

    G.hooks.debrief = debrief;
    G.hooks.arenaDeath = () => sendState();
    mainMenu();
    requestAnimationFrame(loop);
    setTimeout(() => wrap.focus(), 0);
  }

  document.addEventListener('DOMContentLoaded', () => start(document.getElementById('app')));
})();
