import { LINE, PARTS, RECIPES, CONSTRUCT, FIGHTERS, KNOWN } from '../data/construct.js';
import { CHASSIS } from '../data/chassis.js';
import { WEAPONS, CAT_OF } from '../data/weapons.js';
import { NAMES } from '../data/names.js';
import { applyLoadout, stockLoadout } from './loadout.js';
import { newMech } from './state.js';
import { park, crewOf } from './crew.js';
import { feel } from './feel.js';
import { particle, msg } from './effects.js';
import { shiftMech } from './walkView.js';
import { works } from './down.js';

// Production (docs/specs/33-production.md part 2). Built things are
// physical: every part is a thing on the ground, G.base.things =
// [{ part, at, by, claim }], `at` the building whose pile it's in (null while
// a hauler carries it, `by`), `claim` the hauler on its way for it.
//
// A machine shop (`press`: { part, t } or null) presses, from the pool's ore,
// the part the base's assembly lines will want next and nobody has made yet,
// one every LINE.press s, onto its pile. Haulers carry parts to a line
// (sim/miner.js `carry`). An assembly line has LINE.bays bays in a row
// (`bays`: a job or null) and a few mechs waiting (`queue`, kinds): a job
// { kind, shell, has, t } goes bay by bay, legs, body, core, arms; each bay
// takes its part off the line's pile (`has`), takes LINE.bayTime, and passes
// the mech on. The mech being made (`shell`) is a real mech kept off the field
// with only `show` of its parts drawn (render/scene.js), and off the last bay
// it walks out and joins the crew.

const { sin, cos, floor, min } = Math;
const NEAR = 40;   // m: a press or a bay's thunk reaches you this far off

// A building's frame: `along` its long side (its own +z), `across` it.
const frame = e => ({ ax: sin(e.yaw), az: cos(e.yaw), cx: cos(e.yaw), cz: -sin(e.yaw) });
const at = (e, across, along) => { const f = frame(e); return [e.x + f.cx * across + f.ax * along, e.z + f.cz * across + f.az * along]; };
// Where bay `i` of a line stands, and where its mechs walk out.
export const bayAt = (line, i) => at(line, 0, (i - (LINE.bays - 1) / 2) * 10);
export const exitAt = line => at(line, 0, (LINE.bays / 2) * 10 + 6);
// Where the `i`th thing in a building's pile sits: rows of four beside it.
export function pileAt(e, i) {
  const side = e.tags.includes('line') ? 10 : e.radius + 3, row = floor(i / 4);
  return at(e, side + row * 3, ((i % 4) - 1.5) * 3 - (e.tags.includes('line') ? 8 : 0));
}

// Where a thing is: on its hauler, in its pile, or loose where it was dropped.
export function thingAt(G, t) {
  if (t.by) return [t.by.x, t.by.z];
  if (t.at) return pileAt(t.at, G.base.things.filter(o => o.at === t.at).indexOf(t));
  return [t.x, t.z];
}
// The part a hauler should bring, and where: the nearest thing a live line
// wants that isn't at a line, on a hauler or claimed by another hauler.
// { t, line } or null.
export function carryFor(G, m) {
  const b = G.base, claimed = t => t.claim && t.claim !== m && t.claim.alive && t.claim.carryFor === t;
  let best = null, bd = Infinity;
  for (const line of b.lines) {
    if (!line.alive || line.site) continue;
    const want = lineWants(line, G);
    for (const t of b.things) {   // what's there, or on its way there, already
      if (t.at !== line && t.to !== line && !(claimed(t) && t.for === line)) continue;
      const k = want.indexOf(t.part);
      if (k >= 0) want.splice(k, 1);
    }
    // The part it wants soonest that there is one of, the nearest such; the
    // wants come furthest-on first, so a bay waiting gets its part first.
    for (const part of want) {
      for (const t of b.things) {
        if (t.part !== part || t.by || t.at?.tags.includes('line') || claimed(t)) continue;
        const [x, z] = thingAt(G, t), d = Math.hypot(x - m.x, z - m.z);
        if (d < bd) { best = { t, line }; bd = d; }
      }
      if (best) return best;
    }
  }
  return best;
}
// Picked up, and put down: in a line's pile, or loose on the ground.
export function pickUp(t, m, line) { t.at = null; t.by = m; t.to = line; t.claim = null; m.carry = t; m.carryFor = null; }
export function putDown(G, m, line = null) {
  const t = m.carry;
  m.carry = null;
  if (!t) return;
  t.by = null; t.to = null;
  if (line?.alive) t.at = line; else { t.at = null; t.x = m.x; t.z = m.z; }
}

