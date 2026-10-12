// Picking on the ground (docs/specs/15-mission-editor.md § Shared parts): the
// mission editor's taps and boxes, and later the command view's. Pure: the
// things are plain { id, x, z, r } (r: how big a target it is, in metres),
// so it knows nothing about missions or the screen.

// The thing a tap at (x, z) means: the nearest whose own size or the tap's
// `slop` (metres a finger covers at this zoom) reaches it; null if none.
// Ties go to the smaller thing, so a truck beside a big tank can be had.
export function pickNearest(things, x, z, slop = 0) {
  let best = null, bestD = Infinity;
  for (const t of things) {
    const d = Math.hypot(t.x - x, t.z - z), reach = Math.max(t.r || 0, slop);
    if (d > reach) continue;
    const score = d - (t.r || 0) * 0.01;
    if (score < bestD) { best = t; bestD = score; }
  }
  return best;
}

// Every thing whose centre lies inside the polygon `poly` ([[x, z], ...]):
// a box dragged on a turned, tilted screen is a four-sided shape on the ground.
export function pickInside(things, poly) {
  return things.filter(t => inside(poly, t.x, t.z));
}
export function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
