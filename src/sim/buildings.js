// The base's buildings by kind (docs/specs/36-building-registry.md): which of
// G.base's lists each kind lives in, what it starts with when it joins the
// base, and which a raid goes for. A new kind of building is one row here,
// not a line in every place that adds, removes or looks over the base's
// buildings.
import { LINE } from '../data/construct.js';

// list: G.base's array for the kind; one: its single slot instead (the factory).
// fresh(e, taken): its working state on joining; `taken`: carried in from
// outside (sim/steal.js), keeping what it had where it had any.
export const KINDS = {
  silo: { list: 'silos' },
  beacon: { list: 'beacons' },
  shop: { list: 'shops', fresh: e => { e.press = null; } },
  plant: { list: 'plants', fresh: e => { e.brew = null; } },
  lab: { list: 'labs', fresh: e => { e.work = null; } },
  armory: { list: 'armories', fresh: e => { e.press = null; } },
  line: { list: 'lines', fresh: (e, taken) => { if (!taken || !e.bays) e.bays = new Array(LINE.bays).fill(null); if (!taken || !e.queue) e.queue = []; } },
  wall: { list: 'walls' },
  bay: { list: 'bays' },
  factory: { one: 'factory', fresh: e => { e.job = null; } },
  tower: { list: 'towers', fresh: e => { e.cd = 0; e.headYaw = e.headYaw || 0; } },   // a gun on a post (sim/towers.js, spec 32 part 2)
};

// What a raid goes for, in this order (sim/raid.js). Not walls: raiders go
// round or through (spec 21). Labs and weapon shops aren't on it either, as
// before this table; whether they should be is the owner's call (spec 36).
export const RAID_KINDS = ['silo', 'factory', 'bay', 'beacon', 'shop', 'plant', 'line', 'tower'];   // the tower last: one that shoots back is fair game

// Into the base: its working state, and its list (or slot). A taken factory
// only fills the slot when the base's own is gone.
export function enlist(G, kind, e, taken = false) {
  const K = KINDS[kind] || KINDS.bay, b = G.base;   // anything unlisted is a bay, as placeSite had it
  if (K.one) { if (taken && b[K.one]?.alive) return; K.fresh?.(e, taken); b[K.one] = e; return; }
  K.fresh?.(e, taken);
  (b[K.list] ||= []).push(e);
}

// Out of the base (carried off): out of every list and slot it was in.
export function delist(G, e) {
  const b = G.base;
  for (const K of Object.values(KINDS)) {
    if (K.one) { if (b[K.one] === e) b[K.one] = null; }
    else if (b[K.list]?.includes(e)) b[K.list] = b[K.list].filter(o => o !== e);
  }
}

// The base's buildings of these kinds, in that order (each list in its own order).
export function buildingsOf(G, kinds = Object.keys(KINDS)) {
  const b = G.base, out = [];
  if (!b) return out;
  for (const k of kinds) { const K = KINDS[k]; if (K.one) { if (b[K.one]) out.push(b[K.one]); } else for (const e of b[K.list] || []) out.push(e); }
  return out;
}
