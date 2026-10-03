import { center, eyeOf, rayTerrain } from '../geom.js';
import { norm, sub, len } from '../../util/math.js';
import { diffOf, PERCEPTION as K } from '../../data/ai.js';

// What an enemy knows about the player (docs/specs/05-ai.md § Perception).
// It sees the player with line of sight inside its sight range, or hears
// about them: being hit, or an ally's shout. It aims at where it believes
// the player is, which only line of sight refreshes, so hills really hide
// you. Lose sight for long enough and it goes looking where it last saw you.
//
// State on e.ai: aware, seen (line of sight this check), lastSeen (G.time),
// belief {x, z, vx, vz, at} (last known position and velocity),
// state ('patrol' | 'engage' | 'search'), shoutAt (when a heard call lands),
// lookT (time to the next line-of-sight check), searchT.

const { hypot } = Math;

export function canSee(G, e, P) {
  if (!P.alive) return false;
  const o = eyeOf(e), t = center(P), d = sub(t, o), L = len(d);
  if (L > diffOf(G).sight) return false;
  return rayTerrain(G, o, norm(d), L) == null;
}

// A fresh fix on the player: where they are and how they are moving.
export function spot(G, e, P) {
  const a = e.ai;
  a.belief = { x: P.x, z: P.z, vx: Math.sin(P.yaw) * P.speed, vz: Math.cos(P.yaw) * P.speed, at: G.time };
  a.lastSeen = G.time;
  if (a.aware) return;
  // First sight: a beat before it reacts, shorter on harder settings.
  if (a.reactAt == null) a.reactAt = G.time + diffOf(G).react;
  if (G.time >= a.reactAt) { a.reactAt = null; alertEnemy(G, e, P); }
}

// Become aware, from any cause, and tell nearby allies. `at` is where the
// contact is believed to be; the shout passes that on.
export function alertEnemy(G, e, P, at = null) {
  const a = e.ai;
  const was = a.aware;
  a.aware = true; a.state = 'engage'; a.searchT = 0;
  if (a.lastSeen == null) a.lastSeen = G.time;   // a told or felt contact is good for the usual 8 s
  if (!a.belief) a.belief = { x: at ? at[0] : P.x, z: at ? at[2] : P.z, vx: 0, vz: 0, at: G.time };
  if (was) return;
  for (const o of G.mechs) {
    if (o === e || o.team !== e.team || !o.alive || o.ai.aware || o.ai.shoutAt != null) continue;
    if (hypot(o.x - e.x, o.z - e.z) <= K.shoutRange) o.ai.shoutAt = G.time + K.shoutDelay;
  }
}

// Once a frame per enemy. Returns the point it believes the player is at.
export function perceive(G, e, P, dt) {
  const a = e.ai;
  if (a.state == null) a.state = a.aware ? 'engage' : 'patrol';
  if (a.aware && !a.belief) { a.belief = { x: P.x, z: P.z, vx: 0, vz: 0, at: G.time }; a.lastSeen = G.time; }   // set aware from outside: treat as a fresh contact
  if (a.shoutAt != null && G.time >= a.shoutAt) {
    a.shoutAt = null;
    const caller = G.mechs.find(o => o !== e && o.team === e.team && o.alive && o.ai.belief);
    const b = caller?.ai.belief;
    alertEnemy(G, e, P, b ? [b.x, 0, b.z] : null);
  }
  a.lookT = (a.lookT ?? G.rng.range(0, K.lookEvery)) - dt;
  if (a.lookT <= 0) {
    a.lookT += K.lookEvery;
    a.seen = canSee(G, e, P);
    if (a.seen) spot(G, e, P);
  }
  if (!a.aware) { if (!a.seen) a.reactAt = null; return null; }   // out of sight again before it reacted: start over (seen is the last look's answer)
  if (a.seen) { a.state = 'engage'; a.searchT = 0; }
  else if (a.state === 'engage' && G.time - (a.lastSeen ?? -Infinity) > K.lostAfter) { a.state = 'search'; a.searchT = 0; a.wp = null; }
  if (a.state === 'search') {
    a.searchT += dt;
    if (a.searchT > K.searchFor) { a.aware = false; a.state = 'patrol'; a.belief = null; a.seen = false; a.wp = null; return null; }
  }
  const b = a.belief, age = Math.min(K.extrapolate, G.time - b.at);
  return [b.x + b.vx * age, b.z + b.vz * age];
}
