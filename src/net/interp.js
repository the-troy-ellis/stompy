import { wrapA } from '../util/math.js';

const { sin, cos, hypot, min } = Math;

// Glide a remote mech toward its latest report, projected forward by its
// speed so a late packet doesn't leave it standing still; snap if far off.
// `now` is the client clock in ms (the same one stamped on r.net.at).
export function netInterp(r, dt, now) {
  const n = r.net;
  if (!n) return;
  const age = min(0.25, (now - n.at) / 1000);
  const tx = n.x + sin(n.yaw) * n.sp * age, tz = n.z + cos(n.yaw) * n.sp * age;
  const k = 1 - Math.exp(-dt * 12);
  if (hypot(tx - r.x, tz - r.z) > 30) { r.x = tx; r.z = tz; } else { r.x += (tx - r.x) * k; r.z += (tz - r.z) * k; }
  r.y += (n.y - r.y) * k;
  r.yaw += wrapA(n.yaw - r.yaw) * k;
  r.twist += wrapA(n.tw - r.twist) * k;
  r.pitch += (n.p - r.pitch) * k;
  r.speed = n.sp; r.air = !!n.air; r.shutdown = !!n.sd;
}
