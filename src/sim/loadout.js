import { CHASSIS, HPK } from '../data/chassis.js';
import { WEAPONS, CAT_OF } from '../data/weapons.js';
import { SYSTEMS, SYSTEM_KEYS, SINK_PER_LEVEL, ARMOUR_HP, ARMOUR_SPEED } from '../data/systems.js';

// Mechlab-lite (docs/specs/02-mechlab.md § Data). A loadout is
// { hp: { <hardpoint id>: <weapon key> | null }, sys: { sinks, armour, jets } }.
// Chassis identity is the hardpoint map; the loadout only picks which weapon
// of the hardpoint's category sits in it, and the system levels.

const chassisOf = c => (typeof c === 'string' ? CHASSIS[c] : c);
const clampInt = (v, lo, hi, def) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : def);

export function stockLoadout(chassis) {
  const ch = chassisOf(chassis);
  return { hp: Object.fromEntries(ch.hardpoints.map(h => [h.id, h.stock])), sys: { ...ch.systems } };
}

// The weapons that may sit in a hardpoint: every weapon of its category, and EMPTY (null).
export const choicesFor = hp => [...Object.keys(WEAPONS).filter(k => CAT_OF[k] === hp.cat), null];

export function tonsOf(chassis, loadout) {
  const ch = chassisOf(chassis);
  let t = ch.frame;
  for (const h of ch.hardpoints) { const w = loadout.hp[h.id]; if (w) t += WEAPONS[w].tons; }
  for (const k of SYSTEM_KEYS) t += (loadout.sys[k] || 0) * SYSTEMS[k].tons;
  return Math.round(t * 10) / 10;
}

// Anything can come in (a stale save, a hand-made arena message): unknown
// hardpoints are dropped, a weapon that is unknown or of the wrong category
// goes back to stock, missing hardpoints are stock, levels are clamped.
// `ok` is false when it is over the budget; the loadout is still returned.
export function validate(chassis, loadout) {
  const ch = chassisOf(chassis), src = loadout && typeof loadout === 'object' ? loadout : {};
  const inHp = src.hp && typeof src.hp === 'object' ? src.hp : {}, inSys = src.sys && typeof src.sys === 'object' ? src.sys : {};
  const hp = {};
  for (const h of ch.hardpoints) {
    const w = inHp[h.id];
    hp[h.id] = w === null ? null : WEAPONS[w] && CAT_OF[w] === h.cat ? w : h.stock;
  }
  const sys = {};
  for (const k of SYSTEM_KEYS) sys[k] = clampInt(inSys[k], 0, SYSTEMS[k].max, ch.systems[k]);
  const out = { hp, sys }, tons = tonsOf(ch, out);
  return { loadout: out, tons, ok: tons <= ch.tons };
}

// The weapon list in HUD order: the hardpoints that are filled, then the fusion cannon.
export function weaponList(chassis, loadout) {
  const ch = chassisOf(chassis);
  const list = ch.hardpoints.filter(h => loadout.hp[h.id]).map(h => [loadout.hp[h.id], h.loc]);
  return [...list, ['fusion', 'T']];
}

// Derived stats live on the mech, never on CHASSIS.
export function derived(chassis, loadout) {
  const ch = chassisOf(chassis), s = loadout.sys;
  const hpScale = 1 + ARMOUR_HP * s.armour;
  return {
    sink: ch.sink + SINK_PER_LEVEL * s.sinks,
    maxSpeed: ch.speed * (1 - ARMOUR_SPEED * s.armour),
    hp: Object.fromEntries(HPK.map(k => [k, Math.round(ch.hp[k] * hpScale)])),
    jets: s.jets,
  };
}

// For the FIT screen's bars: firepower (sum of fp), heat balance (sink minus
// the heat of everything firing flat out), speed, total armour, tons.
export function stats(chassis, loadout) {
  const ch = chassisOf(chassis), d = derived(ch, loadout);
  let firepower = 0, heat = 0;
  for (const [w] of weaponList(ch, loadout)) {
    const def = WEAPONS[w];
    if (def.kind === 'fusion') continue;
    firepower += def.fp;
    heat += def.hps || def.heat / def.cd;
  }
  return { firepower, heatBalance: d.sink - heat, speed: d.maxSpeed, armour: HPK.reduce((a, k) => a + d.hp[k], 0), tons: tonsOf(ch, loadout) };
}

// Fit a mech: its weapons (same shape as always), its sink, top speed,
// armour and jets. Weapon cooldowns are staggered with the match's seeded
// RNG in list order, as they always were.
export function applyLoadout(G, m, loadout) {
  const ch = m.ch, lo = validate(ch, loadout).loadout, d = derived(ch, lo), rng = G.rng;
  m.loadout = lo;
  m.weapons = weaponList(ch, lo).map(([w, mount], i) => ({ type: w, def: WEAPONS[w], mount, cd: rng.next() * 0.5, ammo: WEAPONS[w].ammo || null, dead: false, side: i }));
  m.sink = d.sink; m.maxSpeed = d.maxSpeed; m.jets = d.jets;
  m.hp = { ...d.hp }; m.max = { ...d.hp };
  return m;
}

// One tap on a FIT row: the next (d = 1) or previous weapon of the
// hardpoint's category, EMPTY included, wrapping round. Returns a new loadout.
export function cycleWeapon(chassis, loadout, id, d) {
  const h = chassisOf(chassis).hardpoints.find(x => x.id === id);
  if (!h) return loadout;
  const c = choicesFor(h), i = c.indexOf(loadout.hp[id] ?? null);
  return { hp: { ...loadout.hp, [id]: c[(i + d + c.length) % c.length] }, sys: { ...loadout.sys } };
}
export function cycleSystem(loadout, key, d) {
  const n = SYSTEMS[key].max + 1;
  return { hp: { ...loadout.hp }, sys: { ...loadout.sys, [key]: ((loadout.sys[key] || 0) + d + n) % n } };
}
