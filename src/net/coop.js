import { CHASSIS } from '../data/chassis.js';
import { WEAPONS } from '../data/weapons.js';
import { newMech } from '../sim/state.js';
import { beamMult } from '../sim/beams.js';
import { damage, destroy, scramble } from '../sim/combat.js';
import { knock } from '../sim/knock.js';
import { ehit, r2, stateMessage } from './protocol.js';
import { applyRemote } from './remote.js';

// Co-op's enemies (docs/specs/09-coop.md § Authority split): the host runs
// them, as single player does, and sends each one's state ES_HZ times a
// second; a guest draws them as it draws other pilots (remote, interpolated)
// and sends the hits it lands on them to the host, which applies them. No DOM
// here: the client wires these to the socket, and the tests to each other.
export const ES_HZ = 10;
const LO_EVERY = 20;    // es messages between loadouts (2 s): a late joiner learns the fits
export const GT_SLACK = 0.1;   // s: a guest's game time further than this from the host's is set to it (lightning keys off it)

export const enemyByEid = (G, eid) => G.mechs.find(m => m.eid === eid);

// Every enemy gets an eid, in G.mechs order. At a mission's start every
// client of one seed and mission has the same enemies in the same order, so
// the numbers agree; later ones (waves) only the host spawns and numbers.
export function numberEnemies(G) {
  for (const m of G.mechs) if (m !== G.player && !m.netId && !m.eid) m.eid = ++G.eidN;
}

// Into co-op as 'host' or 'guest', once the mission's world is built. A
// guest's enemies become remote copies, waiting for the host's first report.
export function startCoop(G, role) {
  G.role = role; G.eidN = 0;
  G.coop = { sendT: 0, n: 0 };
  numberEnemies(G);
  if (role === 'guest') for (const m of G.mechs) if (m.eid) { m.remote = true; m.net = null; }
}

// One enemy as the guests get it: a state message, plus which enemy, its
// chassis, what its AI is doing (for ?debug) and the host's game time.
export const enemyState = (G, m, withLo = false) =>
  ({ ...stateMessage(m, beamMult(m), withLo), t: 'es', eid: m.eid, type: m.type, ai: m.ai?.state || '', gt: r2(G.time) });

// The host, every frame: number any new enemies, and ES_HZ times a second
// send every one not yet gone (a dead one keeps saying so while it topples).
export function hostTick(G, dt, send) {
  numberEnemies(G);
  const c = G.coop;
  if ((c.sendT += dt) < 1 / ES_HZ) return;
  c.sendT = 0;
  const withLo = c.n++ % LO_EVERY === 0;
  for (const m of G.mechs) if (m.eid && !m.gone) send(enemyState(G, m, withLo));
}

// A guest, on `es`: the enemy brought up to the host's report (one it hasn't
// seen yet, a wave's, appears), and the game clock pulled to the host's.
// `now`: the clock net/interp.js reads, in ms.
export function applyEnemyState(G, s, now) {
  let e = enemyByEid(G, s.eid);
  if (!e) {
    const type = CHASSIS[s.type] ? s.type : 'kestrel';
    e = newMech(G, type, 1, +s.x || 0, +s.z || 0, +s.yaw || 0);
    Object.assign(e, { eid: s.eid, remote: true, net: null });
    G.mechs.push(e);
  }
  applyRemote(G, e, s, now);
  if (typeof s.gt === 'number' && Math.abs(G.time - s.gt) > GT_SLACK) G.time = s.gt;
}

// A guest, a few times a second: the hits it landed on enemies, one ehit each.
export function flushEHits(G, send) {
  for (const [eid, q] of G.pendingEHits) send(ehit(eid, q.amt, q.p, q));
  G.pendingEHits.clear();
}

// The host, on a guest's `ehit`: what the guest saw land, applied here, as a
// pilot's client applies a hit on itself. `src`: the guest's mech, so the
// kill is theirs. `fu`: a fusion discharge, an outright kill.
export function applyEHit(G, h, src = null) {
  const e = enemyByEid(G, h.eid);
  if (!e || !e.alive || e.remote) return false;
  const p = Array.isArray(h.p) && h.p.length === 3 ? h.p : [e.x, e.y + 4, e.z];
  if (h.fu) { e.hp.T = 0; destroy(G, e, src); return true; }
  const melee = !!(h.me || h.st);
  if (melee) e.lastHitMelee = h.st ? 'stomp' : 'punch';
  damage(G, e, p, Math.max(0, Math.min(40, +h.amt || 0)), src, false, melee);
  if (h.zap && e.alive) scramble(G, e, WEAPONS.ppc.scramble, p);
  if (h.hh > 0 && e.alive) e.heat += Math.min(h.hh, 20);
  if (Array.isArray(h.kb) && e.alive) {
    const kb = [Math.max(-30, Math.min(30, +h.kb[0] || 0)), Math.max(-30, Math.min(30, +h.kb[1] || 0))], v = Math.hypot(kb[0], kb[1]);
    if (v > 0.01) knock(G, { target: e, base: v, dir: [kb[0] / v, kb[1] / v], recoil: false });
  }
  return true;
}
