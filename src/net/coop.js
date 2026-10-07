import { CHASSIS } from '../data/chassis.js';
import { WEAPONS } from '../data/weapons.js';
import { newMech } from '../sim/state.js';
import { beamMult } from '../sim/beams.js';
import { damage, destroy, scramble } from '../sim/combat.js';
import { knock } from '../sim/knock.js';
import { damageEntity, destroyEntity } from '../sim/entities.js';
import { activate } from '../sim/objectives.js';
import { voice } from '../sim/voice.js';
import { ehit, r2, stateMessage } from './protocol.js';
import { applyRemote } from './remote.js';

// Co-op's enemies (docs/specs/09-coop.md § Authority split): the host runs
// them, as single player does, and sends each one's state ES_HZ times a
// second; a guest draws them as it draws other pilots (remote, interpolated)
// and sends the hits it lands on them to the host, which applies them. No DOM
// here: the client wires these to the socket, and the tests to each other.
export const ES_HZ = 10;
const LO_EVERY = 20;    // es messages between loadouts (2 s): a late joiner learns the fits
export const ENT_HZ = 2;   // entity snapshots and objective progress, a second
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
  G.coop = { sendT: 0, n: 0, entT: 0, objKey: '', objSent: '', overSent: false };
  numberEnemies(G);
  if (role === 'guest') for (const m of G.mechs) if (m.eid) { m.remote = true; m.net = null; }
}

// One enemy as the guests get it: a state message, plus which enemy, its
// chassis, what its AI is doing (for ?debug) and the host's game time.
export const enemyState = (G, m, withLo = false) =>
  ({ ...stateMessage(m, beamMult(m), withLo), t: 'es', eid: m.eid, type: m.type, ai: m.ai?.state || '', gt: r2(G.time) });

// The mission's entities with something to tell: hp for those that can fall,
// position and waypoint for vehicles. Rows [id, hp, x, z, yaw, wp].
const shared = e => Number.isFinite(e.hp) || e.kind === 'vehicle';
export const entSnapshot = G => ({ t: 'ent', list: G.entities.filter(shared).map(e => [e.id, r2(e.hp), r2(e.x), r2(e.z), r2(e.yaw), e.wp | 0]) });
// Each objective's state and progress, and which waves have come (so a guest
// who becomes host doesn't send them again).
const PROGRESS = ['left', 'total', 'done', 'alive', 'home', 'dist'];
export function objState(G) {
  const list = (G.objectives || []).map(o => {
    const row = { state: o.state };
    for (const k of PROGRESS) if (typeof o[k] === 'number') row[k] = r2(o[k]);
    if (o.waves) row.wv = o.waves.map(w => (w.spawned ? 1 : 0));
    return row;
  });
  return { t: 'obj', list, wv: (G.waves || []).map(w => (w.spawned ? 1 : 0)) };
}

// The host, every frame: number any new enemies; ES_HZ times a second send
// every one not yet gone (a dead one keeps saying so while it topples);
// ENT_HZ times a second the entities and, if it moved, the objectives'
// progress; any objective changing state at once; and the end, once.
export function hostTick(G, dt, send) {
  numberEnemies(G);
  const c = G.coop;
  const states = (G.objectives || []).map(o => o.state).join();
  const entDue = (c.entT += dt) >= 1 / ENT_HZ;
  if (states !== c.objKey || entDue) {
    const o = objState(G), key = JSON.stringify(o);
    if (key !== c.objSent) { send(o); c.objSent = key; }
    c.objKey = states;
  }
  if (entDue) { c.entT = 0; send(entSnapshot(G)); }
  if (G.state === 'over' && !c.overSent) { c.overSent = true; send({ t: 'over', won: G.won ? 1 : 0 }); }
  if ((c.sendT += dt) < 1 / ES_HZ) return;
  c.sendT = 0;
  const withLo = c.n++ % LO_EVERY === 0;
  for (const m of G.mechs) if (m.eid && !m.gone) send(enemyState(G, m, withLo));
}