// What a mech takes in bay `i`: its legs, its body, a core, its arms.
export const bayPart = (kind, i) => (i === 2 ? 'core' : RECIPES[kind][i < 2 ? i : 2]);
// The weapons worked out this mission (spec 33 § The weapon lab): the
// mission's `base.known`, or KNOWN, and what the lab has done since.
export const knownOf = G => (G?.base ? (G.base.known ||= new Set(KNOWN)) : new Set(KNOWN));
// A fighter's guns, a hardpoint each in its order: the stock weapon if it's
// worked out, else the first worked-out one of its kind; null (EMPTY) if none is.
export function gunsFor(G, kind) {
  const known = knownOf(G);
  return CHASSIS[kind].hardpoints.map(h => (known.has(h.stock) ? h.stock : [...known].find(w => CAT_OF[w] === h.cat && w !== 'fusion') || null));
}
// Everything bay `i` takes: its part, and for a fighter's last bay its guns
// too (`plan`: the guns fixed when it got there, else as they'd be now).
export function bayParts(G, kind, i, plan = null) {
  const p = bayPart(kind, i);
  if (i < LINE.bays - 1 || !FIGHTERS.includes(kind)) return [p];
  return [p, ...(plan || gunsFor(G, kind)).filter(Boolean).map(w => `gun.${w}`)];
}
export const thingsAt = (G, e) => G.base.things.filter(t => t.at === e);

// Put a mech of `kind` in a line's queue. False (and why, for the player) if
// it can't take it: the line's not up, it's not a mech it makes, or it's full.
export function queueMake(G, line, kind) {
  if (!line?.alive || line.site || !RECIPES[kind] || line.queue.length >= LINE.wait) return false;
  line.queue.push(kind);
  return true;
}
// Take the `i`th waiting mech back out.
export function unqueue(line, i) { line.queue.splice(i, 1); }

// The parts a line still wants, in the order it will want them: the mechs in
// its bays from the furthest on, then the ones waiting.
export function lineWants(line, G = null) {
  const want = [];
  for (let i = LINE.bays - 1; i >= 0; i--) {
    const j = line.bays[i];
    if (!j) continue;
    for (let k = j.has ? i + 1 : i; k < LINE.bays; k++) {
      const need = bayParts(G, j.kind, k, j.plan);
      if (k === i) for (const p of j.got || []) { const n = need.indexOf(p); if (n >= 0) need.splice(n, 1); }   // what this bay has had already
      want.push(...need);
    }
  }
  for (const kind of line.queue) for (let k = 0; k < LINE.bays; k++) want.push(...bayParts(G, kind, k));
  return want;
}
// The first part the base's lines want that no thing on the ground (or on a
// hauler, or in a press) is there for yet: what a shop presses next. Null if none.
const maker = p => (p === 'core' ? 'core' : PARTS[p].kind === 'gun' ? 'gun' : 'part');   // who makes it: the plant, the weapon shop, the machine shop
export function nextPart(G, what = 'part') {   // what: 'core' (true, as before) the isotope plant's, 'gun' the weapon shop's, 'part' a machine shop's
  if (what === true) what = 'core';
  const spare = {};
  for (const t of G.base.things) spare[t.part] = (spare[t.part] || 0) + 1;
  for (const s of [...G.base.shops, ...(G.base.armories || [])]) if (s.alive && s.press) spare[s.press.part] = (spare[s.press.part] || 0) + 1;   // in a press now
  for (const p of G.base.plants) if (p.alive && p.brew) spare.core = (spare.core || 0) + 1;   // a core on its way
  for (const line of G.base.lines) {
    if (!line.alive) continue;
    for (const p of lineWants(line, G)) { if (spare[p] > 0) spare[p]--; else if (maker(p) === what) return p; }
  }
  return null;
}
// Mechs being made: in the bays now, so the crew's cap counts them.
const making = G => G.base.lines.reduce((n, l) => n + l.bays.filter(Boolean).length, 0);

