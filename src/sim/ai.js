import { clampN, wrapA } from '../util/math.js';
import { BOUND } from '../world/terrain.js';
import { center } from './geom.js';
import { geoOf } from '../data/geo.js';
import { AI_PUNCH, meleeOf } from '../data/melee.js';
import { canPunch, meleePress, meleeTarget } from './melee.js';
import { perceive } from './ai/perception.js';
import { keepRange, steer, strafeTick } from './ai/behaviours.js';
import { planFor } from './ai/profiles.js';
import { decideFire } from './ai/fire.js';
import { PERCEPTION as K } from '../data/ai.js';
import { revealing } from './waves.js';

const { atan2, hypot, PI } = Math;

// One enemy, one frame. State lives in e.ai.
export function think(G, e, dt) {
  const P = G.player, r = G.rng;
  const plan = e.ai.plan || (e.ai.plan = planFor(e)), brawling = plan.brawler;   // how this chassis fights
  if (revealing(G, e)) return entrance(G, e, P, dt);
  // Where it believes the player is: the truth with line of sight, the last fix otherwise.
  const bp = perceive(G, e, P, dt), seen = !!e.ai.seen;
  const truck = e.ai.aware && convoyTarget(G, e, P);   // an escort mission: the trucks are the point
  if (truck) return attackConvoy(G, e, truck, dt);
  const tx = bp ? bp[0] : P.x, tz = bp ? bp[1] : P.z;
  const dx = tx - e.x, dz = tz - e.z, dist = hypot(dx, dz);
  const toYaw = atan2(dx, dz);
  let moveYaw, thr = 1;
  if (!e.ai.aware) {
    if (!e.ai.wp || hypot(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z) < 30) e.ai.wp = [clampN(e.x + r.range(-250, 250), -BOUND, BOUND), clampN(e.z + r.range(-250, 250), -BOUND, BOUND)];
    moveYaw = atan2(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z); thr = 0.5;
  } else if (e.ai.state === 'search') {
    // Lost contact: go to where they were last seen, then poke around it.
    const b = e.ai.belief;
    if (!e.ai.wp || hypot(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z) < 25) {
      const first = !e.ai.wp && hypot(b.x - e.x, b.z - e.z) > 25;
      e.ai.wp = first ? [b.x, b.z] : [clampN(b.x + r.range(-K.searchRadius, K.searchRadius), -BOUND, BOUND), clampN(b.z + r.range(-K.searchRadius, K.searchRadius), -BOUND, BOUND)];
    }
    moveYaw = atan2(e.ai.wp[0] - e.x, e.ai.wp[1] - e.z); thr = 0.7;
  } else {
    strafeTick(G, e, dt);
    // The player's reach, skin to skin: stay out of it unless they are shut
    // down, in which case walk up and shove them. A JACKAL punching a
    // shut-down player is correct Stompy behaviour.
    const reachP = meleeOf(P).reach * P.ch.scale + geoOf(e).radius * e.ch.scale, tooClose = seen && dist < reachP * AI_PUNCH.keepOut;
    const reachE = meleeOf(e).reach * e.ch.scale + geoOf(P).radius * P.ch.scale;
    const punchable = !plan.noMelee && P.alive && canPunch(G, e) && meleeTarget(G, e) === P;
    let jets = false;
    if (P.shutdown && P.alive) { moveYaw = toYaw; thr = dist < reachP * 0.6 ? 0 : 1; }
    else if (punchable || e.melee) { moveYaw = toYaw; thr = 0; }   // square up and decide (below); the swing holds it there
    else if (tooClose && !brawling) moveYaw = toYaw + PI - e.ai.strafe * 0.6;
    else {
      const out = steer(G, e, { P, tx, tz, dist, toYaw, seen, reachP, reachE }, dt, plan);
      moveYaw = out.moveYaw; thr = out.thr; jets = out.jets;
    }
    e.jetting = jets;
  }
  e.yaw += clampN(wrapA(moveYaw - e.yaw), -e.ch.turn * dt, e.ch.turn * dt);
  e.throttle = thr;
  if (!e.ai.aware) { e.twist *= 1 - dt; return; }
  const wantTwist = clampN(wrapA(toYaw - e.yaw), -1.9, 1.9);
  e.twist += clampN(wrapA(wantTwist - e.twist), -2 * dt, 2 * dt);
  const pc = seen ? center(P) : [tx, G.ter.height(tx, tz) + 4.2 * P.ch.scale, tz];
  e.pitch = atan2(pc[1] - (e.y + 6 * e.ch.scale), dist);
  // In reach and facing: throw the punch, by difficulty. No guns mid-swing.
  if (!plan.noMelee && P.alive && canPunch(G, e) && meleeTarget(G, e) === P) {
    const p = AI_PUNCH.chance[G.diff] ?? AI_PUNCH.chance.normal;   // per second of opportunity, so per frame it is
    if (P.shutdown || r.chance(1 - (1 - p) ** dt)) meleePress(G, e);
  }
  if (e.melee) { e.beamOn = false; return; }
  if (!seen) { e.ai.lockT = 0; return; }   // no shooting at a memory
  decideFire(G, e, P, { dist, toYaw }, dt);
}

// Target selection for escorts (docs/specs/03-objectives.md § Entities): on
// a mission with `prefer: 'convoy'`, an aware enemy goes for the nearest
// truck unless the player is right on top of it (CONVOY_SELF_DEFENCE) or
// much closer than any truck.
export const CONVOY_SELF_DEFENCE = 150;
export function convoyTarget(G, e, P) {
  if (G.def?.prefer !== 'convoy') return null;
  const dP = hypot(P.x - e.x, P.z - e.z);
  if (P.alive && dP < CONVOY_SELF_DEFENCE) return null;
  let best = null, bestD = Infinity;
  for (const v of G.entities) {
    if (v.kind !== 'vehicle' || !v.alive || v.team === e.team) continue;
    const d = hypot(v.x - e.x, v.z - e.z);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best && (!P.alive || bestD < dP * 1.5) ? best : null;
}
// An entrance (waves.js `reveal`): walk straight at the player at a steady
// pace, torso on them, guns quiet. The show is the walk.
function entrance(G, e, P, dt) {
  const toYaw = atan2(P.x - e.x, P.z - e.z);
  e.yaw += clampN(wrapA(toYaw - e.yaw), -e.ch.turn * dt, e.ch.turn * dt);
  e.throttle = 0.8; e.jetting = false;
  e.twist += clampN(wrapA(clampN(wrapA(toYaw - e.yaw), -1.9, 1.9) - e.twist), -2 * dt, 2 * dt);
  e.ai.seen = true;
}
// Close to a firing range on the truck, strafing, and shoot it. Trucks don't
// shoot back, so there is nothing to hide from.
function attackConvoy(G, e, v, dt) {
  strafeTick(G, e, dt);
  const dx = v.x - e.x, dz = v.z - e.z, dist = hypot(dx, dz), toYaw = atan2(dx, dz);
  const out = keepRange(Math.min(e.ch.pref, 220))(G, e, { dist, toYaw });
  e.yaw += clampN(wrapA(out.moveYaw - e.yaw), -e.ch.turn * dt, e.ch.turn * dt);
  e.throttle = out.thr; e.jetting = false;
  e.twist += clampN(wrapA(clampN(wrapA(toYaw - e.yaw), -1.9, 1.9) - e.twist), -2 * dt, 2 * dt);
  e.pitch = atan2(v.y + v.height / 2 - (e.y + 6 * e.ch.scale), dist);
  e.ai.seen = true;   // the route is no secret
  decideFire(G, e, v, { dist, toYaw }, dt);
}
