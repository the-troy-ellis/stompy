import { norm } from '../util/math.js';

// Each biome's palette is its native light (the desert and the volcanic
// plain at dusk, the glacier by day). Time of day (docs/specs/07-atmosphere.md
// § Time of day) comes as variants: `night` and `dawn` bring their own sky
// (zen, hor), fog, light direction and a `shade` that dims everything lit
// (emissive things, fire and lamps, keep their glow). The ground colours
// (low, mid, high, rock) stay the biome's, baked into the terrain mesh, so a
// ramp from dusk into night only blends a few numbers per frame.
export const PALS = {
  dusk: { name: 'Dusk desert', zen: [0.16, 0.1, 0.3], hor: [0.9, 0.56, 0.38], low: [0.56, 0.36, 0.23], mid: [0.74, 0.52, 0.31],
    high: [0.92, 0.8, 0.62], rock: [0.42, 0.3, 0.25], fog: [180, 1150], light: norm([0.4, 0.75, -0.5]),
    night: { zen: [0.02, 0.02, 0.07], hor: [0.13, 0.11, 0.2], fog: [110, 720], light: norm([-0.35, 0.8, 0.45]), shade: [0.34, 0.36, 0.52] },
    dawn: { zen: [0.24, 0.28, 0.5], hor: [0.98, 0.72, 0.58], fog: [160, 1000], light: norm([0.85, 0.3, 0.2]), shade: [0.95, 0.86, 0.86] } },
  ice: { name: 'Glacier', zen: [0.08, 0.14, 0.32], hor: [0.66, 0.75, 0.86], low: [0.58, 0.66, 0.75], mid: [0.8, 0.86, 0.92],
    high: [0.98, 0.99, 1], rock: [0.42, 0.47, 0.55], fog: [120, 900], light: norm([-0.5, 0.7, -0.3]),
    night: { zen: [0.01, 0.02, 0.07], hor: [0.15, 0.2, 0.3], fog: [90, 620], light: norm([0.4, 0.85, 0.3]), shade: [0.3, 0.36, 0.52] },
    dawn: { zen: [0.2, 0.24, 0.46], hor: [0.95, 0.76, 0.76], fog: [110, 850], light: norm([0.85, 0.3, -0.2]), shade: [0.96, 0.88, 0.9] } },
  volcanic: { name: 'Volcanic plain', zen: [0.08, 0.02, 0.03], hor: [0.6, 0.22, 0.1], low: [0.2, 0.14, 0.13], mid: [0.32, 0.22, 0.18],
    high: [0.5, 0.34, 0.25], rock: [0.13, 0.1, 0.1], fog: [140, 1000], light: norm([0.3, 0.6, 0.6]),
    night: { zen: [0.02, 0.0, 0.01], hor: [0.3, 0.08, 0.03], fog: [100, 700], light: norm([-0.3, 0.75, 0.5]), shade: [0.5, 0.36, 0.34] },
    dawn: { zen: [0.16, 0.08, 0.12], hor: [0.82, 0.42, 0.22], fog: [130, 900], light: norm([0.85, 0.35, 0.1]), shade: [0.92, 0.8, 0.76] } },
};
export const TIMES = ['day', 'dusk', 'night', 'dawn'];
const NO_SHADE = [1, 1, 1];

// The palette for a biome at a time of day, as a fresh object (the match
// mutates it while a ramp runs). 'day' and 'dusk' are the biome's own light.
export function palAt(key, time) {
  const base = PALS[key] || PALS.dusk, v = time === 'night' || time === 'dawn' ? base[time] : null;
  const pick = f => [...(v ? v[f] : base[f])];
  return { name: base.name, low: base.low, mid: base.mid, high: base.high, rock: base.rock,
    zen: pick('zen'), hor: pick('hor'), fog: pick('fog'), light: pick('light'), shade: [...(v ? v.shade : NO_SHADE)] };
}

// Blend palette `a` toward `b` by t (0..1) into `out` (a palAt object): the
// sky, fog, light and shade move; the ground colours are the biome's.
export function blendPal(a, b, t, out) {
  for (const f of ['zen', 'hor', 'fog', 'shade']) for (let i = 0; i < a[f].length; i++) out[f][i] = a[f][i] + (b[f][i] - a[f][i]) * t;
  const l = out.light;
  for (let i = 0; i < 3; i++) l[i] = a.light[i] + (b.light[i] - a.light[i]) * t;
  const n = Math.hypot(l[0], l[1], l[2]) || 1;
  l[0] /= n; l[1] /= n; l[2] /= n;
  return out;
}
