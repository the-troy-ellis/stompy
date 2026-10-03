import { keepRange, harass, useCover, coverWhenHot, ridge, brawler, holdLine, avoidEdge, avoidAllies, defaultPlan } from './behaviours.js';

// Per-chassis fighting styles (docs/specs/05-ai.md § Profiles): a plan of
// drivers and shapers from the behaviour library. CHASSIS[key].ai.profile
// names one; M2's chassis add 'sniper' and 'brawler'. The goal is that each
// chassis reads differently from across the map.
export const PROFILES = {
  // KESTREL: the all-rounder. Keeps its range, hides when hot or hurt.
  baseline: defaultPlan,
  // JACKAL: orbits close, flips on a hit, jumps behind you; hides only from its own heat.
  harass: () => ({ drive: [coverWhenHot, harass], shape: [avoidAllies, avoidEdge] }),
  // WARDEN: advances with the group at the slowest member's pace and holds its range.
  line: e => ({ drive: [keepRange(e.ch.pref)], shape: [holdLine, avoidAllies, avoidEdge] }),
  // BEANPOLE (M2): finds high ground with a view, then keeps its long range.
  sniper: e => ({ drive: [ridge, useCover, keepRange(e.ch.pref)], shape: [avoidAllies, avoidEdge] }),
  // PURPLE PUNCHER (M2): walks in and punches. Never retreats, never hides.
  brawler: () => ({ drive: [brawler], shape: [avoidAllies, avoidEdge], brawler: true }),
};

export const planFor = e => (PROFILES[e.ch.ai?.profile] || defaultPlan)(e);
