import { clampN, wrapA } from '../util/math.js';

const { sin, cos, hypot, min, max } = Math;

// Where a remote mech is drawn (docs/specs/10-internet-play.md § Latency):
// INTERP_DELAY ms in the past, between the two reports either side of that
// moment, so a report arriving late or early (internet jitter) doesn't make
// it rubber-band; past the newest report, projected forward along its
// heading for at most EXTRAP s. A gentle follow on top smooths what's left,
// and a jump of more than SNAP m is taken at once (a respawn, a long stall).
// The moment is on the sender's clock: each report carries `ts`, and
// r.netOff (net/remote.js) is the gap to ours, so a report that arrived late
// is still drawn where it belongs in time. `now` is the client clock in ms
// (net/remote.js keeps the last three reports: r.netOld, r.netPrev, r.net).
// Allocation-free: it runs every frame for every remote mech.
export const INTERP_DELAY = 100, EXTRAP = 0.25, SNAP = 30;
const tOf = q => (q.ts ?? q.at);   // a report set without a ts (a test, an old path): its arrival
export function netInterp(r, dt, now) {
  const n = r.net;
  if (!n) return;
  const T = now - (r.netOff || 0) - INTERP_DELAY;   // the sender's clock, INTERP_DELAY ago
  let a = r.netPrev, b = n;
  if (a && T < tOf(a) && r.netOld) { b = a; a = r.netOld; }   // two came close together: the pair before
  let tx, ty, tz, tyaw;
  if (!a || T >= tOf(b)) {
    const age = min(EXTRAP, max(0, (T - tOf(b)) / 1000));
    tx = b.x + sin(b.yaw) * b.sp * age; tz = b.z + cos(b.yaw) * b.sp * age; ty = b.y; tyaw = b.yaw;
  } else {
    const f = clampN((T - tOf(a)) / max(1, tOf(b) - tOf(a)), 0, 1);
    tx = a.x + (b.x - a.x) * f; ty = a.y + (b.y - a.y) * f; tz = a.z + (b.z - a.z) * f; tyaw = a.yaw + wrapA(b.yaw - a.yaw) * f;
  }
  const k = 1 - Math.exp(-dt * 20);
  if (hypot(tx - r.x, tz - r.z) > SNAP) { r.x = tx; r.z = tz; } else { r.x += (tx - r.x) * k; r.z += (tz - r.z) * k; }
  r.y += (ty - r.y) * k;
  r.yaw += wrapA(tyaw - r.yaw) * k;
  r.twist += wrapA(n.tw - r.twist) * k;
  r.pitch += (n.p - r.pitch) * k;
  r.speed = n.sp; r.air = !!n.air; r.shutdown = !!n.sd; r.lights = n.lt !== 0;   // an older client without lt keeps its lights on
}