// Once a frame (sim/base.js stepBase): the shops press, the lines build.
export function stepProduction(G, dt) {
  const b = G.base;
  for (const s of b.shops) if (works(s)) press(G, s, dt);   // down, or riding on haulers: nothing
  for (const p of b.plants) if (works(p)) brew(G, p, dt);
  for (const a of b.armories || []) if (works(a)) press(G, a, dt, 'gun');   // guns, as a shop presses parts
  for (const l of b.labs || []) if (works(l)) study(G, l, dt);
  for (const line of b.lines) {
    if (!line.alive) { line.bays.fill(null); line.queue.length = 0; continue; }
    if (works(line)) build(G, line, dt);
  }
}

function press(G, s, dt, what = 'part') {
  const b = G.base;
  if (!s.press) {
    const part = thingsAt(G, s).length < LINE.pile && b.things.length < LINE.things && nextPart(G, what);
    if (!part || b.ore < PARTS[part].ore) return;
    b.ore -= PARTS[part].ore;
    s.press = { part, t: 0 };
  }
  if ((s.press.t += dt) < (what === 'gun' ? LINE.gun : LINE.press)) return;
  b.things.push({ part: s.press.part, at: s, by: null, claim: null });
  s.press = null;
  const [x, z] = pileAt(s, thingsAt(G, s).length - 1);
  thunk(G, s, x, z, 0.5);
}

// The isotope plant (docs/specs/33-production.md § The isotope plant and
// cores): a core, from CORE isotopes in the pool, when a line will want one
// that no core on the ground or on a hauler is there for.
function brew(G, p, dt) {
  const b = G.base;
  if (!p.brew) {
    if (thingsAt(G, p).length >= LINE.pile || b.things.length >= LINE.things || !nextPart(G, true) || b.iso < PARTS.core.iso) return;
    b.iso -= PARTS.core.iso;
    p.brew = { t: 0 };
  }
  if ((p.brew.t += dt) < LINE.core) return;
  b.things.push({ part: 'core', at: p, by: null, claim: null });
  p.brew = null;
  const [x, z] = pileAt(p, thingsAt(G, p).length - 1);
  thunk(G, p, x, z, 0.4);
}

// The weapon lab (docs/specs/33-production.md § The weapon lab): works out
// one weapon at a time (`work` = { weapon, t }), LINE.research s, for this
// mission only; you see it at it, a muzzle flash on its range now and then.
export const studyable = G => Object.keys(WEAPONS).filter(w => w !== 'fusion' && !knownOf(G).has(w));
export function study(G, l, dt) {
  if (!l.work) return;
  if ((l.work.flash = (l.work.flash || 0) - dt) <= 0) {
    l.work.flash = 1.2;
    const [x, z] = at(l, 0, l.radius * 0.6);
    particle(G, [x, G.ter.height(x, z) + 2, z], [0, 1, 0], 0.15, 1.2, WEAPONS[l.work.weapon].col || [1, 0.8, 0.4], 'spark');
  }
  if ((l.work.t += dt) < LINE.research) return;
  knownOf(G).add(l.work.weapon);
  G.fx.say(`${NAMES.weapons[l.work.weapon]}. Works.`);
  l.work = null;
}
// Put the lab to `weapon`. False if it's at one, or it's known, or no weapon.
export function startStudy(G, l, weapon) {
  if (!works(l) || l.work || !studyable(G).includes(weapon)) return false;
  l.work = { weapon, t: 0 };
  return true;
}

