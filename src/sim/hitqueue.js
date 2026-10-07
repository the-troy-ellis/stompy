// The batch a hit on a mech this client doesn't own rides in, flushed a few
// times a second by the net layer: another pilot's, by netId (sent as `hit`,
// their client applies it), or, as a co-op guest, an enemy the host runs, by
// eid (sent as `ehit`, the host applies it; docs/specs/09-coop.md). With `p`,
// one is started if there is none yet.
export function hitQueue(G, m, p) {
  const enemy = !!m.eid && G.role === 'guest', map = enemy ? G.pendingEHits : G.pendingHits, key = enemy ? m.eid : m.netId;
  let q = map.get(key);
  if (!q && p) { q = { amt: 0, p }; map.set(key, q); }
  return q;
}

// Whose weapon effects go out on the wire: your own in the arena or co-op,
// and, when you host co-op, the enemies' (stamped with their eid).
export const sendsFx = (G, m) => (m === G.player ? G.mode === 'mp' || (G.role || 'solo') !== 'solo' : G.role === 'host' && !!m.eid);
export function sendFx(G, m, msg) {
  if (sendsFx(G, m)) G.fx.netSend(m.eid ? { ...msg, eid: m.eid } : msg);
}

// The pilots an enemy can fight: you, and in a co-op game you host, the
// other pilots (remote mechs with a netId; enemies have an eid instead).
export function pilotsOf(G) {
  if (G.role !== 'host') return [G.player];
  const out = [G.player];
  for (const m of G.mechs) if (m.remote && m.netId && !m.eid) out.push(m);
  return out;
}
