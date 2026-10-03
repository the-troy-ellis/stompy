import { clampN, rnd, wrapA } from '../util/math.js';
import { msg } from '../sim/effects.js';
import { viewYaw } from '../sim/geom.js';
import { MELT_MAX, beamMult } from '../sim/beams.js';
import { createThump } from './thump.js';
import { HEAT, hotFrac } from '../data/feel.js';

const { sin, cos, atan2, min, max, abs, PI, random, hypot, floor } = Math;

// Browsers only allow audio after a gesture; Sound.unlock() is the dance.
let soundOn = () => true;
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
  document.addEventListener(ev, () => { if (soundOn()) Sound.unlock(); }, { capture: true, passive: true });
}

// Everything that makes a noise: samples over synthesis, spatialised from
// the cockpit, the continuous loops, the cockpit voice, and the two
// weapon tones. createAudio(app) needs app.G and app.prefs.
export function createAudio(app) {
  const G = app.G, prefs = app.prefs;
  const settings = prefs;   // sound on/off lives in the prefs
  soundOn = () => prefs.sound;
  /* ---------- sound & voice ---------- */

  // Samples are CC0 clips from Kenney's Sci-fi and Impact packs (see
  // sounds/stompy/). Each sfx layers samples over the original synthesis,
  // which also stands in if the samples haven't loaded.
  let noiseBuf = null, bus = null;
  const ac = () => (prefs.sound ? Sound.ctx : null);
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

  const thumper = createThump({ ctx: ac, out, spatial });

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
      src.connect(g).connect(thumper.loopBus() || out());   // through the duckable bus
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
    // Taking a hit: armour plate ringing. Arms ring high, legs thud, the torso is dull.
    clang(sec = 'T') {
      const arm = sec === 'LA' || sec === 'RA', leg = sec === 'LL' || sec === 'RL';
      const rate = arm ? 1.4 : leg ? 0.9 : 0.75;
      play('step', { vol: 0.8, rate: rate * 1.15, vary: 0.12 }); play('plate', { vol: arm ? 0.6 : 0.4, rate: rate * 0.9 });
      if (leg || !arm) this.osc('sine', leg ? 70 : 55, 30, 0.2, 0.12);
      if (!buffers.step) { this.osc('square', 240 * rate, 120 * rate, 0.12, 0.05); this.noise(0.15, 0.15, 4000, 800, 'highpass'); }
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
    // A punch landing (the clip, a crunch, a sub thump) or swinging at nothing (a quiet whoosh).
    punch(at, hit) {
      const o = { at, ref: 40 };
      if (hit) { play('punch', { ...o, vol: 1.0, rate: 0.8 }); play('crunch', { ...o, vol: 0.4, rate: 1.1 }); this.osc('sine', 90, 30, 0.3, 0.3, o); }
      else { play('punch', { ...o, vol: 0.3, rate: 1.3, vary: 0.04 }); this.noise(0.25, 0.08, 1200, 300, 'bandpass', o); }
    },
    // The beat before a mech blows: a rising whine and nothing else.
    whine(at) { const o = { at, ref: 60 }; this.osc('sawtooth', 320, 1500, 0.26, 0.05, o); this.osc('sine', 160, 900, 0.26, 0.06, o); },
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
    if (!prefs.voice || !prefs.sound || !window.speechSynthesis) return;
    const now = performance.now();
    if (!force && (now - (said[text] || 0) < 6000 || now - lastSaid < 1200)) return;
    said[text] = lastSaid = now;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = voices.find(v => /^en/i.test(v.lang) && /female|zira|samantha|victoria|karen|serena|susan|hazel|libby|aria|jenny/i.test(v.name))
        || voices.find(v => /^en/i.test(v.lang));
      if (v) u.voice = v;
      u.rate = 1.05; u.pitch = 1.05; u.volume = prefs.voiceVol ?? 0.9;
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

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


  // Continuous layers follow the sim state: reactor hum, jets, torso servo, laser bite.
  function audioTick() {
    const P = G.player, live = P.alive && !P.shutdown, pace = min(1, abs(P.speed) / (P.maxSpeed ?? P.ch.speed));
    const hot = P.shutdown ? 0 : hotFrac(P.heat);   // the reactor hum rises as it runs hot
    loopSet('hum_loop', P.alive ? (P.shutdown ? 0.03 : (0.07 + 0.13 * pace) * (1 + HEAT.hum * hot)) : 0, P.shutdown ? 0.5 : (0.72 + 0.4 * pace) * (1 + HEAT.humRate * hot));
    const jetting = live && P.jetting && P.fuel > 0;
    loopSet('jet_loop', jetting ? 0.32 : G.guide ? 0.24 : 0, jetting ? 0.85 : G.guide ? 1.7 : 0.85);
    const twistRate = G.twistRate || 0;
    loopSet('servo_loop', live ? min(0.13, twistRate * 0.07) : 0, 0.75 + min(0.6, twistRate * 0.25));
    beamSound(P.beaming && !G.paused, beamMult(P));
  }


  // The feel table's sound columns: bass is the sub thump voice, duck pulls
  // the loops down for a moment, haptic is a buzz on touch (phone speakers
  // can't do the bass; the buzz does that job there).
  function thump(bass, duck, haptic, at) {
    thumper.hit(bass, at);
    thumper.duck(duck);
    if (haptic > 2 && G.touchUI && prefs.haptics !== false) { try { navigator.vibrate?.(min(100, Math.round(haptic))); } catch { /* unsupported */ } }
  }
  return { Sound, settings, loadSamples, play, loopSet, loops, sfx, say, beamSound, fusionSound, thump, tick: audioTick };
}
