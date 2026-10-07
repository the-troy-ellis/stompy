// Weather (docs/specs/07-atmosphere.md § Weather). Each kind scales the fog
// distances and the radar's reach (and so the AI's sight), and blows a wind
// (m/s) that carries smoke and missile trails. `biomes` is where it belongs.
// The particles and sounds come with each kind's own issue.
export const WEATHER = {
  clear: { fog: 1, radar: 1, wind: 0, biomes: ['dusk', 'ice', 'volcanic'] },
  rain: { fog: 0.7, radar: 0.9, wind: 4, biomes: ['dusk'], dim: 0.8, lightning: true },   // dim: the palette darkens
  snow: { fog: 0.5, radar: 0.8, wind: 2.5, biomes: ['ice'], whiten: 0.35 },   // whiten: the sky and fog go pale
  dust: { fog: 0.35, radar: 0.5, wind: 9, biomes: ['dusk', 'volcanic'], haze: 0.6 },
  fog: { fog: 0.3, radar: 0.6, wind: 0.5, biomes: ['ice', 'volcanic'], haze: 0.8 },   // haze: the sky overhead greys into the horizon
};
export const WEATHER_KINDS = Object.keys(WEATHER);
export const RADAR_RANGE = 800;   // m, in clear weather

// A match's weather: the kind, how strong (0..1), and a wind whose direction
// is fixed by the seed (so a mission's dust always blows the same way).
export function makeWeather(kind, seed = 1, intensity = 1) {
  const k = WEATHER[kind] ? kind : 'clear', w = WEATHER[k].wind * intensity;
  const a = (((seed >>> 0) * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
  return { kind: k, intensity, wind: [Math.sin(a) * w, Math.cos(a) * w], seed, strike: 0, flashAt: -1e9, thunder: [] };
}

// Lightning (rain): a strike every 8-20 s, a 120 ms flash, thunder 0.5-3 s
// later by how far off it was. The schedule is a pure function of the seed,
// so two arena screens on the same seed and game time flash together.
export const LIGHTNING = { every: [8, 20], flash: 0.12, thunder: [0.5, 3] };
const STRIKES = new Map();   // seed -> [{ at, dist }], grown as a match runs
export function strikeAt(seed, k) {
  let list = STRIKES.get(seed);
  if (!list) { list = []; STRIKES.set(seed, list); if (STRIKES.size > 32) STRIKES.delete(STRIKES.keys().next().value); }
  while (list.length <= k) {
    const n = list.length, h = i => ((((seed >>> 0) * 374761393 + n * 668265263 + i * 2246822519) >>> 0) ^ 0x5bd1e995) >>> 0;
    const r1 = (Math.imul(h(1), 2654435761) >>> 0) / 4294967296, r2 = (Math.imul(h(2), 2246822519) >>> 0) / 4294967296;
    const prev = n ? list[n - 1].at : 0, [a, b] = LIGHTNING.every;
    list.push({ at: prev + a + (b - a) * r1, dist: r2 });
  }
  return list[k];
}
// How bright the latest flash still is (0..1).
export const flashOf = G => { const w = G.weather; return w && WEATHER[w.kind].lightning ? Math.max(0, 1 - (G.time - w.flashAt) / LIGHTNING.flash) : 0; };
const factor = (G, f) => { const w = G.weather; if (!w) return 1; return 1 - (1 - WEATHER[w.kind][f]) * w.intensity; };
// The fog distances this weather leaves of the palette's [near, far].
export const fogOf = (G, out = [0, 0]) => { const f = factor(G, 'fog'); out[0] = G.pal.fog[0] * f; out[1] = G.pal.fog[1] * f; return out; };
// The radar's reach as a share of RADAR_RANGE; the AI's sight shrinks with it.
export const radarOf = G => factor(G, 'radar');
