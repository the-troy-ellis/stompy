// The overhead camera (docs/specs/15-mission-editor.md § Shared parts): the
// mission editor's view, and later the command view's. It looks down at a
// focus point on the ground from `dist` metres away, tilted so the ground's
// relief still reads, turned to `yaw` (0 looks toward bearing 0, so north is
// up the screen). Pure maths, no DOM, so it is tested headlessly
// (test/topCamera.test.js); screen positions are CSS pixels.
import { M, add, mul, dirOf, norm, sub, cross, clampN } from '../util/math.js';

export const TOP = { fov: 0.8, tilt: -1.15, minDist: 40, maxDist: 3200 };

export function createTopCamera({ x = 0, z = 0, y = 0, dist = 1400, yaw = 0 } = {}) {
  return { x, y, z, dist, yaw };
}

// Where the camera is and where it looks: the eye, the direction, and the
// view-projection matrix for a screen of that shape.
export function camView(c, aspect) {
  const dir = dirOf(c.yaw, TOP.tilt), eye = sub([c.x, c.y, c.z], mul(dir, c.dist));
  const far = c.dist * 2 + 3000, near = Math.max(1, c.dist * 0.02);
  const VP = M.mul(M.persp(TOP.fov, aspect, near, far), M.lookAt(eye, add(eye, dir)));
  return { eye, dir, VP, fov: TOP.fov, near, far };
}

// The ray under a screen point: from the eye, through that pixel.
export function screenRay(c, sx, sy, W, H) {
  const { eye, dir } = camView(c, W / H);
  const right = norm(cross(dir, [0, 1, 0])), up = cross(right, dir), t = Math.tan(TOP.fov / 2);
  const nx = (2 * sx / W - 1) * t * (W / H), ny = (1 - 2 * sy / H) * t;
  return { o: eye, d: norm(add(dir, add(mul(right, nx), mul(up, ny)))) };
}

// Where a ray meets the ground: marched in steps, then halved down to a few
// centimetres. `height(x, z)` is the terrain's. Null if it never does.
export function rayGround(o, d, height, maxT = 9000) {
  const below = t => o[1] + d[1] * t - height(o[0] + d[0] * t, o[2] + d[2] * t);
  if (below(0) < 0) return null;
  let a = 0, step = 8;
  for (let t = step; t <= maxT; t += step) {
    if (below(t) <= 0) {
      let lo = a, hi = t;
      for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (below(m) > 0) lo = m; else hi = m; }
      const u = (lo + hi) / 2;
      return { x: o[0] + d[0] * u, y: o[1] + d[1] * u, z: o[2] + d[2] * u };
    }
    a = t;
    step = Math.min(64, step * 1.15);
  }
  return null;
}
export const screenToGround = (c, sx, sy, W, H, height) => { const r = screenRay(c, sx, sy, W, H); return rayGround(r.o, r.d, height); };

// A world point on the screen: [sx, sy], or null behind the camera.
export function groundToScreen(c, p, W, H, VP = camView(c, W / H).VP) {
  const x = p.x, y = p.y ?? 0, z = p.z;
  const cx = VP[0] * x + VP[4] * y + VP[8] * z + VP[12], cy = VP[1] * x + VP[5] * y + VP[9] * z + VP[13];
  const cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
  if (cw <= 1e-6) return null;
  return [(cx / cw + 1) / 2 * W, (1 - cy / cw) / 2 * H];
}

// Metres of ground per screen pixel at the focus, for panning by a drag.
export const metresPerPixel = (c, H) => (2 * c.dist * Math.tan(TOP.fov / 2)) / H;

// Moving. A drag of (dx, dy) pixels slides the ground with the finger: the
// focus goes the other way, by the ground a pixel covers (more up and down,
// the view being tilted).
export function panBy(c, dx, dy, H) {
  const k = metresPerPixel(c, H), s = Math.sin(-TOP.tilt), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  c.x += (cy * dx + sy * dy / s) * k;
  c.z += (-sy * dx + cy * dy / s) * k;
  return c;
}
// Nearer or further by `factor` (<1 is nearer), keeping the ground point `p`
// (under the pinch or the wheel) where it is.
export function zoomAt(c, factor, p = null) {
  const d = clampN(c.dist * factor, TOP.minDist, TOP.maxDist), f = d / c.dist;
  if (p) { c.x = p.x + (c.x - p.x) * f; c.z = p.z + (c.z - p.z) * f; }
  c.dist = d;
  return c;
}
// Turned by `a` radians about the ground point `p` (the focus if none).
export function rotateAbout(c, a, p = null) {
  if (p) {
    const dx = c.x - p.x, dz = c.z - p.z, ca = Math.cos(a), sa = Math.sin(a);
    c.x = p.x + dx * ca + dz * sa; c.z = p.z - dx * sa + dz * ca;
  }
  c.yaw += a;
  return c;
}
// Kept over the map: the focus inside `bound`, and resting on the ground.
export function settle(c, bound, height) {
  c.x = clampN(c.x, -bound, bound); c.z = clampN(c.z, -bound, bound);
  if (height) c.y = height(c.x, c.z);
  return c;
}