// A guest, on `ent`: hp and, for vehicles, where they are (between snapshots
// they drive their own path here, as on the host). One the host has down that
// is still up here (a lost entx) goes down.
export function applyEnt(G, m) {
  if (!Array.isArray(m.list)) return;
  for (const row of m.list) {
    const [id, hp, x, z, yaw, wp] = Array.isArray(row) ? row : [];
    const e = G.entities.find(q => q.id === id);
    if (!e || !e.alive) continue;
    if (Number.isFinite(e.hp) && typeof hp === 'number') {
      if (hp <= 0) { destroyEntity(G, e, null); continue; }
      e.hp = hp;
    }
    if (e.kind === 'vehicle' && typeof x === 'number' && typeof z === 'number') {
      e.x = x; e.z = z; e.y = G.ter.height(x, z); e.yaw = +yaw || 0; e.wp = wp | 0;
    }
  }
}
// A guest, on `entx`: down it goes, now, the way the host's went.
export function applyEntx(G, m) {
  const e = G.entities.find(q => q.id === m.id);
  if (e) destroyEntity(G, e, null, m.punch ? { punch: true, yaw: +m.yaw || 0 } : {});
}
// A guest, on `obj`: each objective's state and progress as the host has it.
export function applyObj(G, m) {
  if (!Array.isArray(m.list) || !G.objectives) return;
  m.list.forEach((row, i) => {
    const o = G.objectives[i];
    if (!o || !row) return;
    if (o.state === 'waiting' && row.state !== 'waiting') activate(G, o);
    o.state = row.state;
    for (const k of PROGRESS) if (typeof row[k] === 'number') o[k] = row[k];
    if (o.waves && Array.isArray(row.wv)) o.waves.forEach((w, j) => { if (row.wv[j]) w.spawned = w.warned = true; });
  });
  if (Array.isArray(m.wv)) (G.waves || []).forEach((w, j) => { if (m.wv[j]) w.spawned = w.warned = true; });
}
// A guest, on `over`: the mission is won or lost for everyone.
export function applyOver(G, m) {
  if (G.state !== 'play') return;
  G.state = 'over'; G.won = !!m.won; G.endT = G.won ? 3.5 : 3.2;
  voice(G, G.won ? 'complete' : 'failed', {}, true, 600);
}

// A guest, on any of the host's world messages: which one it is. True if it was one.
export function guestApply(G, m, now) {
  switch (m.t) {
    case 'es': applyEnemyState(G, m, now); return true;
    case 'ent': applyEnt(G, m); return true;
    case 'entx': applyEntx(G, m); return true;
    case 'obj': applyObj(G, m); return true;
    case 'over': applyOver(G, m); return true;
  }
  return false;
}

// The host left and this guest is host now (the relay's `host`): its remote
// enemies become its own again, picking up from the last report, and it
// starts running the objectives, waves and turrets (update.js reads G.role).
// It numbers any later enemies after the highest eid it knows.
export function becomeHost(G) {
  G.role = 'host';
  let top = 0;
  for (const m of G.mechs) {
    if (!m.eid) continue;
    top = Math.max(top, m.eid);
    if (m.remote) { m.remote = false; m.net = null; m.throttle = 0; }
  }
  G.eidN = top;
  Object.assign(G.coop, { objKey: '', objSent: '', overSent: G.state !== 'play' });
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

// A guest, a few times a second: the hits it landed on enemies and mission
// entities, one ehit each.
export function flushEHits(G, send) {
  for (const q of G.pendingEHits.values()) {
    const m = ehit(q.eid || 0, q.amt, q.p, q);
    if (q.ent) { delete m.eid; m.ent = q.ent; if (q.yaw != null) m.yaw = Math.round(q.yaw * 100) / 100; }   // a mission entity, not an enemy
    send(m);
  }
  G.pendingEHits.clear();
}

// The host, on a guest's `ehit`: what the guest saw land, applied here, as a
// pilot's client applies a hit on itself. `src`: the guest's mech, so the
// kill is theirs. `fu`: a fusion discharge, an outright kill.
export function applyEHit(G, h, src = null) {
  if (typeof h.ent === 'string') {
    // On a mission entity: its one pool of hp (a punch topples it toward the puncher's facing).
    const x = G.entities.find(q => q.id === h.ent);
    if (!x || !x.alive) return false;
    damageEntity(G, x, Math.max(0, Math.min(40, +h.amt || 0)), src, Array.isArray(h.p) ? h.p : null, h.me ? { punch: true, yaw: +h.yaw || 0 } : {});
    return true;
  }
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
