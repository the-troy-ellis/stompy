import { clampN, wrapA } from '../util/math.js';
import { BOUND } from '../world/terrain.js';
import { center } from './geom.js';
import { geoOf } from '../data/geo.js';
import { AI_PUNCH, meleeOf } from '../data/melee.js';
import { canPunch, meleePress, meleeTarget } from './melee.js';
import { perceive } from './ai/perception.js';
import { defaultPlan, steer, strafeTick } from './ai/behaviours.js';
import { decideFire } from './ai/fire.js';
import { PERCEPTION as K } from '../data/ai.js';

const { atan2, hypot, PI } = Math;

// One enemy, one frame. State lives in e.ai.
export function think(G, e, dt) {
  const P = G.player, r = G.rng;
  // Where it believes the player is: the truth with line of sight, the last fix otherwise.
  const bp = perceive(G, e, P, dt), seen = !!e.ai.seen;
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
    const punchable = P.alive && canPunch(G, e) && meleeTarget(G, e) === P;
    const plan = e.ai.plan || defaultPlan(e), brawling = plan.brawler;
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
  if (P.alive && canPunch(G, e) && meleeTarget(G, e) === P) {
    const p = AI_PUNCH.chance[G.diff] ?? AI_PUNCH.chance.normal;   // per second of opportunity, so per frame it is
    if (P.shutdown || r.chance(1 - (1 - p) ** dt)) meleePress(G, e);
  }
  if (e.melee) { e.beamOn = false; return; }
  if (!seen) { e.ai.lockT = 0; return; }   // no shooting at a memory
  decideFire(G, e, P, { dist, toYaw }, dt);
}
