// The sub-bass thump under every impact, and the hum ducking that makes room
// for it (docs/specs/13-thunk.md § Audio layer). One oscillator voice: a sine
// between 45 and 60 Hz with a 10 ms attack and a 150-400 ms decay, through a
// soft clipper so stacked thumps saturate instead of clipping. `duck` pulls
// the continuous loops (reactor hum, jets, servo) down for a moment.

const { min, max } = Math;

// What a thump of a given weight sounds like. Heavier: lower, longer, louder.
// Pure, so the tests can pin it.
export function thumpParams(bass) {
  const b = min(1.5, max(0, bass));
  return { freq: 60 - 15 * min(1, b), decay: 0.15 + 0.25 * min(1, b), level: min(1, 0.5 * b + 0.15 * b * b) };
}
// The ducking curve: down to (1 - frac) at once, held, then back over the release.
export const DUCK_HOLD = 0.25, DUCK_RELEASE = 0.4;
export const duckLevel = frac => 1 - min(0.95, max(0, frac));

export function createThump({ ctx, out, spatial }) {
  let voice = null, bus = null;
  const build = c => {
    const osc = c.createOscillator(), env = c.createGain(), clip = c.createWaveShaper();
    osc.type = 'sine'; osc.frequency.value = 55; env.gain.value = 0;
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 127.5) - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
    clip.curve = curve; clip.oversample = '2x';
    osc.connect(env).connect(clip).connect(out());
    osc.start();
    voice = { c, osc, env };
  };
  return {
    // Everything continuous goes through this gain so one call can duck it all.
    loopBus() {
      const c = ctx();
      if (!c) return null;
      if (!bus || bus.context !== c) { bus = c.createGain(); bus.gain.value = 1; bus.connect(out()); }
      return bus;
    },
    hit(bass, at = null) {
      const c = ctx();
      if (!c || !(bass > 0.03)) return;
      const sp = spatial(at, 40);
      if (!sp) return;
      if (!voice || voice.c !== c) build(c);
      const { freq, decay, level } = thumpParams(bass * sp.g), t = c.currentTime, g = voice.env.gain;
      voice.osc.frequency.setTargetAtTime(freq, t, 0.01);
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(max(g.value, level), t + 0.01);
      g.exponentialRampToValueAtTime(0.0001, t + 0.01 + decay);
    },
    duck(frac) {
      const b = this.loopBus();
      if (!b || !(frac > 0.02)) return;
      const t = b.context.currentTime, g = b.gain, level = min(g.value, duckLevel(frac));
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(level, t + 0.02);
      g.setValueAtTime(level, t + 0.02 + DUCK_HOLD);
      g.linearRampToValueAtTime(1, t + 0.02 + DUCK_HOLD + DUCK_RELEASE);
    },
  };
}
