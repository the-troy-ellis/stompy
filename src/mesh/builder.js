import { M, cross, dot, mul, norm, sub } from '../util/math.js';

// Flat-shaded triangle soup: position, normal, colour per vertex.
export class Builder {
  constructor() { this.d = []; }
  tri(a, b, c, col, ref) {
    let n = norm(cross(sub(b, a), sub(c, a)));
    // Orient outward: away from `ref` (a point inside), or upward for terrain.
    if (ref === 'up' ? n[1] < 0 : ref && dot(n, sub(a, ref)) < 0) n = mul(n, -1);
    for (const p of [a, b, c]) this.d.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  }
  quad(a, b, c, d, col, ref) { this.tri(a, b, c, col, ref); this.tri(a, c, d, col, ref); }
  // A unit cube (-0.5..0.5) through matrix m; the top face can be tapered.
  cube(m, col, tx = 1, tz = 1) {
    const k = [-0.5, 0.5], C = [];
    for (let i = 0; i < 8; i++) {
      const y = k[(i >> 1) & 1], top = y > 0;
      C.push(M.apply(m, [k[i & 1] * (top ? tx : 1), y, k[(i >> 2) & 1] * (top ? tz : 1)]));
    }
    const ctr = M.apply(m, [0, 0, 0]);
    for (const [a, b, c, d] of [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6]])
      this.quad(C[a], C[b], C[c], C[d], col, ctr);
  }
}
