// The simulation's randomness. Seeded from the match seed so a mission
// replays identically, tests are reproducible, and (later) co-op clients
// agree. mulberry32: 32-bit state, fast, good enough.
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const rng = {
    seed,
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) { return a + rng.next() * (b - a); },
    int(n) { return Math.floor(rng.next() * n); },
    pick(list) { return list[Math.floor(rng.next() * list.length)]; },
    chance(p) { return rng.next() < p; },
    sign() { return rng.next() < 0.5 ? 1 : -1; },
  };
  return rng;
}
