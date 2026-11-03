// Where the base is being hit (docs/specs/32-base-loop.md § Part 2): the last
// few hits on a crew mech or a building of yours by a foe, for the map to ring
// (ui/command.js). Sim-side, so it's testable and the sim knows no DOM.
export const HITS = { keep: 6, most: 6, merge: 25 };   // s a ring stays; how many at once; m within which a new hit renews an old ring
export function noteHit(G, e, src) {
  const b = G.base;
  if (!b || e.team !== 0 || !src || src.team === 0 || src.team == null) return;
  const hits = (b.hits ||= []), now = G.time;
  const near = hits.find(h => Math.hypot(h.x - e.x, h.z - e.z) < HITS.merge);
  if (near) { near.t = now; near.x = e.x; near.z = e.z; return; }
  hits.push({ x: e.x, z: e.z, t: now });
  if (hits.length > HITS.most) hits.shift();
}
// The rings still showing.
export const liveHits = G => (G.base?.hits || []).filter(h => G.time - h.t < HITS.keep);
