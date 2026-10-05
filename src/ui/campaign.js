import { CHASSIS, MECH_ORDER } from '../data/chassis.js';

// Campaign progress (docs/specs/04-campaign.md § Progression and saving),
// kept apart from the DOM so it is tested headlessly. Saved under:
//   camp.mission   the next unplayed mission (index)
//   camp.best      per mission: { won, time, objectives } (its best run)
//   camp.unlocked  the chassis the player can fly
// Earlier saves had `mech.mission` and `mech.best` (missions cleared); a save
// without `camp.mission` is migrated from those the first time it loads.
// `get(key, fallback)` and `set(key, value)` are the store's.
export const STRIP = 12;   // squares on the campaign strip

// Every chassis open after `cleared` missions (KESTREL and JACKAL from the start).
export const unlockedAfter = cleared => MECH_ORDER.filter(k => (CHASSIS[k].unlock || 0) <= cleared);

export function loadCampaign(get) {
  if (get('camp.mission', null) == null) {
    const cleared = Math.max(get('mech.mission', 0), get('mech.best', 0));
    return { mission: get('mech.mission', 0), best: Array.from({ length: cleared }, () => ({ won: true, time: null, objectives: null })), unlocked: unlockedAfter(cleared), migrated: true };
  }
  const unlocked = get('camp.unlocked', null);
  return { mission: get('camp.mission', 0), best: get('camp.best', []), unlocked: Array.isArray(unlocked) ? unlocked : unlockedAfter(0) };
}
export function saveCampaign(set, c) {
  set('camp.mission', c.mission); set('camp.best', c.best); set('camp.unlocked', c.unlocked);
}

// Mission n ended. A win keeps its best run (a faster win replaces a slower
// one), moves the next unplayed mission on and opens whatever that unlocks.
// Returns the chassis it opened, in selector order (usually none).
export function recordResult(c, n, { won, time, objectives }) {
  if (!won) return [];
  const was = c.best[n];
  if (!was?.won || was.time == null || time < was.time) c.best[n] = { won: true, time, objectives };
  c.mission = Math.max(c.mission, n + 1);
  const cleared = c.best.reduce((k, b, i) => (b?.won ? Math.max(k, i + 1) : k), 0);
  const fresh = unlockedAfter(cleared).filter(k => !c.unlocked.includes(k));
  c.unlocked = MECH_ORDER.filter(k => c.unlocked.includes(k) || fresh.includes(k));
  return fresh;
}

// RESTART CAMPAIGN: back to mission 1 with no results. Chassis already
// opened stay open: they were earned, and the selector would otherwise take
// a flown mech away.
export function restartCampaign(c) {
  c.mission = 0; c.best = [];
  return c;
}

// The strip's squares: done (won), current (the next unplayed), or locked.
export function stripSquares(c) {
  return Array.from({ length: STRIP }, (_, i) => (c.best[i]?.won ? 'done' : i === Math.min(c.mission, STRIP - 1) && c.mission < STRIP ? 'current' : i < c.mission ? 'done' : 'locked'));
}
// Which missions can be launched: any won one (replay) and the next unplayed.
export const canPlay = (c, n) => n <= c.mission;