function build(G, line, dt) {
  // From the furthest bay back, so a mech moves on into a bay just emptied next frame, not this one.
  for (let i = LINE.bays - 1; i >= 0; i--) {
    const j = line.bays[i];
    if (!j) continue;
    if (!j.has) {
      if (i === LINE.bays - 1 && FIGHTERS.includes(j.kind)) j.plan ||= gunsFor(G, j.kind);   // its guns, fixed as it gets to its last bay
      const need = bayParts(G, j.kind, i, j.plan);
      for (const p of (j.got ||= [])) { const n = need.indexOf(p); if (n >= 0) need.splice(n, 1); }
      for (const p of [...need]) {   // whatever of it is on the line's pile goes in
        const t = G.base.things.find(o => o.at === line && o.part === p);
        if (!t) continue;
        G.base.things.splice(G.base.things.indexOf(t), 1);
        j.got.push(p); need.splice(need.indexOf(p), 1);
      }
      if (need.length) continue;   // waiting for the rest
      j.has = true; j.t = 0; j.got = []; j.shell.show = i + 1;
      if (j.plan && i === LINE.bays - 1) { const lo = stockLoadout(j.kind); CHASSIS[j.kind].hardpoints.forEach((h, k) => { lo.hp[h.id] = j.plan[k]; }); applyLoadout(G, j.shell, lo); }   // its guns bolted on
      const [x, z] = bayAt(line, i);
      thunk(G, j.shell, x, z, i === 1 ? 1 : 0.6);   // the body dropping on is the big one
      if (i === 2 && G.player && Math.hypot(G.player.x - x, G.player.z - z) < NEAR) G.fx.say('Reactor online.');   // the hatch slams on its core
      continue;
    }
    if ((j.t += dt) < LINE.bayTime) continue;
    if (i === LINE.bays - 1) { walkOut(G, line, j); line.bays[i] = null; continue; }
    if (line.bays[i + 1]) continue;   // the next bay's busy: it waits here, done
    line.bays[i + 1] = j; line.bays[i] = null; j.has = false;
    const [x0, z0] = bayAt(line, i), [x1, z1] = bayAt(line, i + 1);
    shiftMech(j.shell, x1 - x0, z1 - z0);
  }
  if (!line.bays[0] && line.queue.length) {
    if (crewOf(G).filter(m => m.alive).length + making(G) >= CONSTRUCT.crewMax) { line.full = true; return; }
    line.full = false;
    const kind = line.queue.shift(), [x, z] = bayAt(line, 0);
    const shell = newMech(G, kind, 0, x, z, line.yaw);
    shell.show = 0;
    line.bays[0] = { kind, shell, has: false, t: 0 };
  }
}

// Off the end of the line: the mech is the crew's, parked, on its own job.
function walkOut(G, line, j) {
  const m = j.shell, [x0, z0] = bayAt(line, LINE.bays - 1), [x, z] = exitAt(line);
  shiftMech(m, x - x0, z - z0);
  m.show = undefined;
  park(m);
  G.mechs.push(m);
  (G.crew ||= [G.player]).push(m);
  G.fx.say(FIGHTERS.includes(j.kind) ? 'New mech ready.' : `New ${j.kind}.`);   // a fighter: the factory's line
  if (G.command) msg(G, `NEW ${m.ch.name}`);
}

// A press or a bay's part going in: felt on what took it (the shell's squash,
// a nearby player's view, by `feel`'s own reach) and heard there, with dust.
function thunk(G, e, x, z, k) {
  const y = G.ter.height(x, z), p = [x, y, z], P = G.player, d = P ? Math.hypot(P.x - x, P.z - z) : Infinity;
  if (d < NEAR) feel(G, 'slam', { k: k * (1 - d / NEAR), at: p });   // you, near enough to feel it
  else if (e.feet) feel(G, 'slam', { mech: e, k, at: p });   // the mech in the bay gives a little
  G.fx.sfx.slam(p, min(1, k));
  for (let i = 0; i < 6; i++) particle(G, [x + G.rng.range(-2, 2), y + 1, z + G.rng.range(-2, 2)], [G.rng.range(-2, 2), G.rng.range(1, 3), G.rng.range(-2, 2)], G.rng.range(0.6, 1.2), G.rng.range(0.6, 1.2), G.pal.low, 'dust');
}
