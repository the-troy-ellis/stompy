import { STEAL, BUILDINGS, PLACE, CONSTRUCT, LINE } from '../data/construct.js';
import { NAMES } from '../data/names.js';
import { addEntity } from './entities.js';
import { territory, inTerritory } from './territory.js';
import { isDown } from './down.js';
import { kindOf, inLand } from './base.js';
import { feel } from './feel.js';
import { particle, msg } from './effects.js';

// Stealing (docs/specs/33-production.md § Stealing). A building down (at a
// quarter or less, sim/down.js) and outside every triangle of its owner's
// can be lifted by STEAL.lift haulers and carried off. The CARRY order
// (sim/orders.js) puts `carry = { to: { x, z, yaw }, lifted }` on it and sends
// the haulers to its sides; with enough of them there it rises onto their
// tubs and goes to `to` at their walking pace; set down inside the thief's
// territory it's theirs, at the health it had. Fewer haulers than it needs
// on the way (one fell): it drops where it is, unharmed, and waits.

const { hypot, sin, cos, min, PI } = Math;

// The territory of a team other than the base's own (team 0 is G.base.land):
// its silos and beacons that stand and aren't down. Nobody's buildings have
// none.
export function landOf(G, team) {
  if (team === 0) return G.base?.land || null;
  if (team === STEAL.neutral) return null;
  const nodes = G.entities.filter(e => e.alive && e.team === team && e.kind === 'structure' && !isDown(e) && (e.tags.includes('silo') || e.tags.includes('beacon')));
  return { nodes, ...territory(nodes, CONSTRUCT.link) };
}
const inLandOf = (G, team, x, z) => { const l = landOf(G, team); return !!l && inTerritory(l.nodes, l, x, z); };

// How many haulers it takes to lift a building.
export const liftNeed = e => STEAL.lift[kindOf(e)] ?? 2;
// Whether team `by` can lift `e` now: a building (of a kind BUILD knows), not
// theirs, down, and outside its owner's territory.
export function canLift(G, e, by = 0) {
  return !!e && e.alive && e.kind === 'structure' && !e.site && !!PLACE[kindOf(e)] && e.team !== by && isDown(e) && !inLandOf(G, e.team, e.x, e.z);
}

// A building of `kind` put down whole at (x, z): an abandoned one (team
// STEAL.neutral, down to `hp` of its health) or a foe's. Not one of the base's.
export function addBuilding(G, kind, x, z, yaw = 0, team = STEAL.neutral, hp = STEAL.down) {
  const P = PLACE[kind], e = addEntity(G, { ...BUILDINGS[kind], x, z, yaw, team, hp: P.hp });
  e.hp = P.hp * hp;
  e.targetable = team !== 0;
  if (kind === 'line') { e.bays = new Array(LINE.bays).fill(null); e.queue = []; }
  return e;
}

// The point beside a lifted (or to be lifted) building where hauler `i` of
// `n` stands: round its edge, evenly.
export function slotOf(e, i, n) {
  const a = e.yaw + (i + 0.5) * 2 * PI / n, r = e.radius + 2.5;
  return [e.x + sin(a) * r, e.z + cos(a) * r];
}
// The crew haulers on a building's CARRY, alive.
export const carriersOf = (G, e) => (G.crew || []).filter(m => m.alive && m.order?.kind === 'carry' && m.order.target === e);

// Once a frame (sim/base.js): down buildings smoke and the base's say so;
// lifted ones go where they're carried, or drop.
export function stepSteal(G, dt) {
  for (const e of G.entities) {
    if (!e.alive || e.kind !== 'structure' || !PLACE[kindOf(e)] || e.site) continue;
    const down = isDown(e);
    if (down && !e.wasDown && e.team === 0) G.fx.say('Building down.');
    e.wasDown = down;
    if (down && (e.puffT = (e.puffT || 0) - dt) <= 0) {   // a slow plume of smoke, and a spark now and then
      e.puffT = 0.35;
      particle(G, [e.x + G.rng.range(-2, 2), e.y + e.height * 0.8, e.z + G.rng.range(-2, 2)], [G.rng.range(-0.5, 0.5), G.rng.range(2, 4), G.rng.range(-0.5, 0.5)], 2, 2.2, [0.2, 0.2, 0.2], 'smoke');
    }
    if (e.carry) carry(G, e, dt);
  }
}

