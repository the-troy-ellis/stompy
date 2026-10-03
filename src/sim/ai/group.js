import { GROUP as K } from '../../data/ai.js';
import { massOf } from '../knock.js';

// Group behaviour (docs/specs/05-ai.md § Group). Enemies within 200 m of
// one another form a group. A group shares what it knows (the freshest fix
// on the target goes to everyone in it), focuses the same target (in M1
// there is only the player; co-op widens this), and its lightest member
// flanks: its approach bearing gets a right angle added. That is the whole
// tactics layer; it reads as coordination without pathfinding.
//
// Writes e.ai.group = { id, size, flank } and e.ai.focus.

const { hypot } = Math;

export function groupPass(G, dt) {
  G.groupT = (G.groupT ?? 0) - dt;
  if (G.groupT > 0) return;
  G.groupT = K.every;
  const es = G.mechs.filter(m => m.alive && m.team !== 0 && !m.remote);
  const id = new Map(es.map((e, i) => [e, i]));
  // Union by proximity: a chain of neighbours is one group.
  for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
    const a = es[i], b = es[j];
    if (a.team !== b.team || hypot(a.x - b.x, a.z - b.z) > K.range) continue;
    const ra = root(id, es, a), rb = root(id, es, b);
    if (ra !== rb) id.set(es[ra], rb);
  }
  const groups = new Map();
  for (const e of es) { const r = root(id, es, e); (groups.get(r) || groups.set(r, []).get(r)).push(e); }
  let n = 0;
  for (const members of groups.values()) {
    n++;
    const lightest = members.reduce((l, e) => (massOf(e) < massOf(l) ? e : l), members[0]);
    // The freshest fix in the group is everyone's fix.
    let best = null;
    for (const e of members) if (e.ai.aware && e.ai.belief && (!best || e.ai.belief.at > best.ai.belief.at)) best = e;
    for (const e of members) {
      e.ai.group = { id: n, size: members.length, flank: members.length > 1 && e === lightest };
      e.ai.focus = G.player;
      if (!best || e === best) continue;
      const b = best.ai.belief;
      if (!e.ai.belief || e.ai.belief.at < b.at) {
        e.ai.belief = { ...b };
        if (!e.ai.aware) { e.ai.aware = true; e.ai.shoutAt = null; }
        if (e.ai.state !== 'engage') { e.ai.state = 'engage'; e.ai.searchT = 0; e.ai.wp = null; }
        e.ai.lastSeen = Math.max(e.ai.lastSeen ?? -Infinity, best.ai.lastSeen ?? b.at);
      }
    }
  }
}

function root(id, es, e) {
  let i = id.get(e);
  while (id.get(es[i]) !== i) i = id.get(es[i]);
  return i;
}
