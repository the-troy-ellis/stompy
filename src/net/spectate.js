import { clampN } from '../util/math.js';
import { viewYaw } from '../sim/geom.js';
import { geoOf } from '../data/geo.js';

// The arena's spectator camera (docs/specs/08-lan-polish.md § Spectate):
// while you wait to respawn, a chase camera behind another pilot, the one
// who killed you first. G.spectate = { id, yaw, pitch }: whom (their netId),
// and the orbit about them (yaw from behind them, pitch above the horizon).
// The camera itself is the renderer's (spectateCamera, called from scene.js).
export const SPECTATE = { dist: 24, lift: 4, pitch: 0.28, pitchMin: 0.05, pitchMax: 1.2, ground: 2 };

const alivePilots = G => G.mechs.filter(m => m.remote && m.alive && m.netId).sort((a, b) => a.netId - b.netId);

// Start watching `id` (your killer), or the first pilot alive if they are gone.
export function startSpectate(G, id) {
  const live = alivePilots(G), m = live.find(p => p.netId === id) || live[0];
  G.spectate = { id: m ? m.netId : id || 0, yaw: 0, pitch: SPECTATE.pitch };
  return G.spectate;
}
// T / TGT: the next pilot alive, in netId order.
export function nextSpectate(G) {
  const s = G.spectate, live = alivePilots(G);
  if (!s || !live.length) return;
  const i = live.findIndex(p => p.netId === s.id);
  s.id = live[(i + 1) % live.length].netId;
  s.yaw = 0;
}
// The mouse or the aim drag orbits the camera (radians).
export function orbitSpectate(G, dYaw, dPitch) {
  const s = G.spectate;
  if (!s) return;
  s.yaw += dYaw;
  s.pitch = clampN(s.pitch + dPitch, SPECTATE.pitchMin, SPECTATE.pitchMax);
}
// The pilot being watched: the one asked for, or the next alive if they died
// or left (the spectate id moves on), or null when nobody is left.
export function spectated(G) {
  const s = G.spectate;
  if (!s) return null;
  const m = G.mechs.find(p => p.remote && p.netId === s.id && p.alive);
  if (m) return m;
  const live = alivePilots(G);
  if (!live.length) return null;
  s.id = live[0].netId;
  return live[0];
}
// Where the camera is and where it looks: behind the pilot's torso, raised by
// the orbit pitch, never in the ground. { eye, at } or null.
export function spectateCamera(G) {
  const m = spectated(G), s = G.spectate;
  if (!m) return null;
  const sc = m.ch.scale, h = geoOf(m).height * sc, d = SPECTATE.dist * sc, yaw = viewYaw(m) + s.yaw;
  const at = [m.x, m.y + h * 0.7, m.z];
  const eye = [at[0] - Math.sin(yaw) * Math.cos(s.pitch) * d, at[1] + Math.sin(s.pitch) * d + SPECTATE.lift, at[2] - Math.cos(yaw) * Math.cos(s.pitch) * d];
  eye[1] = Math.max(eye[1], G.ter.height(eye[0], eye[2]) + SPECTATE.ground);
  return { eye, at, mech: m };
}
