// A mesh's wireframe for the HUD's damage diagram: the edges of a
// flat-shaded triangle soup (Builder's `d`: position, normal, colour per
// vertex), without the diagonals inside flat faces, so a box reads as a box.
// An edge is kept where the faces on either side turn away from each other
// (their normals differ), or where it has only one face. Pure, built once per
// mesh, tested headlessly (test/wire.test.js). Returns a Float32Array of
// segments: x1, y1, z1, x2, y2, z2, ...
const F = 9;   // floats per vertex in Builder's `d`
const key = (d, i) => `${Math.round(d[i] * 1000)},${Math.round(d[i + 1] * 1000)},${Math.round(d[i + 2] * 1000)}`;

export function wireEdges(d, crease = 0.995) {
  const edges = new Map();   // "a|b" (sorted) → { a, b, normals }
  for (let t = 0; t < d.length; t += 3 * F) {
    const v = [t, t + F, t + 2 * F], n = [d[t + 3], d[t + 4], d[t + 5]];
    for (let k = 0; k < 3; k++) {
      const i = v[k], j = v[(k + 1) % 3], ki = key(d, i), kj = key(d, j);
      if (ki === kj) continue;   // a degenerate edge
      const id = ki < kj ? `${ki}|${kj}` : `${kj}|${ki}`;
      let e = edges.get(id);
      if (!e) edges.set(id, e = { a: i, b: j, normals: [] });
      e.normals.push(n);
    }
  }
  const out = [];
  for (const e of edges.values()) {
    const ns = e.normals;
    const flat = ns.length === 2 && ns[0][0] * ns[1][0] + ns[0][1] * ns[1][1] + ns[0][2] * ns[1][2] > crease;
    if (flat) continue;
    out.push(d[e.a], d[e.a + 1], d[e.a + 2], d[e.b], d[e.b + 1], d[e.b + 2]);
  }
  return new Float32Array(out);
}
