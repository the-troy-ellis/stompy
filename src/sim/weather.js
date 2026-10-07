import { WEATHER, LIGHTNING, strikeAt } from '../data/weather.js';

// Once a frame (update.js): strikes that have come due flash, and their
// thunder rolls in later, louder for a near one.
export function tickWeather(G) {
  const w = G.weather;
  if (!w || !WEATHER[w.kind].lightning) return;
  for (let s = strikeAt(w.seed, w.strike); s.at <= G.time; s = strikeAt(w.seed, ++w.strike)) {
    w.flashAt = s.at;
    const [a, b] = LIGHTNING.thunder;
    w.thunder.push({ at: s.at + a + (b - a) * s.dist, dist: s.dist });
  }
  while (w.thunder.length && w.thunder[0].at <= G.time) G.fx.sfx.thunder(w.thunder.shift().dist);
}
