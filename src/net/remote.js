import { HPK } from '../data/chassis.js';
import { initFeet } from '../sim/gait.js';
import { beginDeath, shedSection } from '../sim/combat.js';
import { applyLoadout, validate } from '../sim/loadout.js';

// A mech another client runs (another pilot's, or a co-op host's enemy),
// brought up to its latest report `s` (a state message): the report kept for
// net/interp.js to glide toward, its fit, its armour (a section that just hit
// zero comes off), and its life. `now`: the clock net/interp.js reads, in ms.
export function applyRemote(G, r, s, now) {
  const first = !r.net;
  r.net = { ...s, at: now };
  // Their mechlab fit: weapons drawn and fired as they carry them, armour to scale.
  if (s.lo) {
    const key = JSON.stringify(s.lo);
    if (key !== r.loKey) { r.loKey = key; applyLoadout(G, r, validate(r.type, s.lo).loadout); }
  }
  if (Array.isArray(s.hp)) HPK.forEach((k, i) => {
    const v = +s.hp[i] || 0;
    if (r.alive && !first && r.hp[k] > 0 && v <= 0 && k !== 'T') { r.hp[k] = 0; shedSection(G, r, k, [r.x, r.y + 4, r.z]); }
    r.hp[k] = v;
  });
  if (first || (s.al && !r.alive)) {
    // Appeared or respawned: jump straight there.
    Object.assign(r, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, twist: s.tw, pitch: s.p, alive: !!s.al });
    initFeet(G, r); r.lastYaw = r.yaw;
  } else if (!s.al && r.alive) {
    // Its own client says it's dead: the same beat, blast and topple as a local kill.
    beginDeath(G, r);
  }
}
