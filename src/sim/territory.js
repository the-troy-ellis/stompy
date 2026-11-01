// Territory (docs/specs/33-production.md § Beacons and territory): a team's
// silos and beacons are its nodes; two within `link` metres of each other
// link; three all linked to each other make a triangle; the team's territory
// is every one of its triangles together. Losing a node loses only the
// triangles that used it, so more nodes overlap and hold. Pure: points in,
// lines and triangles out.

// Nodes `[{ x, z }]` → `{ links: [[a, b]], tris: [[a, b, c]] }`, indices into nodes.
export function territory(nodes, link) {
  const n = nodes.length, near = [], links = [], tris = [];
  for (let i = 0; i < n; i++) near.push(new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z) > link) continue;
    near[i][j] = near[j][i] = true;
    links.push([i, j]);
  }
  for (const [i, j] of links) for (let k = j + 1; k < n; k++) if (near[i][k] && near[j][k]) tris.push([i, j, k]);
  return { links, tris };
}

// Whether (x, z) is in triangle a b c (each `{ x, z }`), edges included.
export function inTri(a, b, c, x, z) {
  const s = (p, q) => (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// Whether (x, z) is in any of the triangles of `t` (from territory) over `nodes`.
export const inTerritory = (nodes, t, x, z) => t.tris.some(([i, j, k]) => inTri(nodes[i], nodes[j], nodes[k], x, z));
