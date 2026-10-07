// Ambient sound (docs/specs/07-atmosphere.md § Ambient audio): a bed per
// biome and a layer per weather kind, all synthesised from white noise (no
// clips): each layer is noise through one filter, with a slow LFO wobbling the
// filter (`sweep`, Hz either way) and the level (`swell`, a share of `gain`).
//   filter: 'lowpass' | 'bandpass' | 'highpass', at `freq` Hz with `q`
//   gain: its level at full intensity; the beds sit well under the hum
//   lfo: Hz (slow: a gust, a swell)
// A weather layer scales with the weather's intensity. `muffle` (fog) closes
// a lowpass over the biome's bed, so the world goes dull.
export const BEDS = {
  dusk: [   // a warm low wind, a little air on top
    { filter: 'lowpass', freq: 320, q: 0.7, gain: 0.05, lfo: 0.07, sweep: 120, swell: 0.4 },
    { filter: 'bandpass', freq: 2400, q: 0.7, gain: 0.008, lfo: 0.13, sweep: 600, swell: 0.6 },
  ],
  ice: [   // a thin cold wind over a low hush
    { filter: 'bandpass', freq: 900, q: 1.2, gain: 0.03, lfo: 0.05, sweep: 400, swell: 0.5 },
    { filter: 'lowpass', freq: 120, q: 0.7, gain: 0.03, lfo: 0.04, sweep: 30, swell: 0.3 },
  ],
  volcanic: [   // the ground rumbling, and a sputter high up
    { filter: 'lowpass', freq: 90, q: 1, gain: 0.08, lfo: 0.03, sweep: 30, swell: 0.4 },
    { filter: 'highpass', freq: 3000, q: 0.7, gain: 0.006, lfo: 1.7, sweep: 0, swell: 0.9 },
  ],
};
export const WEATHER_LAYERS = {
  clear: [],
  rain: [   // the rain loop: a hiss, and the patter under it (thunder is its own sound)
    { filter: 'bandpass', freq: 4200, q: 0.4, gain: 0.06, lfo: 0.2, sweep: 500, swell: 0.15 },
    { filter: 'lowpass', freq: 600, q: 0.7, gain: 0.02, lfo: 0.3, sweep: 100, swell: 0.2 },
  ],
  snow: [   // the wind loop: gusts that whistle
    { filter: 'bandpass', freq: 700, q: 2, gain: 0.09, lfo: 0.11, sweep: 350, swell: 0.6 },
  ],
  dust: [   // the wind howl, and the grit in it
    { filter: 'bandpass', freq: 450, q: 6, gain: 0.1, lfo: 0.17, sweep: 250, swell: 0.5 },
    { filter: 'bandpass', freq: 2500, q: 0.5, gain: 0.04, lfo: 0.23, sweep: 800, swell: 0.4 },
  ],
  fog: [],   // the muffled bed: no layer of its own
};
export const MUFFLE = { fog: 500 };   // Hz: the lowpass over the bed in this weather
export const AMBIENCE_FADE = 1.5;   // s: how long a bed or layer takes to come in or go
