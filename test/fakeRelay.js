import { startMission } from './harness.js';
import { stepFor } from './helpers.js';
import { newMech } from '../src/sim/state.js';
import { beamMult } from '../src/sim/beams.js';
import { stateMessage } from '../src/net/protocol.js';
import { applyRemote } from '../src/net/remote.js';
import { startCoop, hostTick, guestApply, flushEHits, applyEHit } from '../src/net/coop.js';
import { coopDef } from '../src/sim/coopRules.js';
import { missionDef } from '../src/data/missions.js';
import { startMatch } from '../src/sim/state.js';

// An in-memory co-op room (docs/specs/09-coop.md § Acceptance 6): n headless
// games, pilot 1 the host, joined by the routing server/server.py uses for a
// co-op room. Every pilot's state (s) goes to the others at SEND_HZ; the
// host's world (es, ent, entx, obj, over) to the guests; a guest's ehit to
// the host only. `bytes[i]` counts what pilot i received, as JSON, the way
// the relay sends it, for the traffic budget (acceptance 4).
const FROM_HOST = new Set(['es', 'ent', 'entx', 'obj', 'over']), SEND_HZ = 15;
export function fakeRoom(mission, n = 2, { diff = 'normal' } = {}) {
  const def = missionDef(mission), seed = def.seed ?? 7 + mission * 13;
  const pilots = Array.from({ length: n }, (_, i) => {
    const G = startMission(mission, { diff });
    if (i === 0) startMatch(G, coopDef(def, n), seed, mission === 0, 'kestrel');   // the host builds it for the room
    G.player.netId = i + 1;
    // Every other pilot as a remote teammate, as net/client.js keeps them.
    for (let j = 0; j < n; j++) if (j !== i) {
      const m = newMech(G, 'kestrel', 0, G.player.x + (j - i) * 12, G.player.z, 0);
      Object.assign(m, { netId: j + 1, remote: true, mate: true, net: null });
      G.mechs.push(m);
    }
    startCoop(G, i === 0 ? 'host' : 'guest', n);
    return G;
  });
  const bytes = new Array(n).fill(0), host = pilots[0];
  const deliver = (to, msg) => { bytes[to] += JSON.stringify(msg).length; };
  // What one pilot sent, through the room.
  function route(from, msg) {
    if (FROM_HOST.has(msg.t)) {
      if (from !== 0) return;   // only the host's world counts
      for (let i = 1; i < n; i++) { deliver(i, msg); guestApply(pilots[i], msg, pilots[i].clock); }
    } else if (msg.t === 'ehit') {
      if (from === 0) return;
      const out = { ...msg, from: from + 1 };
      deliver(0, out);
      applyEHit(host, out, host.mechs.find(m => m.netId === from + 1) || null);
    } else if (msg.t === 's') {
      for (let i = 0; i < n; i++) if (i !== from) {
        const out = { ...msg, id: from + 1 }, G = pilots[i];
        deliver(i, out);
        applyRemote(G, G.mechs.find(m => m.netId === from + 1), out, G.clock);
      }
    } else if (msg.t === 'fx') {
      for (let i = 0; i < n; i++) if (i !== from) deliver(i, { ...msg, id: from + 1 });   // drawn, never scored: counted only
    }
  }
  let sendT = 0;
  const seen = new Array(n).fill(0);   // how far into each pilot's fx log the room has read
  const sends = i => { const log = pilots[i].fx.log, out = []; for (; seen[i] < log.length; seen[i]++) if (log[seen[i]].kind === 'netSend') out.push(log[seen[i]].args[0]); return out; };
  // `seconds` of play at dt: everyone steps; the host runs the world; each
  // pilot's sim sends (fx, entx, ehit for a fusion kill) go through the room.
  function run(seconds, dt = 1 / 20, each = null) {
    for (let t = 0; t < seconds; t += dt) {
      for (const G of pilots) { if (each) each(G, t); stepFor(G, dt, undefined, dt); }
      pilots.forEach((G, i) => { for (const msg of sends(i)) route(i, msg); });
      hostTick(host, dt, msg => route(0, msg));
      if ((sendT += dt) >= 1 / SEND_HZ) {
        sendT = 0;
        pilots.forEach((G, i) => {
          route(i, stateMessage(G.player, beamMult(G.player), false));
          if (i > 0) flushEHits(G, msg => route(i, msg));
        });
      }
    }
  }
  return { pilots, host, guests: pilots.slice(1), bytes, run, route };
}
