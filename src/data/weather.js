// Weather (docs/specs/07-atmosphere.md § Weather). Each kind scales the fog
// distances and the radar's reach (and so the AI's sight), and blows a wind
// (m/s) that carries smoke and missile trails. `biomes` is where it belongs.
// The particles and sounds come with each kind's own issue.
export const WEATHER = {
  clear: { fog: 1, radar: 1, wind: 0, biomes: ['dusk', 'ice', 'volcanic'] },
  rain: { fog: 0.7, radar: 0.9, wind: 4, biomes: ['dusk'] },
  snow: { fog: 0.5, radar: 0.8, wind: 2.5, biomes: ['ice'] },
  dust: { fog: 0.35, radar: 0.5, wind: 9, biomes: ['dusk', 'volcanic'] },
  fog: { fog: 0.3, radar: 0.6, wind: 0.5, biomes: ['ice', 'volcanic'] },
};
export const WEATHER_KINDS = Object.keys(WEATHER);
export const RADAR_RANGE = 800;   // m, in clear weather

// A match's weather: the kind, how strong (0..1), and a wind whose direction
// is fixed by the seed (so a mission's dust always blows the same way).
export function makeWeather(kind, seed = 1, intensity = 1) {
  const k = WEATHER[kind] ? kind : 'clear', w = WEATHER[k].wind * intensity;
  const a = (((seed >>> 0) * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
  return { kind: k, intensity, wind: [Math.sin(a) * w, Math.cos(a) * w] };
}
const factor = (G, f) => { const w = G.weather; if (!w) return 1; return 1 - (1 - WEATHER[w.kind][f]) * w.intensity; };
// The fog distances this weather leaves of the palette's [near, far].
export const fogOf = (G, out = [0, 0]) => { const f = factor(G, 'fog'); out[0] = G.pal.fog[0] * f; out[1] = G.pal.fog[1] * f; return out; };
// The radar's reach as a share of RADAR_RANGE; the AI's sight shrinks with it.
export const radarOf = G => factor(G, 'radar');
