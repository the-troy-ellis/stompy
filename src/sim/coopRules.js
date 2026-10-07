import { COOP_EXTRA, COOP_RESPAWN } from '../data/coop.js';
import { initFeet } from './gait.js';
import { msg } from './effects.js';
import { pilotsOf } from './hitqueue.js';

// Co-op's own rules (docs/specs/09-coop.md § Scaling, § Death and respawn).

// The mission for `pilots` pilots: one more light mech per extra pilot where
// enemies are the point (a main ELIMINATE objective, or none, which is
// ELIMINATE). Never more hp. They go at the end of the list, so the enemies
// every client builds keep their numbers (net/coop.js); only the host builds
// the extras, which reach the guests as enemies they hadn't seen.
export function coopDef(def, pilots) {
  const extra = Math.max(0, (pilots | 0) - 1), main = (def.objectives || [{ type: 'eliminate' }]).filter(o => !o.secondary);
  if (!extra || !main.some(o => o.type === 'eliminate')) return def;
  return { ...def, foes: [...def.foes, ...Array(extra).fill(COOP_EXTRA)] };
}

// Whether a death here is not the end: a guest, or a host with company. A
// host alone keeps the single-player rule (die = fail).
export const coopLives = G => G.role === 'guest' || (G.role === 'host' && pilotsOf(G).length > 1);
// Every pilot down at once (the host decides): the mission fails.
export const allDown = G => G.role === 'host' && pilotsOf(G).every(m => !m.alive);

const objKey = G => (G.objectives || []).map(o => o.state).join();
// Down in co-op: back at the start after COOP_RESPAWN seconds, or as soon as
// an objective changes, whichever comes first.
export function coopDown(G) {
  G.coopRespawn = { at: G.time + COOP_RESPAWN, obj: objKey(G) };
  msg(G, 'MECH DESTROYED', '#f44');
}
// Once a frame in co-op: back up when it's time, at the start zone with full
// armour and the ammunition it went down with.
export function tickCoopRespawn(G) {
  const P = G.player, r = G.coopRespawn;
  if (!r || P.alive || P.dying || G.state !== 'play') return;
  if (G.time < r.at && objKey(G) === r.obj) return;
  const s = G.startAt || { x: 0, z: 0, yaw: 0 };
  Object.assign(P, { x: s.x, z: s.z, y: G.ter.height(s.x, s.z), vy: 0, yaw: s.yaw, twist: 0, pitch: 0, speed: 0, throttle: 0,
    heat: 0, fuel: 1, shutdown: false, alive: true, gone: false, air: false, hp: { ...P.max }, spawnT: 2 });
  for (const w of P.weapons) w.dead = false;   // the guns come back with the arms; the ammo doesn't
  initFeet(G, P); P.lastYaw = P.yaw;
  G.coopRespawn = null;
  msg(G, 'BACK IN');
}
// A wave's extra mechs for the pilots (waves.js): the host's count.
export const waveExtra = G => Array(G.coopExtra || 0).fill(COOP_EXTRA);
