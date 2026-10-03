import { DRY_GAP, VOICE } from '../data/voice.js';

// The cockpit voice (docs/vision.md § The voice): a pool per event, a seeded
// pick, no dry line twice in one mission, and at most one dry line a minute.
// `flat` replaces the pool's flat line (e.g. with the side of a lost limb).
// G.voice holds the mission's bookkeeping; resetMatch clears it.
export function voiceLine(G, key, { flat } = {}) {
  const pool = VOICE[key];
  if (!pool) return null;
  const v = G.voice || (G.voice = { lastDry: -Infinity, used: new Set() });
  const base = flat ?? pool[0];
  const fresh = pool.slice(1).filter(l => !v.used.has(l));
  if (!fresh.length || G.time - v.lastDry < DRY_GAP) return base;
  // The flat line is in the draw too, so dry lines are a treat rather than the rule.
  const line = G.rng.pick([base, ...fresh]);
  if (line !== base) { v.used.add(line); v.lastDry = G.time; }
  return line;
}

export function voice(G, key, opts = {}, force = true, delayMs = 0) {
  const line = voiceLine(G, key, opts);
  if (line) G.fx.say(line, force, delayMs);
  return line;
}
