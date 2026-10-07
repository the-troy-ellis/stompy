import { BEDS, WEATHER_LAYERS, MUFFLE, AMBIENCE_FADE } from '../data/ambience.js';

// The ambient beds (data/ambience.js) as Web Audio: per layer, the shared
// white-noise buffer looping from its own offset, through its filter, with
// an LFO on the filter's frequency and another on its level, into the bed's
// muffle lowpass and on to the loop bus (so impacts duck it like the hum).
// `tick(G)` keeps the right set playing: a new biome or weather fades the
// old layers out over AMBIENCE_FADE and stops them, and fades the new ones
// in. No context (sound off, or no gesture yet): nothing is made.
export function createAmbience({ ac, bus, noise }) {
  let ctx = null, muffle = null, master = null, key = '', layers = [];
  const build = (c, spec, level) => {
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), sweep = c.createGain(), swell = c.createGain();
    src.buffer = noise(); src.loop = true;
    f.type = spec.filter; f.frequency.value = spec.freq; f.Q.value = spec.q;
    g.gain.value = 0;
    lfo.frequency.value = spec.lfo;
    sweep.gain.value = spec.sweep; swell.gain.value = spec.gain * spec.swell * level;
    lfo.connect(sweep).connect(f.frequency);
    lfo.connect(swell).connect(g.gain);
    src.connect(f).connect(g).connect(muffle);
    src.start(c.currentTime, Math.random() * (src.buffer.duration - 0.01));   // each from its own place, so two layers don't match
    lfo.start(c.currentTime);
    g.gain.setTargetAtTime(spec.gain * level, c.currentTime, AMBIENCE_FADE / 3);
    return { src, lfo, g, swell, spec };
  };
  const drop = (c, ls) => {
    for (const l of ls) {
      l.g.gain.cancelScheduledValues(c.currentTime);
      l.g.gain.setTargetAtTime(0, c.currentTime, AMBIENCE_FADE / 3);
      l.swell.gain.setTargetAtTime(0, c.currentTime, AMBIENCE_FADE / 3);
      l.src.stop(c.currentTime + AMBIENCE_FADE * 2); l.lfo.stop(c.currentTime + AMBIENCE_FADE * 2);
    }
  };
  return {
    // on: false (the menu, a hidden tab) fades it all down; the layers stay.
    tick(G, on = true) {
      const c = ac();
      if (!c) { if (master) master.gain.value = 0; return; }
      if (ctx !== c) {   // a new context: a fresh graph
        ctx = c; key = ''; layers = [];
        master = c.createGain(); master.gain.value = 0;
        muffle = c.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
        muffle.connect(master).connect(bus());
      }
      const w = G.weather, kind = w?.kind || 'clear', level = w ? w.intensity : 0, biome = G.biome, k = `${biome}/${kind}/${level.toFixed(2)}`;
      if (k !== key && biome) {
        key = k;
        drop(c, layers);
        layers = [...(BEDS[biome] || []).map(s => build(c, s, 1)), ...(WEATHER_LAYERS[kind] || []).map(s => build(c, s, level))];
        muffle.frequency.setTargetAtTime(MUFFLE[kind] ? 20000 - (20000 - MUFFLE[kind]) * level : 20000, c.currentTime, AMBIENCE_FADE / 3);
      }
      master.gain.setTargetAtTime(on && biome ? 1 : 0, c.currentTime, 0.3);
    },
  };
}