function carry(G, e, dt) {
  const c = e.carry, by = carriersOf(G, e), need = liftNeed(e);
  if (!by.length) { if (c.lifted) drop(G, e); e.carry = null; return; }   // nobody on it any more
  if (!c.lifted) {
    const there = by.filter((m, i) => { const [x, z] = slotOf(e, i, by.length); return hypot(m.x - x, m.z - z) < 4; }).length;
    if (there >= need) { c.lifted = true; e.y += 3; feel(G, 'slam', { at: [e.x, e.y, e.z], k: 0.5 }); G.fx.sfx.slam([e.x, e.y, e.z], 0.3); }
    else if (there && by.length < need) c.short = true;   // TOO HEAVY: the ones there strain and wait
    return;
  }
  if (by.length < need) { drop(G, e); return; }
  const dx = c.to.x - e.x, dz = c.to.z - e.z, d = hypot(dx, dz), speed = by[0].ch.speed * STEAL.speed * min(STEAL.faster, by.length / need), step = min(d, speed * dt);
  if (d > 0.5) {
    e.x += dx / d * step; e.z += dz / d * step; e.y = G.ter.height(e.x, e.z) + 3;
    return;
  }
  setDown(G, e);
  for (const m of by) m.order = { kind: 'stay' };
}

// Off the haulers' backs where it is (one of them gone): a thunk, no harm.
function drop(G, e) {
  e.carry.lifted = false;
  e.y = G.ter.height(e.x, e.z);
  feel(G, 'land', { at: [e.x, e.y, e.z], k: 0.6 });
  G.fx.sfx.slam([e.x, e.y, e.z], 0.6);
  if (e.team === 0 || G.command) msg(G, 'DROPPED', '#fc3');
}

// Set down at its `to`: inside the thief's territory, theirs (the crew's: the
// base takes it into its lists and it works again once mended); outside,
// still its owner's, wherever it now stands.
export function setDown(G, e) {
  const c = e.carry, kind = kindOf(e);
  e.x = c.to.x; e.z = c.to.z; e.yaw = c.to.yaw ?? e.yaw; e.y = G.ter.height(e.x, e.z);
  e.carry = null;
  feel(G, 'built', { at: [e.x, e.y, e.z], k: 0.8 });
  G.fx.sfx.built([e.x, e.y, e.z]);
  for (let i = 0; i < 18; i++) particle(G, [e.x + G.rng.range(-e.radius, e.radius), e.y + 1, e.z + G.rng.range(-e.radius, e.radius)], [G.rng.range(-3, 3), G.rng.range(1, 3), G.rng.range(-3, 3)], G.rng.range(1, 2), G.rng.range(1, 2), G.pal.low, 'dust');
  if (e.team === 0 || !G.base || !inLand(G, e.x, e.z)) return false;
  take(G, e, kind);
  G.fx.say('Taken. It\'s ours now.');
  return true;
}

// Into the base's lists, as BUILD would have put it there.
function take(G, e, kind) {
  const b = G.base;
  e.team = 0; e.targetable = false; e.place = kind; e.prog = 1; e.counted = false;
  e.ch.name = NAMES.buildings[kind] || e.ch.name;
  if (kind === 'silo') b.silos.push(e);
  else if (kind === 'beacon') b.beacons.push(e);
  else if (kind === 'shop') { e.press = null; b.shops.push(e); }
  else if (kind === 'plant') { e.brew = null; b.plants.push(e); }
  else if (kind === 'line') { e.bays ||= new Array(LINE.bays).fill(null); e.queue ||= []; b.lines.push(e); }
  else if (kind === 'wall') b.walls.push(e);
  else if (kind === 'factory' && !b.factory?.alive) { e.job = null; b.factory = e; }
  else if (kind === 'bay') b.bays.push(e);
}
